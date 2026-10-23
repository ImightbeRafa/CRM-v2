/**
 * Per-agent selling setup (SQL 053 columns on "ChatAgentSettings"): which of the business's shipping methods this
 * agent offers, and the owner's selling script. Fail-safe: before 053 is applied every agent offers all active
 * methods and has no script. Values come from the business (Studio draft or the owner's edits), never hardcoded.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { isColumnReady, isTableReady } from '@/lib/soft-ai/table-ready'
import { EMPTY_PROMO, headlineHasNumberWords, parsePromo, type AgentPromo } from '@/lib/soft-ai/promo'
import { dealProblem } from '@/lib/soft-ai/llm/output-validator'
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import { DEFAULT_REPLY_PACE, parseReplyPace, type ReplyPace } from '@/lib/soft-ai/reply-pace'
import { DEFAULT_BUSINESS_HOURS, parseBusinessHours, type BusinessHours } from '@/lib/soft-ai/business-hours'

export type SalesRules = {
  voice: string | null
  /** If a client asks "¿sos un bot?": discreet = never says it, never denies it; transparent = says it's the store's virtual assistant. */
  aiDisclosure: 'discreet' | 'transparent'
  /** agents2-pace: how fast the reply goes out in a real chat (reply-pace.ts). Missing / unknown = 'natural'. */
  replyPace?: ReplyPace
  /** agents2-pace: WhatsApp "escribiendo…" before a paced message (marks the message read). Missing = on. */
  typingIndicator?: boolean
  /** agents2-hours: "Horario de atención" (business-hours.ts). Missing / invalid = off (24/7). */
  businessHours?: BusinessHours
  /**
   * luna-10 (Rafael 2026-10-17): outside the business hours the agent introduces itself as the virtual assistant
   * ('transparent'), even when it is discreet in the day. 'same' (default) = the night follows aiDisclosure.
   */
  afterHoursDisclosure?: 'same' | 'transparent'
  closing: string | null
  upsells: string | null
  objections: string | null
  handoffWhen: string | null
  mustSay: string[]
  neverSay: string[]
  /**
   * Betsy's own agent (Rafael 2026-10-23): a true hand-off also opens a ticket in Betsy's support pipeline
   * (support-escalation.ts). Default off; only honoured for businesses listed in SUPPORT_AI_CHAT_TENANTS.
   */
  escalateToSupport?: boolean
  /** Owner-configured active promotion (promo.ts). Part of the type so saving the script never wipes it. */
  promo: AgentPromo
  /** Owner's combos at a fixed total (quoted only as listed). Optional so older callers keep compiling. */
  bundles?: SalesRuleBundle[]
}
/** shippingIncluded: the owner says this combo's total already includes shipping (never inferred from a threshold). */
export type SalesRuleBundle = { name: string; price: number; shippingIncluded: boolean }
export const BUNDLE_NAME_MAX = 60

export const MAX_BUNDLES = 8
/** SQL 053 CHECK: octet_length("salesRules"::text) <= 8000. */
export const SALES_RULES_MAX_OCTETS = 8000

export class SalesRulesTooLargeError extends Error {
  constructor() {
    super('SALES_RULES_TOO_LARGE')
    this.name = 'SalesRulesTooLargeError'
  }
}

/** Size of the jsonb text Postgres checks: jsonb::text adds one space after every ':' and ',' outside strings. */
export function salesRulesOctets(rules: SalesRules): number {
  const json = JSON.stringify(rules)
  let separators = 0
  let inString = false
  for (let i = 0; i < json.length; i += 1) {
    const c = json[i]
    if (inString) {
      if (c === '\\') i += 1
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === ':' || c === ',') separators += 1
  }
  return Buffer.byteLength(json, 'utf8') + separators
}

/**
 * Combos the owner sells at a fixed total. Names are shown to the model as data, so they must read like a product
 * name and nothing else: no amounts in words, deal / free-shipping / confirmation wording, markers or sentence
 * punctuation that could pose as a rule (INT-77, INT-87). Refused names drop the combo.
 */
export function bundleNameAllowed(name: string): boolean {
  if (!name || name.length > BUNDLE_NAME_MAX) return false
  if (/[\[\]<>{}:;.\n\r«»"`]/.test(name)) return false
  if (headlineHasNumberWords(name) || dealProblem(name, []) || hasConfirmationWording(name)) return false
  if (/\bantes\b|ahorr|regla|confirm|pag[oóa]|gratis|incluid|env[ií]o/i.test(name)) return false
  return true
}

export function parseBundles(raw: unknown): SalesRuleBundle[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .filter((x) => typeof x.name === 'string' && typeof x.price === 'number' && Number.isFinite(x.price))
    .filter((x) => (x.price as number) > 0 && (x.price as number) < 100_000_000)
    .map((x) => ({
      name: String(x.name).replace(/\s+/g, ' ').trim(),
      price: Math.round(x.price as number),
      shippingIncluded: x.shippingIncluded === true,
    }))
    .filter((b) => bundleNameAllowed(b.name))
    .slice(0, MAX_BUNDLES)
}
export type SalesSetup = { offeredShippingMethodIds: string[]; salesRules: SalesRules }

export const EMPTY_SALES_RULES: SalesRules = {
  voice: null,
  aiDisclosure: 'discreet',
  replyPace: DEFAULT_REPLY_PACE,
  typingIndicator: true,
  businessHours: DEFAULT_BUSINESS_HOURS,
  afterHoursDisclosure: 'same',
  closing: null,
  upsells: null,
  objections: null,
  handoffWhen: null,
  mustSay: [],
  neverSay: [],
  promo: EMPTY_PROMO,
  bundles: [],
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const list = (v: unknown, n: number, max: number) =>
  Array.isArray(v) ? v.map((x) => text(x, max)).filter((x): x is string => Boolean(x)).slice(0, n) : []

/**
 * The support-escalation flag after a pack rebuild (build-agent): the pack's value when the pack names the key (true or
 * false), else the live one — a rebuild never silently turns it off (Verifier #146).
 */
export function packEscalationFlag(packSalesRules: Record<string, unknown>, live: SalesRules): boolean {
  return 'escalateToSupport' in packSalesRules ? packSalesRules.escalateToSupport === true : live.escalateToSupport === true
}

/** Bounded so the jsonb stays under the 8 KB CHECK. */
export function parseSalesRules(raw: unknown): SalesRules {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    voice: text(r.voice, 600),
    closing: text(r.closing, 800),
    upsells: text(r.upsells, 800),
    objections: text(r.objections, 1200),
    handoffWhen: text(r.handoffWhen, 800),
    aiDisclosure: r.aiDisclosure === 'transparent' ? 'transparent' : 'discreet',
    replyPace: parseReplyPace(r.replyPace),
    typingIndicator: r.typingIndicator !== false,
    businessHours: parseBusinessHours(r.businessHours),
    afterHoursDisclosure: r.afterHoursDisclosure === 'transparent' ? 'transparent' : 'same',
    mustSay: list(r.mustSay, 10, 200),
    neverSay: list(r.neverSay, 10, 200),
    promo: parsePromo(r.promo),
    bundles: parseBundles(r.bundles),
    // Stored only when on (the 8 KB CHECK): Betsy's own agent → support pipeline (support-escalation.ts).
    ...(r.escalateToSupport === true ? { escalateToSupport: true } : {}),
  }
}

export function salesRulesForPrompt(r: SalesRules): string {
  const lines = [
    r.voice && `Tono: ${r.voice}`,
    r.closing && `Cómo cerrar la venta: ${r.closing}`,
    r.upsells && `Ofrecer además: ${r.upsells}`,
    r.objections && `Objeciones frecuentes: ${r.objections}`,
    r.handoffWhen && `Avisar al equipo (sin decírselo al cliente) cuando: ${r.handoffWhen}`,
    r.mustSay.length ? `Siempre: ${r.mustSay.join(' · ')}` : '',
    r.neverSay.length ? `Nunca: ${r.neverSay.join(' · ')}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

async function ready(): Promise<boolean> {
  return (await isTableReady('ChatAgentSettings')) && (await isColumnReady('ChatAgentSettings', 'salesRules'))
}

/** The client to read / write with: prisma, or an interactive transaction (agent-tuning.ts rule saves lock the agent row). */
export type SalesSetupDb = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | 'shippingMethod'>

/**
 * `readyChecked`: the caller already ran assertSalesSetupReady() outside its transaction (round 3: no readiness
 * probes inside the locked transaction).
 */
export async function loadSalesSetup(tenantId: string, agentId: string, db: SalesSetupDb = prisma, readyChecked = false): Promise<SalesSetup> {
  if (!readyChecked && !(await ready())) return { offeredShippingMethodIds: [], salesRules: EMPTY_SALES_RULES }
  const rows = await db.$queryRaw<Array<{ offeredShippingMethodIds: string[] | null; salesRules: unknown }>>`
    SELECT "offeredShippingMethodIds", "salesRules" FROM "ChatAgentSettings"
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} LIMIT 1`
  const row = rows[0]
  return {
    offeredShippingMethodIds: Array.isArray(row?.offeredShippingMethodIds) ? row.offeredShippingMethodIds.slice(0, 20) : [],
    salesRules: parseSalesRules(row?.salesRules),
  }
}

export class SalesSetupNotReadyError extends Error {
  constructor() {
    super('SALES_SETUP_NOT_READY')
    this.name = 'SalesSetupNotReadyError'
  }
}

/**
 * Locks the agent row for a read-merge-write of its selling rules (SELECT … FOR UPDATE): every rules save — settings
 * (promo, aiDisclosure), Studio apply, "Corregir" rules — goes through it, so two saves at once never drop a change.
 */
/** Transaction limits for a locked rules save: wait up to 10 s for the lock / a connection, run up to 15 s. */
export const SALES_RULES_TX = { maxWait: 10_000, timeout: 15_000 } as const

/** Readiness, checked ONCE before a locked transaction (never inside it). */
export async function assertSalesSetupReady(): Promise<void> {
  if (!(await ready())) throw new SalesSetupNotReadyError()
}

export async function lockAgentForSalesRules(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, tenantId: string, agentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ChatAgent" WHERE "id" = ${agentId} AND "tenantId" = ${tenantId} FOR UPDATE`
}

/**
 * Upsert (caller checked agent ∈ tenant + edit permission). Method ids are filtered to the tenant's own.
 * Without `db` it checks readiness once, then runs in its own transaction holding the agent row lock; with `db` the
 * caller already checked readiness (assertSalesSetupReady) and its transaction holds the lock (agent-tuning saveRule).
 */
export async function saveSalesSetup(
  tenantId: string,
  agentId: string,
  patch: Partial<{ offeredShippingMethodIds: string[]; salesRules: Partial<SalesRules> }>,
  userId: string,
  db?: SalesSetupDb,
): Promise<SalesSetup> {
  if (!db) {
    await assertSalesSetupReady()
    return prisma.$transaction(async (tx) => {
      await lockAgentForSalesRules(tx, tenantId, agentId)
      return saveSalesSetup(tenantId, agentId, patch, userId, tx)
    }, SALES_RULES_TX)
  }
  const current = await loadSalesSetup(tenantId, agentId, db, true)
  let ids = current.offeredShippingMethodIds
  if (patch.offeredShippingMethodIds) {
    const wanted = patch.offeredShippingMethodIds.filter((x) => typeof x === 'string').slice(0, 20)
    const own = await db.shippingMethod.findMany({ where: { tenantId, id: { in: wanted } }, select: { id: true } })
    const ownSet = new Set(own.map((m) => m.id))
    ids = wanted.filter((x) => ownSet.has(x))
  }
  const rules = patch.salesRules ? parseSalesRules({ ...current.salesRules, ...patch.salesRules }) : current.salesRules
  // A clean error instead of the raw CHECK violation (all field caps together can pass 8 000 bytes).
  if (salesRulesOctets(rules) > SALES_RULES_MAX_OCTETS) throw new SalesRulesTooLargeError()
  await db.$executeRaw`
    INSERT INTO "ChatAgentSettings" ("agentId", "tenantId", "offeredShippingMethodIds", "salesRules", "updatedBy", "updatedAt")
    VALUES (${agentId}, ${tenantId}, ${ids}::text[], ${JSON.stringify(rules)}::jsonb, ${userId}, NOW())
    ON CONFLICT ("agentId") DO UPDATE SET
      "offeredShippingMethodIds" = EXCLUDED."offeredShippingMethodIds",
      "salesRules" = EXCLUDED."salesRules",
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
    WHERE "ChatAgentSettings"."tenantId" = ${tenantId}`
  return { offeredShippingMethodIds: ids, salesRules: rules }
}
