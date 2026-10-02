/**
 * Chat automation rules v1 (server): CRUD + the evaluator the 1-minute workspace cron calls.
 * Raw SQL on SQL 043 tables (fail-safe when not applied). Every query is scoped by tenantId; the
 * evaluator only ever touches conversations of the rule's own tenant. Internal actions only.
 */
import 'server-only'

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { isClosedCategory } from '@/lib/crm-stages'
import { loadStages } from '@/lib/crm-stages-server'
import { isAssignableChatMember } from '@/lib/chat-conversation-route-helpers'
import { createTask } from '@/lib/crm-tasks'
import { notifyUsers } from '@/lib/workspace-notifications'
import {
  IDLE_FIRE_WINDOW_MS,
  KEYWORD_WINDOW_MS,
  MAX_ACTIONS_PER_TENANT_PER_RUN,
  MAX_CANDIDATES_PER_RULE,
  MAX_RULES_PER_TENANT,
  NEW_CHAT_WINDOW_MS,
  idleDedupeKey,
  isAwaitingReply,
  matchesKeyword,
  type ActionConfig,
  type ActionKind,
  type RuleInput,
  type TriggerConfig,
  type TriggerKind,
} from '@/lib/chat-automation-rules'

const RULE_TABLE = 'ChatAutomationRule'
const RETENTION_DAYS = 30

export type RuleRow = {
  id: string
  tenantId: string
  name: string
  enabled: boolean
  triggerKind: TriggerKind
  triggerConfig: TriggerConfig
  actionKind: ActionKind
  actionConfig: ActionConfig
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export class RulesNotReadyError extends Error {
  constructor() {
    super('RULES_NOT_READY')
    this.name = 'RulesNotReadyError'
  }
}
export class RuleLimitError extends Error {
  constructor() {
    super('RULE_LIMIT')
    this.name = 'RuleLimitError'
  }
}

async function requireReady() {
  if (!(await isTableReady(RULE_TABLE))) throw new RulesNotReadyError()
}

export async function listRules(tenantId: string): Promise<{ available: boolean; rules: Array<RuleRow & { runs24h: number }> }> {
  if (!(await isTableReady(RULE_TABLE))) return { available: false, rules: [] }
  const rules = await prisma.$queryRaw<RuleRow[]>`
    SELECT "id", "tenantId", "name", "enabled", "triggerKind", "triggerConfig", "actionKind", "actionConfig",
           "createdBy", "createdAt", "updatedAt"
      FROM "ChatAutomationRule" WHERE "tenantId" = ${tenantId}
     ORDER BY "createdAt" ASC LIMIT ${MAX_RULES_PER_TENANT + 5}`
  const runs = await prisma.$queryRaw<Array<{ ruleId: string; n: number }>>`
    SELECT "ruleId", count(*)::int AS "n" FROM "ChatAutomationRuleRun"
     WHERE "tenantId" = ${tenantId} AND "createdAt" > now() - interval '24 hours'
     GROUP BY "ruleId"`
  const byRule = new Map(runs.map((r) => [r.ruleId, r.n]))
  return { available: true, rules: rules.map((r) => ({ ...r, runs24h: byRule.get(r.id) ?? 0 })) }
}

export async function createRule(tenantId: string, userId: string, rule: RuleInput): Promise<string> {
  await requireReady()
  const count = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS "n" FROM "ChatAutomationRule" WHERE "tenantId" = ${tenantId}`
  if ((count[0]?.n ?? 0) >= MAX_RULES_PER_TENANT) throw new RuleLimitError()
  const id = randomUUID()
  await prisma.$executeRaw`
    INSERT INTO "ChatAutomationRule"
      ("id", "tenantId", "name", "enabled", "triggerKind", "triggerConfig", "actionKind", "actionConfig", "createdBy")
    VALUES (${id}, ${tenantId}, ${rule.name}, ${rule.enabled}, ${rule.triggerKind},
            ${JSON.stringify(rule.triggerConfig)}::jsonb, ${rule.actionKind},
            ${JSON.stringify(rule.actionConfig)}::jsonb, ${userId})`
  return id
}

export async function updateRule(tenantId: string, id: string, rule: RuleInput): Promise<boolean> {
  await requireReady()
  const n = await prisma.$executeRaw`
    UPDATE "ChatAutomationRule"
       SET "name" = ${rule.name}, "enabled" = ${rule.enabled}, "triggerKind" = ${rule.triggerKind},
           "triggerConfig" = ${JSON.stringify(rule.triggerConfig)}::jsonb, "actionKind" = ${rule.actionKind},
           "actionConfig" = ${JSON.stringify(rule.actionConfig)}::jsonb, "updatedAt" = now()
     WHERE "id" = ${id} AND "tenantId" = ${tenantId}`
  return n > 0
}

export async function setRuleEnabled(tenantId: string, id: string, enabled: boolean): Promise<boolean> {
  await requireReady()
  const n = await prisma.$executeRaw`
    UPDATE "ChatAutomationRule" SET "enabled" = ${enabled}, "updatedAt" = now()
     WHERE "id" = ${id} AND "tenantId" = ${tenantId}`
  return n > 0
}

export async function deleteRule(tenantId: string, id: string): Promise<boolean> {
  await requireReady()
  const n = await prisma.$executeRaw`
    DELETE FROM "ChatAutomationRule" WHERE "id" = ${id} AND "tenantId" = ${tenantId}`
  return n > 0
}

export async function getRule(tenantId: string, id: string): Promise<RuleRow | null> {
  if (!(await isTableReady(RULE_TABLE))) return null
  const rows = await prisma.$queryRaw<RuleRow[]>`
    SELECT "id", "tenantId", "name", "enabled", "triggerKind", "triggerConfig", "actionKind", "actionConfig",
           "createdBy", "createdAt", "updatedAt"
      FROM "ChatAutomationRule" WHERE "id" = ${id} AND "tenantId" = ${tenantId} LIMIT 1`
  return rows[0] ?? null
}

// ---------------------------------------------------------------- evaluator

export type RulesSummary = {
  rules: number
  fired: number
  failed: number
  skipped?: 'tables_missing' | 'time_budget'
}

type Candidate = { conversationId: string; dedupeKey: string }

async function closedStageKeys(tenantId: string): Promise<string[]> {
  const { stages } = await loadStages(tenantId, 'chat')
  return stages.filter((s) => !s.archived && isClosedCategory(s.category)).map((s) => s.key)
}

async function findCandidates(
  rule: RuleRow,
  now: Date,
  cache: { keywordMessages?: Array<{ id: string; conversationId: string | null; content: string }>; closed?: string[] },
): Promise<Candidate[]> {
  const tenantId = rule.tenantId
  if (rule.triggerKind === 'new_chat') {
    const rows = await prisma.chatConversation.findMany({
      where: { tenantId, createdAt: { gte: new Date(now.getTime() - NEW_CHAT_WINDOW_MS) } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATES_PER_RULE,
    })
    return rows.map((r) => ({ conversationId: r.id, dedupeKey: 'new' }))
  }
  if (rule.triggerKind === 'idle') {
    const minutes = Number(rule.triggerConfig.minutes) || 0
    if (minutes < 5) return []
    cache.closed ??= await closedStageKeys(tenantId)
    const upper = new Date(now.getTime() - minutes * 60_000)
    const lower = new Date(upper.getTime() - IDLE_FIRE_WINDOW_MS)
    const rows = await prisma.chatConversation.findMany({
      where: {
        tenantId,
        lastInboundAt: { lte: upper, gte: lower },
        ...(cache.closed.length ? { status: { notIn: cache.closed } } : {}),
      },
      select: { id: true, lastInboundAt: true, lastOutboundAt: true, aiMode: true },
      orderBy: { lastInboundAt: 'desc' },
      take: 200,
    })
    return rows
      // An agent that is attending the chat is not "idle".
      .filter((r) => isAwaitingReply(r) && r.aiMode !== 'ai_active')
      .slice(0, MAX_CANDIDATES_PER_RULE)
      .map((r) => ({ conversationId: r.id, dedupeKey: idleDedupeKey(r.lastInboundAt as Date) }))
  }
  // keyword
  const keywords = rule.triggerConfig.keywords ?? []
  if (!keywords.length) return []
  cache.keywordMessages ??= await prisma.chatMessage.findMany({
    where: {
      tenantId,
      direction: 'inbound',
      sentAt: { gte: new Date(now.getTime() - KEYWORD_WINDOW_MS) },
      conversationId: { not: null },
    },
    select: { id: true, conversationId: true, content: true },
    orderBy: { sentAt: 'desc' },
    take: 500,
  })
  const out: Candidate[] = []
  for (const m of cache.keywordMessages) {
    if (!m.conversationId || !matchesKeyword(m.content, keywords)) continue
    out.push({ conversationId: m.conversationId, dedupeKey: `msg:${m.id}` })
    if (out.length >= MAX_CANDIDATES_PER_RULE) break
  }
  return out
}

async function claimRun(rule: RuleRow, c: Candidate): Promise<string | null> {
  const id = randomUUID()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "ChatAutomationRuleRun" ("id", "tenantId", "ruleId", "conversationId", "dedupeKey")
    VALUES (${id}, ${rule.tenantId}, ${rule.id}, ${c.conversationId}, ${c.dedupeKey})
    ON CONFLICT ("ruleId", "conversationId", "dedupeKey") DO NOTHING
    RETURNING "id"`
  return rows[0]?.id ?? null
}

async function runAction(rule: RuleRow, c: Candidate, now: Date, memberOk: Map<string, boolean>) {
  const tenantId = rule.tenantId
  // The conversation must belong to the rule's tenant (defence in depth; candidates already come from it).
  const conv = await prisma.chatConversation.findFirst({
    where: { id: c.conversationId, tenantId },
    select: { id: true, assignedUserId: true },
  })
  if (!conv) return
  if (rule.actionKind === 'tag') {
    const tag = String(rule.actionConfig.tag || '').slice(0, 30)
    if (!tag) return
    await prisma.$executeRaw`
      UPDATE "ChatConversation" SET "tags" = array_append("tags", ${tag})
       WHERE "id" = ${conv.id} AND "tenantId" = ${tenantId}
         AND NOT (${tag} = ANY("tags")) AND cardinality("tags") < 20`
    return
  }
  if (rule.actionKind === 'assign') {
    const userId = String(rule.actionConfig.userId || '')
    if (!userId) return
    if (!memberOk.has(userId)) memberOk.set(userId, await isAssignableChatMember(tenantId, userId))
    if (!memberOk.get(userId)) throw new Error('assignee_invalid')
    const res = await prisma.chatConversation.updateMany({
      where: { id: conv.id, tenantId, assignedUserId: null }, // never takes a chat from someone
      data: { assignedUserId: userId },
    })
    if (res.count > 0) {
      await notifyUsers({
        tenantId,
        actorUserId: null,
        kind: 'chat_assigned',
        userIds: [userId],
        dedupeKey: (u) => `rule_assign:${rule.id}:${conv.id}:${u}`,
        conversationId: conv.id,
      })
    }
    return
  }
  // task
  const creator = rule.createdBy
  if (!creator) throw new Error('no_creator')
  const due = rule.actionConfig.dueInMinutes
  const result = await createTask({
    tenantId,
    userId: creator,
    title: rule.actionConfig.title,
    kind: 'follow_up',
    dueAt: typeof due === 'number' ? new Date(now.getTime() + due * 60_000).toISOString() : undefined,
    assigneeUserId: conv.assignedUserId ?? undefined,
    conversationId: conv.id,
  })
  if (!result.ok) throw new Error(`task_${result.status}`)
}

export async function runChatAutomationRules(opts: { now?: Date; budgetMs?: number } = {}): Promise<RulesSummary> {
  const summary: RulesSummary = { rules: 0, fired: 0, failed: 0 }
  if (!(await isTableReady(RULE_TABLE))) return { ...summary, skipped: 'tables_missing' }
  const now = opts.now ?? new Date()
  const started = Date.now()
  const budget = opts.budgetMs ?? 15_000
  let rules: RuleRow[]
  try {
    rules = await prisma.$queryRaw<RuleRow[]>`
      SELECT "id", "tenantId", "name", "enabled", "triggerKind", "triggerConfig", "actionKind", "actionConfig",
             "createdBy", "createdAt", "updatedAt"
        FROM "ChatAutomationRule" WHERE "enabled" = true
       ORDER BY "tenantId", "createdAt" LIMIT 500`
  } catch (error) {
    if (isMissingRelation(error)) return { ...summary, skipped: 'tables_missing' }
    throw error
  }
  summary.rules = rules.length
  const byTenant = new Map<string, RuleRow[]>()
  for (const r of rules) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r])

  for (const [, tenantRules] of byTenant) {
    let actionsLeft = MAX_ACTIONS_PER_TENANT_PER_RUN
    const cache: Parameters<typeof findCandidates>[2] = {}
    const memberOk = new Map<string, boolean>()
    for (const rule of tenantRules) {
      if (Date.now() - started > budget) return { ...summary, skipped: 'time_budget' }
      if (actionsLeft <= 0) break
      let candidates: Candidate[] = []
      try {
        candidates = await findCandidates(rule, now, cache)
      } catch (error) {
        console.error('[chat-automation-rules] candidates failed', error instanceof Error ? error.name : 'unknown')
        continue
      }
      for (const cand of candidates) {
        if (actionsLeft <= 0) break
        try {
          const runId = await claimRun(rule, cand)
          if (!runId) continue // already fired for this event
          actionsLeft -= 1
          try {
            await runAction(rule, cand, now, memberOk)
            summary.fired += 1
          } catch (error) {
            summary.failed += 1
            const code = (error instanceof Error ? error.message : 'error').slice(0, 100)
            await prisma.$executeRaw`
              UPDATE "ChatAutomationRuleRun" SET "status" = 'failed', "error" = ${code} WHERE "id" = ${runId}`
          }
        } catch (error) {
          console.error('[chat-automation-rules] run failed', error instanceof Error ? error.name : 'unknown')
        }
      }
    }
  }
  // Retention: the run ledger is only needed to avoid refiring, never kept for long.
  try {
    await prisma.$executeRaw`
      DELETE FROM "ChatAutomationRuleRun"
       WHERE "id" IN (SELECT "id" FROM "ChatAutomationRuleRun"
                        WHERE "createdAt" < now() - make_interval(days => ${RETENTION_DAYS}) LIMIT 500)`
  } catch {
    /* best effort */
  }
  return summary
}
