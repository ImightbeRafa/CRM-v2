/**
 * Per-agent settings (SQL 049 side table "ChatAgentSettings"). Fail-safe: when the table is missing or the
 * agent has no row, every value falls back to the SAFE default (no per-agent cap beyond the tenant's, no order
 * ownership beyond chat links, tenant_default does not answer unbound channels).
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'

const TABLE = 'ChatAgentSettings'

export type AgentOrderOwnership = {
  /** Order.salesChannel values that belong to this agent's business (case-insensitive). */
  salesChannels: string[]
  /** Order.funnel values (what /ventas sets). */
  funnels: string[]
  /** customFields.source values (what website integrations set, e.g. "Prototipo CR Website"). */
  sources: string[]
}

export type AgentOrderDefaults = {
  seller: string | null
  shippingMethodId: string | null
  stamp: { salesChannel: string | null; funnel: string | null }
}

export type AgentSettings = {
  dailyTokenCap: number | null
  orderOwnership: AgentOrderOwnership
  orderDefaults: AgentOrderDefaults
  servesUnboundChannels: boolean
}

const MAX_VALUES = 20
const MAX_LEN = 120

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.trim().slice(0, MAX_LEN)
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= MAX_VALUES) break
  }
  return out
}

function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().slice(0, MAX_LEN)
  return t || null
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export function parseOrderOwnership(raw: unknown): AgentOrderOwnership {
  const r = asRecord(raw)
  return { salesChannels: cleanList(r.salesChannels), funnels: cleanList(r.funnels), sources: cleanList(r.sources) }
}

export function parseOrderDefaults(raw: unknown): AgentOrderDefaults {
  const r = asRecord(raw)
  const stamp = asRecord(r.stamp)
  return {
    seller: cleanText(r.seller),
    shippingMethodId: cleanText(r.shippingMethodId),
    stamp: { salesChannel: cleanText(stamp.salesChannel), funnel: cleanText(stamp.funnel) },
  }
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  dailyTokenCap: null,
  orderOwnership: { salesChannels: [], funnels: [], sources: [] },
  orderDefaults: { seller: null, shippingMethodId: null, stamp: { salesChannel: null, funnel: null } },
  servesUnboundChannels: false,
}

export function hasOwnershipStamp(o: AgentOrderOwnership): boolean {
  return o.salesChannels.length + o.funnels.length + o.sources.length > 0
}

/** Does this order carry one of the agent's business stamps? Empty stamp never matches. */
export function orderMatchesOwnership(
  o: AgentOrderOwnership,
  order: { salesChannel?: string | null; funnel?: string | null; customFields?: unknown },
): boolean {
  const eq = (list: string[], v: unknown) =>
    typeof v === 'string' && v.trim() !== '' && list.some((x) => x.toLowerCase() === v.trim().toLowerCase())
  if (eq(o.salesChannels, order.salesChannel)) return true
  if (eq(o.funnels, order.funnel)) return true
  return eq(o.sources, asRecord(order.customFields).source)
}

export async function loadAgentSettings(tenantId: string, agentId: string): Promise<AgentSettings> {
  if (!(await isTableReady(TABLE))) return DEFAULT_AGENT_SETTINGS
  try {
    const rows = await prisma.$queryRaw<
      Array<{ dailyTokenCap: number | null; orderOwnership: unknown; orderDefaults: unknown; servesUnboundChannels: boolean }>
    >`
      SELECT "dailyTokenCap", "orderOwnership", "orderDefaults", "servesUnboundChannels"
        FROM "ChatAgentSettings"
       WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId}
       LIMIT 1`
    const row = rows[0]
    if (!row) return DEFAULT_AGENT_SETTINGS
    return {
      dailyTokenCap: typeof row.dailyTokenCap === 'number' && row.dailyTokenCap > 0 ? row.dailyTokenCap : null,
      orderOwnership: parseOrderOwnership(row.orderOwnership),
      orderDefaults: parseOrderDefaults(row.orderDefaults),
      servesUnboundChannels: row.servesUnboundChannels === true,
    }
  } catch (error) {
    if (isMissingRelation(error)) return DEFAULT_AGENT_SETTINGS
    throw error
  }
}

/** Agents (of this tenant) explicitly allowed to answer channels that have no agent of their own. */
export async function agentsServingUnboundChannels(tenantId: string): Promise<Set<string>> {
  if (!(await isTableReady(TABLE))) return new Set()
  try {
    const rows = await prisma.$queryRaw<Array<{ agentId: string }>>`
      SELECT "agentId" FROM "ChatAgentSettings"
       WHERE "tenantId" = ${tenantId} AND "servesUnboundChannels" = true`
    return new Set(rows.map((r) => r.agentId))
  } catch (error) {
    if (isMissingRelation(error)) return new Set()
    throw error
  }
}

export type AgentSettingsPatch = Partial<{
  dailyTokenCap: number | null
  orderOwnership: AgentOrderOwnership
  orderDefaults: AgentOrderDefaults
  servesUnboundChannels: boolean
}>

export class AgentSettingsNotReadyError extends Error {
  constructor() {
    super('AGENT_SETTINGS_NOT_READY')
    this.name = 'AgentSettingsNotReadyError'
  }
}

/** Upsert (caller already checked the agent belongs to tenantId and the user may edit it). */
export async function saveAgentSettings(
  tenantId: string,
  agentId: string,
  patch: AgentSettingsPatch,
  userId: string,
): Promise<AgentSettings> {
  if (!(await isTableReady(TABLE))) throw new AgentSettingsNotReadyError()
  const current = await loadAgentSettings(tenantId, agentId)
  const next: AgentSettings = {
    dailyTokenCap:
      patch.dailyTokenCap === undefined
        ? current.dailyTokenCap
        : patch.dailyTokenCap && patch.dailyTokenCap > 0
          ? Math.min(Math.max(1, Math.floor(patch.dailyTokenCap)), 50_000_000)
          : null,
    orderOwnership: patch.orderOwnership ? parseOrderOwnership(patch.orderOwnership) : current.orderOwnership,
    orderDefaults: patch.orderDefaults ? parseOrderDefaults(patch.orderDefaults) : current.orderDefaults,
    servesUnboundChannels:
      patch.servesUnboundChannels === undefined ? current.servesUnboundChannels : patch.servesUnboundChannels === true,
  }
  await prisma.$executeRaw`
    INSERT INTO "ChatAgentSettings"
      ("agentId", "tenantId", "dailyTokenCap", "orderOwnership", "orderDefaults", "servesUnboundChannels", "updatedBy", "updatedAt")
    VALUES (${agentId}, ${tenantId}, ${next.dailyTokenCap}, ${JSON.stringify(next.orderOwnership)}::jsonb,
            ${JSON.stringify(next.orderDefaults)}::jsonb, ${next.servesUnboundChannels}, ${userId}, NOW())
    ON CONFLICT ("agentId") DO UPDATE SET
      "dailyTokenCap" = EXCLUDED."dailyTokenCap",
      "orderOwnership" = EXCLUDED."orderOwnership",
      "orderDefaults" = EXCLUDED."orderDefaults",
      "servesUnboundChannels" = EXCLUDED."servesUnboundChannels",
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
    WHERE "ChatAgentSettings"."tenantId" = ${tenantId}`
  return next
}
