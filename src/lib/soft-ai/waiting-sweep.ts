/**
 * Agentes IA 2.0 · C — "Never left waiting".
 *
 * Finds chats on a line whose LAST message is from the customer, still inside the 24 h reply window,
 * not taken by a person (aiMode 'human' / 'paused'), and puts that last customer message through the
 * SAME durable job path the webhook uses (ChatAutomationJob, delivery key `soft_ai_inbound:<messageId>`).
 *
 * Idempotency — the same customer message is never answered twice:
 * - the delivery key is the webhook's own key for that message (unique column), so a new job is only
 *   created when the webhook never made one;
 * - an existing finished job is re-queued ONLY when it never created an outbound delivery claim and its
 *   agent turn did not produce an answer (see decideWaitingAction), with an attempts cap so the periodic
 *   sweep cannot loop;
 * - the chat's last message must still be the customer's (any reply after it — person or AI — means
 *   answered), and the claim gates re-check "a person replied" right before the model runs.
 *
 * Entry points:
 * - sweepWaitingChats(tenantId, socialAccountId)  — a line was just turned on (stream A calls it).
 * - sweepWaitingConversation(...)                  — "Devolver a IA" on one chat (control route).
 * - sweepWaitingChatsPeriodic()                    — every chat-automation cron run, bounded.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { CHAT_AGENT_LAYER_V1_FLAG, shouldUseSoftTenantAiV1 } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { agentWindowOpen } from '@/lib/soft-ai/agent-claim-gates'
import { readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'
import { resolveChatAgent } from '@/lib/soft-ai/agent-resolver'
import {
  persistJob,
  rearmFinishedJob,
  softAiInboundDeliveryKey,
} from '@/lib/soft-ai/automation-queue'

const DAY_MS = 24 * 60 * 60_000
/** Most chats answered by one "line turned on" call (Rafael: newest first, cap 50). */
export const WAITING_SWEEP_MAX = 50
/** Periodic sweep: a chat must have waited this long (the webhook path had its chance). */
export const PERIODIC_MIN_WAIT_MS = 90_000
/** Periodic sweep: most jobs queued per cron run, all lines together. */
export const PERIODIC_RUN_CAP = 10
/** Periodic sweep: most waiting chats looked at per line per run. */
export const PERIODIC_SCAN_PER_LINE = 20
/** Most tenants looked at per periodic run. */
export const PERIODIC_TENANT_CAP = 50
/** Never start an answer with less than this left in the 24 h window. */
export const WINDOW_SAFETY_MS = 2 * 60_000
/** Re-queue caps on ChatAutomationJob.attempts (each claim adds 1; the webhook's own run is attempt 1). */
export const EXPLICIT_MAX_ATTEMPTS = 8
export const PERIODIC_MAX_ATTEMPTS = 2
/** Parallel processing kicked by one sweep (the cron claimant stays the safety net). */
const KICK_CONCURRENCY = 3

export type SweepMode = 'explicit' | 'periodic'

/** Turn skip reasons that mean "the line was not on yet" — they can clear by themselves. */
// SecureDog INT-102: no 'flag_off' (Betsy's admin switched AI off on purpose) and no 'missing_mode' (old fail-closed
// skips from before chats followed their line) — the periodic sweep must not send a late-reply wave after deploy.
export const PERIODIC_REARM_SKIP_REASONS: ReadonlySet<string> = new Set([
  'account_not_allowlisted',
  'binding_inactive',
  'agent_not_live',
  'no_binding',
  'draft_agent',
  'model_not_allowed',
  'schema_not_ready',
  'not_activated',
  'ai_full_not_unlocked',
  'stale_version',
  // SecureDog INT-98: never 'kill_switch' / 'ai_terms_not_accepted' — lifting a kill switch must not answer the
  // incident's messages (up to 24 h old) automatically.
])

/** Turn outcomes that already produced (or decided) an answer: never re-run. */
const TURN_DONE_STATUSES: ReadonlySet<string> = new Set([
  'generated',
  'delivered',
  'partially_delivered',
  'suggested',
  'fallback',
  'test',
  'window_closed',
])

export type WaitingCandidate = {
  aiMode: string | null | undefined
  platform: string
  latest: {
    id: string
    direction: string
    sentAt: Date
    content: string | null
    historical: boolean
    duplicate: boolean
  } | null
  /** Existing job for the latest message's delivery key. */
  job: { status: string; attempts: number; deliveries: number } | null
  /** Agent turn for that delivery key (null when none / table missing). */
  turn: { status: string; skipReason: string | null } | null
  /** A pending/retry/processing job exists in this chat for ANOTHER message. */
  otherInflight: boolean
  /**
   * Chat with no explicit mode (aiMode NULL) where a PERSON wrote in the last 24 h: it stays with that person
   * (Rafael's default, same rule as effectiveConversationAiMode in agent-mode-server).
   */
  humanWroteRecently?: boolean
}

export type WaitingDecision = { action: 'enqueue' | 'rearm' | 'skip'; reason: string }

export function clampSweepLimit(limit: number | undefined, max = WAITING_SWEEP_MAX): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return max
  return Math.max(1, Math.min(Math.floor(limit), max))
}

export function turnAllowsRearm(
  turn: { status: string; skipReason: string | null } | null,
  mode: SweepMode,
): boolean {
  if (!turn) return true
  if (TURN_DONE_STATUSES.has(turn.status)) return false
  // "A person replied" is final for that message, whoever asks.
  if (turn.skipReason === 'human_replied') return false
  if (mode === 'periodic') {
    return turn.status === 'skipped' && PERIODIC_REARM_SKIP_REASONS.has(turn.skipReason || '')
  }
  // Explicit (line turned on / Devolver a IA): the owner removed the reason.
  return turn.status === 'skipped' || turn.status === 'budget_blocked' || turn.status === 'failed'
}

/** Pure: should this chat's last customer message be (re)queued? */
export function decideWaitingAction(
  c: WaitingCandidate,
  opts: { mode: SweepMode; nowMs: number; minWaitMs?: number },
): WaitingDecision {
  if (c.aiMode === 'human' || c.aiMode === 'paused') return { action: 'skip', reason: 'with_person' }
  if (!c.aiMode && c.humanWroteRecently) return { action: 'skip', reason: 'with_person' }
  const m = c.latest
  if (!m) return { action: 'skip', reason: 'no_messages' }
  if (m.direction !== 'inbound') return { action: 'skip', reason: 'answered' }
  if (m.historical) return { action: 'skip', reason: 'history_import' }
  if (m.duplicate) return { action: 'skip', reason: 'duplicate' }
  if (!m.content || !m.content.trim()) return { action: 'skip', reason: 'empty' }
  if (!agentWindowOpen(c.platform, m.sentAt, opts.nowMs + WINDOW_SAFETY_MS)) {
    return { action: 'skip', reason: 'window_closed' }
  }
  if (opts.nowMs - m.sentAt.getTime() < (opts.minWaitMs ?? 0)) return { action: 'skip', reason: 'too_recent' }
  if (opts.mode === 'periodic' && c.otherInflight) return { action: 'skip', reason: 'in_flight' }
  const job = c.job
  if (!job) return { action: 'enqueue', reason: 'no_job' }
  if (job.status === 'pending' || job.status === 'retry' || job.status === 'processing') {
    return { action: 'skip', reason: 'already_queued' }
  }
  if (job.status !== 'completed' && job.status !== 'failed') return { action: 'skip', reason: 'job_' + job.status }
  if (job.deliveries > 0) return { action: 'skip', reason: 'already_sent' }
  const cap = opts.mode === 'periodic' ? PERIODIC_MAX_ATTEMPTS : EXPLICIT_MAX_ATTEMPTS
  if (job.attempts >= cap) return { action: 'skip', reason: 'attempts_exhausted' }
  if (!turnAllowsRearm(c.turn, opts.mode)) return { action: 'skip', reason: 'turn_done' }
  return { action: 'rearm', reason: 'rearm' }
}

function isHistorical(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const meta = metadata as Record<string, unknown>
  return meta.historical === true || meta.webhookField === 'history'
}

/**
 * Is the line answering by itself right now? Same truth the job uses: layer + Soft flags, allowlisted,
 * a live agent bound in ai_full with a valid activation for its current version/model, kill switch off.
 */
export async function lineAnswersNow(tenantId: string, socialAccountId: string): Promise<boolean> {
  if ((await readAgentKillState(tenantId)).armed) return false
  const resolved = await resolveChatAgent({ tenantId, socialAccountId, conversationAiMode: 'ai_active' })
  return (
    resolved.kind === 'resolved' &&
    resolved.effectiveBehavior === 'send' &&
    resolved.agent.operationMode === 'ai_full' &&
    resolved.unlockedForSend
  )
}

/** A person (not the AI) sent a message in this chat in the last 24 h (CRM reply or WhatsApp app echo). */
async function personWroteRecently(tenantId: string, conversationId: string, nowMs: number): Promise<boolean> {
  const rows = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId, direction: 'outbound', sentAt: { gte: new Date(nowMs - DAY_MS) } },
    orderBy: { sentAt: 'desc' },
    take: 20,
    select: { senderUserId: true, metadata: true },
  })
  return rows.some((r) => {
    if (r.senderUserId) return true
    const meta = r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {}
    return meta.softAi !== true
  })
}

type ConversationRow = {
  id: string
  tenantId: string
  socialAccountId: string
  peerId: string
  peerName: string | null
  aiMode: string | null
}

type PreparedJob = { jobId: string }

async function loadTurn(deliveryKey: string, tenantId: string) {
  try {
    const row = await prisma.chatAgentTurn.findUnique({
      where: { automationDeliveryKey: deliveryKey },
      select: { tenantId: true, status: true, skipReason: true },
    })
    if (!row || row.tenantId !== tenantId) return null
    return { status: row.status, skipReason: row.skipReason }
  } catch (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
}

/** Evaluate one chat and queue its last customer message when it is still waiting. */
async function prepareConversation(
  conv: ConversationRow,
  platform: string,
  opts: { mode: SweepMode; nowMs: number; minWaitMs: number },
): Promise<{ decision: WaitingDecision; job?: PreparedJob }> {
  const latestRow = await prisma.chatMessage.findFirst({
    where: { tenantId: conv.tenantId, conversationId: conv.id },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      direction: true,
      content: true,
      sentAt: true,
      metadata: true,
      duplicateOfMessageId: true,
    },
  })
  const latest = latestRow
    ? {
        id: latestRow.id,
        direction: latestRow.direction,
        sentAt: latestRow.sentAt,
        content: latestRow.content,
        historical: isHistorical(latestRow.metadata),
        duplicate: Boolean(latestRow.duplicateOfMessageId),
      }
    : null

  let job: WaitingCandidate['job'] = null
  let jobId: string | null = null
  let turn: WaitingCandidate['turn'] = null
  let otherInflight = false
  let humanWroteRecently = false
  const deliveryKey = latest ? softAiInboundDeliveryKey(latest.id) : ''
  if (latest && latest.direction === 'inbound') {
    const [jobRow, inflight] = await Promise.all([
      prisma.chatAutomationJob.findUnique({
        where: { deliveryKey },
        select: { id: true, tenantId: true, status: true, attempts: true, _count: { select: { deliveries: true } } },
      }),
      prisma.chatAutomationJob.findFirst({
        where: {
          tenantId: conv.tenantId,
          conversationId: conv.id,
          deliveryKey: { not: deliveryKey },
          status: { in: ['pending', 'retry', 'processing'] },
        },
        select: { id: true },
      }),
    ])
    if (jobRow && jobRow.tenantId !== conv.tenantId) {
      // A delivery key is derived from a message id of this tenant; anything else is never touched.
      return { decision: { action: 'skip', reason: 'foreign_job' } }
    }
    if (jobRow) {
      jobId = jobRow.id
      job = { status: jobRow.status, attempts: jobRow.attempts, deliveries: jobRow._count.deliveries }
      turn = await loadTurn(deliveryKey, conv.tenantId)
    }
    otherInflight = Boolean(inflight)
    if (!conv.aiMode) humanWroteRecently = await personWroteRecently(conv.tenantId, conv.id, opts.nowMs)
  }

  const decision = decideWaitingAction(
    { aiMode: conv.aiMode, platform, latest, job, turn, otherInflight, humanWroteRecently },
    opts,
  )
  if (decision.action === 'skip' || !latest) return { decision }

  // Same payload shape the webhook writes (inbound-hook → persistJob).
  const payload = {
    platform,
    content: latest.content,
    senderName: conv.peerName ?? null,
    sweep: opts.mode,
  }
  if (decision.action === 'enqueue') {
    const row = await persistJob({
      tenantId: conv.tenantId,
      conversationId: conv.id,
      messageId: latest.id,
      socialAccountId: conv.socialAccountId,
      peerId: conv.peerId,
      platform,
      content: latest.content || '',
      senderName: conv.peerName,
      payload: { sweep: opts.mode },
    })
    // Lost a race with the webhook: its job owns the message.
    if (row.duplicate) return { decision: { action: 'skip', reason: 'already_queued' } }
    return { decision, job: { jobId: row.id } }
  }
  const ok = jobId ? await rearmFinishedJob({ id: jobId, tenantId: conv.tenantId, payload }) : false
  if (!ok) return { decision: { action: 'skip', reason: 'rearm_lost_race' } }
  return { decision, job: { jobId: jobId as string } }
}

/** Kick the queued jobs now (newest first, a few in parallel). The cron claimant is the safety net. */
export function kickQueuedJobs(jobIds: string[]): void {
  if (!jobIds.length) return
  const queue = [...jobIds]
  void (async () => {
    const { processJobById } = await import('@/lib/soft-ai/automation-processor')
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift() as string
        try {
          await processJobById(id)
        } catch (error) {
          console.error('[soft-ai/waiting-sweep] kick failed', error instanceof Error ? error.name : 'unknown')
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(KICK_CONCURRENCY, queue.length) }, worker))
  })().catch(() => undefined)
}

const WITH_AI_WHERE = { OR: [{ aiMode: null }, { aiMode: { notIn: ['human', 'paused'] } }] }

async function sweepLine(input: {
  tenantId: string
  socialAccountId: string
  platform: string
  /** Chats looked at. */
  limit: number
  /** Most jobs queued (defaults to limit). */
  maxQueue?: number
  mode: SweepMode
  minWaitMs: number
  nowMs: number
  /** Periodic only: ignore messages that arrived before the line was switched on (no late-reply wave at deploy). */
  notBeforeMs?: number | null
}): Promise<{ queued: number; skipped: number; jobIds: string[] }> {
  const maxQueue = input.maxQueue ?? input.limit
  const windowStart = input.nowMs - DAY_MS + WINDOW_SAFETY_MS
  const since = new Date(Math.max(windowStart, input.notBeforeMs ?? 0))
  const convs = await prisma.chatConversation.findMany({
    where: {
      tenantId: input.tenantId,
      socialAccountId: input.socialAccountId,
      lastMessageDirection: 'inbound',
      lastMessageAt: { gte: since },
      lastInboundAt: { gte: since, lte: new Date(input.nowMs - input.minWaitMs) },
      ...WITH_AI_WHERE,
    },
    orderBy: [{ lastInboundAt: 'desc' }, { id: 'desc' }],
    take: input.limit,
    select: { id: true, tenantId: true, socialAccountId: true, peerId: true, peerName: true, aiMode: true },
  })
  const jobIds: string[] = []
  let skipped = 0
  for (const conv of convs) {
    if (jobIds.length >= maxQueue) break
    try {
      const res = await prepareConversation(conv, input.platform, {
        mode: input.mode,
        nowMs: input.nowMs,
        minWaitMs: input.minWaitMs,
      })
      if (res.job) jobIds.push(res.job.jobId)
      else skipped++
    } catch (error) {
      skipped++
      console.error('[soft-ai/waiting-sweep] chat skipped', error instanceof Error ? error.name : 'unknown')
    }
  }
  return { queued: jobIds.length, skipped, jobIds }
}

async function loadLine(tenantId: string, socialAccountId: string) {
  return prisma.socialAccount.findFirst({
    where: { id: socialAccountId, tenantId },
    select: { id: true, platform: true },
  })
}

/**
 * A line was just turned on: answer every chat on it whose last message is the customer's and still
 * inside the 24 h window, newest first, at most 50. Never throws. Safe to call twice.
 * Call it AFTER the line is fully on (activation stored): if the line does not answer yet, nothing is queued.
 */
export async function sweepWaitingChats(
  tenantId: string,
  socialAccountId: string,
  opts?: { limit?: number },
): Promise<{ queued: number; skipped: number }> {
  try {
    if (!tenantId || !socialAccountId) return { queued: 0, skipped: 0 }
    const line = await loadLine(tenantId, socialAccountId)
    if (!line) return { queued: 0, skipped: 0 }
    if (!(await shouldUseSoftTenantAiV1(tenantId))) return { queued: 0, skipped: 0 }
    if (!(await lineAnswersNow(tenantId, socialAccountId))) return { queued: 0, skipped: 0 }
    const res = await sweepLine({
      tenantId,
      socialAccountId,
      platform: line.platform,
      limit: clampSweepLimit(opts?.limit),
      mode: 'explicit',
      minWaitMs: 0,
      nowMs: Date.now(),
    })
    kickQueuedJobs(res.jobIds)
    return { queued: res.queued, skipped: res.skipped }
  } catch (error) {
    console.error('[soft-ai/waiting-sweep] line sweep failed', error instanceof Error ? error.name : 'unknown')
    return { queued: 0, skipped: 0 }
  }
}

/**
 * "Devolver a IA" on one chat: if its last customer message is still unanswered (and the line answers),
 * queue it now. Never throws.
 */
export async function sweepWaitingConversation(input: {
  tenantId: string
  socialAccountId: string
  peerId: string
}): Promise<{ queued: boolean; reason: string }> {
  try {
    const line = await loadLine(input.tenantId, input.socialAccountId)
    if (!line) return { queued: false, reason: 'no_line' }
    if (!(await shouldUseSoftTenantAiV1(input.tenantId))) return { queued: false, reason: 'flag_off' }
    if (!(await lineAnswersNow(input.tenantId, input.socialAccountId))) return { queued: false, reason: 'line_off' }
    const conv = await prisma.chatConversation.findFirst({
      where: { tenantId: input.tenantId, socialAccountId: input.socialAccountId, peerId: input.peerId },
      select: { id: true, tenantId: true, socialAccountId: true, peerId: true, peerName: true, aiMode: true },
    })
    if (!conv) return { queued: false, reason: 'no_chat' }
    const res = await prepareConversation(conv, line.platform, { mode: 'explicit', nowMs: Date.now(), minWaitMs: 0 })
    if (!res.job) return { queued: false, reason: res.decision.reason }
    kickQueuedJobs([res.job.jobId])
    return { queued: true, reason: res.decision.reason }
  } catch (error) {
    console.error('[soft-ai/waiting-sweep] chat sweep failed', error instanceof Error ? error.name : 'unknown')
    return { queued: false, reason: 'error' }
  }
}

/**
 * Every chat-automation cron run: per business with the agent layer on, every line that answers by itself,
 * chats waiting more than 90 s with no job in flight → queue (at most PERIODIC_RUN_CAP per run).
 * Never re-answers a chat where anyone replied after the customer's last message. Never throws.
 */
export async function sweepWaitingChatsPeriodic(opts?: {
  maxQueued?: number
  deadlineMs?: number
}): Promise<{ lines: number; queued: number; skipped: number }> {
  const out = { lines: 0, queued: 0, skipped: 0 }
  const cap = clampSweepLimit(opts?.maxQueued, PERIODIC_RUN_CAP)
  const deadline = Date.now() + (opts?.deadlineMs ?? 8_000)
  const jobIds: string[] = []
  try {
    const flags = await prisma.tenantFeatureFlag.findMany({
      where: { key: CHAT_AGENT_LAYER_V1_FLAG, enabled: true },
      select: { tenantId: true, scope: true, config: true },
      orderBy: { tenantId: 'asc' },
      take: PERIODIC_TENANT_CAP * 2,
    })
    const tenants = flags.filter((f) => f.tenantId && f.scope === f.tenantId).slice(0, PERIODIC_TENANT_CAP)
    for (const flag of tenants) {
      if (out.queued >= cap || Date.now() > deadline) break
      const tenantId = flag.tenantId as string
      const allowlist = parseChatAgentLayerConfig(flag.config).accountAllowlist.slice(0, 50)
      if (!allowlist.length) continue
      if (!(await shouldUseSoftTenantAiV1(tenantId))) continue
      if ((await readAgentKillState(tenantId)).armed) continue
      const lines = await prisma.socialAccount.findMany({
        where: { tenantId, id: { in: allowlist } },
        select: { id: true, platform: true },
      })
      const unlocks = parseChatAgentLayerConfig(flag.config).aiFullUnlock
      for (const line of lines) {
        if (out.queued >= cap || Date.now() > deadline) break
        if (!(await lineAnswersNow(tenantId, line.id))) continue
        // SecureDog deploy note: the periodic sweep only catches messages that arrived while the line was ON
        // (switching a line on answers its last 24 h explicitly, via sweepWaitingChats).
        const passedAt = Date.parse(unlocks[line.id]?.passedAt || '')
        if (!Number.isFinite(passedAt)) continue
        out.lines++
        const res = await sweepLine({
          tenantId,
          socialAccountId: line.id,
          platform: line.platform,
          limit: PERIODIC_SCAN_PER_LINE,
          maxQueue: cap - out.queued,
          mode: 'periodic',
          minWaitMs: PERIODIC_MIN_WAIT_MS,
          nowMs: Date.now(),
          notBeforeMs: passedAt,
        })
        out.queued += res.queued
        out.skipped += res.skipped
        jobIds.push(...res.jobIds)
      }
    }
  } catch (error) {
    console.error('[soft-ai/waiting-sweep] periodic sweep failed', error instanceof Error ? error.name : 'unknown')
  }
  kickQueuedJobs(jobIds)
  return out
}
