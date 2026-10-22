/**
 * AI credits storage (SQL 060) + the reads that turn AiUsageEvent (SQL 048) into billed usage.
 * Every function takes the tenant id from its caller (the session or a verified webhook row), never from a body.
 * Before SQL 060 is applied: reads return defaults with `ready: false`, writes throw AiBillingNotReadyError.
 *
 * Exactly-once usage: usage is never copied per event. The current month is summed at read time from
 * AiUsageEvent (unique sourceKey there); a closed month is written once as a `usage_settle` ledger row
 * (sourceKey `usage:<tenant>:<period>`, UNIQUE) under a per-tenant advisory lock.
 */
import 'server-only'

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { costaRicaPeriodKey } from '@/lib/ai-usage/period'
import {
  BILLABLE_FEATURES,
  DEFAULT_PACKS,
  DEFAULT_RATE,
  billedFromList,
  decidePurchaseWebhook,
  isPeriodKey,
  nextPeriodKey,
  normalizePacks,
  rateForPeriod,
  settleAmount,
  type AiBillingRate,
  type CreditPack,
} from './math'

export const AI_BILLING_TABLES = ['AiBillingRate', 'AiBillingSettings', 'AiCreditLedger', 'AiCreditPurchase', 'AiTenantSpendLimit'] as const

export class AiBillingNotReadyError extends Error {
  constructor() {
    super('AI_BILLING_NOT_READY')
    this.name = 'AiBillingNotReadyError'
  }
}

export async function aiBillingReady(): Promise<boolean> {
  for (const t of AI_BILLING_TABLES) if (!(await isTableReady(t))) return false
  return true
}

async function requireReady() {
  if (!(await aiBillingReady())) throw new AiBillingNotReadyError()
}

/** "2026-10" → UTC instant the Costa Rica month starts (06:00 UTC on the 1st; CR is UTC-6, no DST). */
export function periodStartUtc(periodKey: string): Date {
  const [y, m] = periodKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1, 6))
}

const num = (v: unknown) => Number(v ?? 0)

// ── Rates & settings ────────────────────────────────────────────────────────────────────────────────

export type AiBillingSettings = {
  packs: CreditPack[]
  ceilingMicros: number | null
  /** Off = display only: credits and limits never pause the AI. */
  enforce: boolean
  /** First month that is settled against the balance (null = nothing settled yet). */
  cutoverPeriod: string | null
}

const DEFAULT_SETTINGS: AiBillingSettings = { packs: DEFAULT_PACKS, ceilingMicros: null, enforce: false, cutoverPeriod: null }
const CACHE_MS = 60_000
let ratesCache: { at: number; rows: AiBillingRate[] } | null = null
let settingsCache: { at: number; value: AiBillingSettings } | null = null

export function clearAiBillingCache() {
  ratesCache = null
  settingsCache = null
}

export async function listRates(): Promise<AiBillingRate[]> {
  if (ratesCache && Date.now() - ratesCache.at < CACHE_MS) return ratesCache.rows
  if (!(await aiBillingReady())) return []
  const rows = await prisma.$queryRaw<Array<{ periodKey: string; markupBps: number; freeMonthlyMicros: bigint }>>`
    SELECT "periodKey", "markupBps", "freeMonthlyMicros" FROM "AiBillingRate" ORDER BY "periodKey"`
  const out = rows.map((r) => ({ periodKey: r.periodKey, markupBps: num(r.markupBps), freeMonthlyMicros: num(r.freeMonthlyMicros) }))
  ratesCache = { at: Date.now(), rows: out }
  return out
}

export async function getSettings(): Promise<AiBillingSettings> {
  if (settingsCache && Date.now() - settingsCache.at < CACHE_MS) return settingsCache.value
  if (!(await aiBillingReady())) return DEFAULT_SETTINGS
  const rows = await prisma.$queryRaw<Array<{ packs: unknown; ceilingMicros: bigint | null; enforce: boolean; cutoverPeriod: string | null }>>`
    SELECT "packs", "ceilingMicros", "enforce", "cutoverPeriod" FROM "AiBillingSettings" WHERE "id" = 'default' LIMIT 1`
  const r = rows[0]
  const value: AiBillingSettings = r
    ? {
        packs: normalizePacks(r.packs) ?? DEFAULT_PACKS,
        ceilingMicros: r.ceilingMicros === null ? null : num(r.ceilingMicros),
        enforce: r.enforce === true,
        cutoverPeriod: isPeriodKey(r.cutoverPeriod) ? r.cutoverPeriod : null,
      }
    : DEFAULT_SETTINGS
  settingsCache = { at: Date.now(), value }
  return value
}

/** Owner: packs, ceiling, enforcement. Turning enforcement on without a cutover starts settling this month. */
export async function saveSettings(input: AiBillingSettings & { updatedBy: string }, now = new Date()): Promise<void> {
  await requireReady()
  const cutover = input.cutoverPeriod ?? (input.enforce ? costaRicaPeriodKey(now) : null)
  await prisma.$executeRaw`
    INSERT INTO "AiBillingSettings" ("id", "packs", "ceilingMicros", "enforce", "cutoverPeriod", "updatedBy", "updatedAt")
    VALUES ('default', ${JSON.stringify(input.packs)}::jsonb, ${input.ceilingMicros}, ${input.enforce}, ${cutover}, ${input.updatedBy}, NOW())
    ON CONFLICT ("id") DO UPDATE SET
      "packs" = EXCLUDED."packs", "ceilingMicros" = EXCLUDED."ceilingMicros", "enforce" = EXCLUDED."enforce",
      "cutoverPeriod" = COALESCE("AiBillingSettings"."cutoverPeriod", EXCLUDED."cutoverPeriod"),
      "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW()`
  clearAiBillingCache()
}

/**
 * Owner: new markup / free credit. Takes effect NEXT Costa Rica month so a started month is never repriced;
 * `effectiveNow` (emergencies only, logged by the caller) rewrites the current month's row instead.
 */
export async function saveRate(input: { markupBps: number; freeMonthlyMicros: number; effectiveNow: boolean; createdBy: string }, now = new Date()) {
  await requireReady()
  const current = costaRicaPeriodKey(now)
  const periodKey = input.effectiveNow ? current : nextPeriodKey(current)
  await prisma.$executeRaw`
    INSERT INTO "AiBillingRate" ("periodKey", "markupBps", "freeMonthlyMicros", "createdBy", "createdAt")
    VALUES (${periodKey}, ${input.markupBps}, ${input.freeMonthlyMicros}, ${input.createdBy}, NOW())
    ON CONFLICT ("periodKey") DO UPDATE SET
      "markupBps" = EXCLUDED."markupBps", "freeMonthlyMicros" = EXCLUDED."freeMonthlyMicros",
      "createdBy" = EXCLUDED."createdBy", "createdAt" = NOW()`
  clearAiBillingCache()
  return { periodKey }
}

// ── Usage ───────────────────────────────────────────────────────────────────────────────────────────

/** Σ list cost of billable features for one business and one Costa Rica month (index: tenant + createdAt). */
export async function monthListMicros(tenantId: string, periodKey: string): Promise<number> {
  if (!(await isTableReady('AiUsageEvent'))) return 0
  const from = periodStartUtc(periodKey)
  const to = periodStartUtc(nextPeriodKey(periodKey))
  const rows = await prisma.$queryRaw<Array<{ list: bigint | null }>>`
    SELECT COALESCE(SUM("costMicros"), 0)::bigint AS "list"
      FROM "AiUsageEvent"
     WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${from} AND "createdAt" < ${to}
       AND "feature" = ANY(${[...BILLABLE_FEATURES]}::text[])`
  return num(rows[0]?.list)
}

export type DailyUsageRow = { day: string; feature: string; agentId: string | null; events: number; listMicros: number }

/** Per Costa Rica day × feature × agent for one month (all features; the page marks the included ones). */
export async function monthDailyUsage(tenantId: string, periodKey: string): Promise<DailyUsageRow[]> {
  if (!(await isTableReady('AiUsageEvent'))) return []
  const from = periodStartUtc(periodKey)
  const to = periodStartUtc(nextPeriodKey(periodKey))
  const rows = await prisma.$queryRaw<Array<{ day: string; feature: string; agentId: string | null; events: bigint; list: bigint }>>`
    SELECT to_char("createdAt" - interval '6 hours', 'YYYY-MM-DD') AS "day", "feature", "agentId",
           COUNT(*)::bigint AS "events", COALESCE(SUM("costMicros"), 0)::bigint AS "list"
      FROM "AiUsageEvent"
     WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${from} AND "createdAt" < ${to}
     GROUP BY 1, 2, 3
     ORDER BY 1, 2`
  return rows.map((r) => ({ day: r.day, feature: r.feature, agentId: r.agentId, events: num(r.events), listMicros: num(r.list) }))
}

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────────────

export async function ledgerBalance(tenantId: string): Promise<number> {
  if (!(await aiBillingReady())) return 0
  const rows = await prisma.$queryRaw<Array<{ bal: bigint | null }>>`
    SELECT COALESCE(SUM("amountMicros"), 0)::bigint AS "bal" FROM "AiCreditLedger" WHERE "tenantId" = ${tenantId}`
  return num(rows[0]?.bal)
}

export type LedgerRow = { id: string; kind: string; amountMicros: number; periodKey: string | null; note: string | null; createdAt: string }

export async function listLedger(tenantId: string, limit = 50): Promise<LedgerRow[]> {
  if (!(await aiBillingReady())) return []
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; amountMicros: bigint; periodKey: string | null; note: string | null; createdAt: Date }>>`
    SELECT "id", "kind", "amountMicros", "periodKey", "note", "createdAt"
      FROM "AiCreditLedger" WHERE "tenantId" = ${tenantId} ORDER BY "createdAt" DESC LIMIT ${limit}`
  return rows.map((r) => ({ id: r.id, kind: r.kind, amountMicros: num(r.amountMicros), periodKey: r.periodKey, note: r.note, createdAt: r.createdAt.toISOString() }))
}

/**
 * Write the `usage_settle` row of every closed month since the cutover that has none yet (oldest first, at most 12
 * per call). Per-tenant advisory lock + UNIQUE sourceKey: concurrent readers settle a month exactly once.
 */
export async function settleClosedMonths(tenantId: string, now = new Date()): Promise<number> {
  const settings = await getSettings()
  if (!settings.cutoverPeriod || !(await aiBillingReady())) return 0
  const current = costaRicaPeriodKey(now)
  const periods: string[] = []
  for (let p = settings.cutoverPeriod; p < current && periods.length < 12; p = nextPeriodKey(p)) periods.push(p)
  if (periods.length === 0) return 0
  const keys = periods.map((p) => `usage:${tenantId}:${p}`)
  const done = await prisma.$queryRaw<Array<{ sourceKey: string }>>`
    SELECT "sourceKey" FROM "AiCreditLedger" WHERE "sourceKey" = ANY(${keys}::text[])`
  const settled = new Set(done.map((r) => r.sourceKey))
  const todo = periods.filter((p) => !settled.has(`usage:${tenantId}:${p}`))
  if (todo.length === 0) return 0
  const rates = await listRates()
  let written = 0
  for (const p of todo) {
    const rate = rateForPeriod(rates, p)
    const billed = billedFromList(await monthListMicros(tenantId, p), rate.markupBps)
    written += await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ai-credits:' + tenantId}))`
      const bal = await tx.$queryRaw<Array<{ bal: bigint | null }>>`
        SELECT COALESCE(SUM("amountMicros"), 0)::bigint AS "bal" FROM "AiCreditLedger" WHERE "tenantId" = ${tenantId}`
      const s = settleAmount({ billedMicros: billed, freeMicros: rate.freeMonthlyMicros, balanceBeforeMicros: num(bal[0]?.bal) })
      const note = `Uso ${p}: ${billed} facturado, ${rate.freeMonthlyMicros} gratis${s.forgivenMicros > 0 ? `, ${s.forgivenMicros} sin cobrar` : ''}`
      return tx.$executeRaw`
        INSERT INTO "AiCreditLedger" ("id", "tenantId", "kind", "amountMicros", "periodKey", "sourceKey", "note", "createdBy")
        VALUES (${randomUUID()}, ${tenantId}, 'usage_settle', ${s.amountMicros}, ${p}, ${`usage:${tenantId}:${p}`}, ${note.slice(0, 200)}, 'system')
        ON CONFLICT ("sourceKey") DO NOTHING`
    })
  }
  return written
}

/** Owner: manual credit (+) or correction (−). `sourceKey` from the caller makes a retried request a no-op. */
export async function addAdjustment(input: { tenantId: string; amountMicros: number; note: string; createdBy: string; requestId: string }) {
  await requireReady()
  return prisma.$executeRaw`
    INSERT INTO "AiCreditLedger" ("id", "tenantId", "kind", "amountMicros", "sourceKey", "note", "createdBy")
    VALUES (${randomUUID()}, ${input.tenantId}, 'adjustment', ${input.amountMicros}, ${`adjust:${input.requestId}`}, ${input.note.slice(0, 200)}, ${input.createdBy})
    ON CONFLICT ("sourceKey") DO NOTHING`
}

// ── Business limit ──────────────────────────────────────────────────────────────────────────────────

export async function getTenantLimit(tenantId: string): Promise<number | null> {
  if (!(await aiBillingReady())) return null
  const rows = await prisma.$queryRaw<Array<{ m: bigint }>>`
    SELECT "monthlyLimitMicros" AS "m" FROM "AiTenantSpendLimit" WHERE "tenantId" = ${tenantId} LIMIT 1`
  return rows[0] ? num(rows[0].m) : null
}

/** null clears the limit. The caller clamps to the owner's ceiling. */
export async function setTenantLimit(tenantId: string, micros: number | null, updatedBy: string): Promise<void> {
  await requireReady()
  if (micros === null) {
    await prisma.$executeRaw`DELETE FROM "AiTenantSpendLimit" WHERE "tenantId" = ${tenantId}`
    return
  }
  await prisma.$executeRaw`
    INSERT INTO "AiTenantSpendLimit" ("tenantId", "monthlyLimitMicros", "updatedBy", "updatedAt")
    VALUES (${tenantId}, ${micros}, ${updatedBy}, NOW())
    ON CONFLICT ("tenantId") DO UPDATE SET "monthlyLimitMicros" = EXCLUDED."monthlyLimitMicros",
      "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW()`
}

// ── Purchases ───────────────────────────────────────────────────────────────────────────────────────

export type PurchaseRow = {
  id: string
  packId: string
  creditMicros: number
  priceCents: number
  ivaCents: number
  totalCents: number
  status: string
  createdAt: string
  paidAt: string | null
}

export async function listPurchases(tenantId: string, limit = 20): Promise<PurchaseRow[]> {
  if (!(await aiBillingReady())) return []
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "packId", "creditMicros", "priceCents", "ivaCents", "totalCents", "status", "createdAt", "paidAt"
      FROM "AiCreditPurchase" WHERE "tenantId" = ${tenantId} ORDER BY "createdAt" DESC LIMIT ${limit}`
  return rows.map((r) => ({
    id: String(r.id),
    packId: String(r.packId),
    creditMicros: num(r.creditMicros),
    priceCents: num(r.priceCents),
    ivaCents: num(r.ivaCents),
    totalCents: num(r.totalCents),
    status: String(r.status),
    createdAt: (r.createdAt as Date).toISOString(),
    paidAt: r.paidAt ? (r.paidAt as Date).toISOString() : null,
  }))
}

/** Pending checkouts of this business in the last 24 h (checkout refuses more than a few). */
export async function recentPendingPurchases(tenantId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS "n" FROM "AiCreditPurchase"
     WHERE "tenantId" = ${tenantId} AND "status" = 'pending' AND "createdAt" > NOW() - interval '24 hours'`
  return num(rows[0]?.n)
}

export async function createPendingPurchase(input: {
  tenantId: string
  packId: string
  creditMicros: number
  priceCents: number
  ivaCents: number
  totalCents: number
  createdBy: string
}): Promise<{ id: string; ref: string }> {
  await requireReady()
  const id = randomUUID()
  // Unguessable reference: it is the only thing Tilopay echoes back to identify the purchase.
  const ref = `aicr_${randomUUID().replace(/-/g, '')}`
  await prisma.$executeRaw`
    INSERT INTO "AiCreditPurchase" ("id", "tenantId", "packId", "creditMicros", "priceCents", "ivaCents", "totalCents", "ref", "createdBy")
    VALUES (${id}, ${input.tenantId}, ${input.packId}, ${input.creditMicros}, ${input.priceCents}, ${input.ivaCents}, ${input.totalCents}, ${ref}, ${input.createdBy})`
  return { id, ref }
}

export async function deletePendingPurchase(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "AiCreditPurchase" WHERE "id" = ${id} AND "status" = 'pending'`
}

export type PaymentOutcome =
  | { result: 'credited'; tenantId: string; creditMicros: number }
  | { result: 'already_paid' }
  | { result: 'unknown_ref' }
  | { result: 'mismatch' }
  | { result: 'failed_marked' }
  | { result: 'ignored' }

/**
 * Webhook side, after the Tilopay signature check. Approved + amount AND currency equal to the server price →
 * mark paid and credit the ledger in ONE transaction (sourceKey `purchase:<id>`). Replays and duplicates are no-ops.
 * A transaction id already used by another purchase never credits twice (UNIQUE "transactionId").
 */
export async function applyPurchaseWebhook(input: {
  ref: string
  approved: boolean
  declined: boolean
  amountCents: number
  currency: string
  transactionId: string | null
}): Promise<PaymentOutcome> {
  await requireReady()
  const rows = await prisma.$queryRaw<Array<{ id: string; tenantId: string; totalCents: number; creditMicros: bigint; status: string; packId: string }>>`
    SELECT "id", "tenantId", "totalCents", "creditMicros", "status", "packId" FROM "AiCreditPurchase" WHERE "ref" = ${input.ref} LIMIT 1`
  const p = rows[0]
  const action = decidePurchaseWebhook({
    purchase: p ? { status: p.status, totalCents: num(p.totalCents) } : null,
    approved: input.approved,
    declined: input.declined,
    amountCents: input.amountCents,
    currency: input.currency,
    transactionId: input.transactionId,
  })
  if (action === 'unknown_ref' || !p) return { result: 'unknown_ref' }
  if (action === 'already_paid') return { result: 'already_paid' }
  if (action === 'ignore') return { result: 'ignored' }
  if (action === 'mismatch') return { result: 'mismatch' }
  if (action === 'mark_failed') {
    await prisma.$executeRaw`UPDATE "AiCreditPurchase" SET "status" = 'failed' WHERE "id" = ${p.id} AND "status" = 'pending'`
    return { result: 'failed_marked' }
  }
  const credit = num(p.creditMicros)
  try {
    return await prisma.$transaction(async (tx) => {
      // A late approval after a decline still pays: Tilopay is the source of truth for the money.
      const updated = await tx.$executeRaw`
        UPDATE "AiCreditPurchase" SET "status" = 'paid', "transactionId" = ${input.transactionId}, "paidAt" = NOW()
         WHERE "id" = ${p.id} AND "status" IN ('pending', 'failed')`
      if (updated !== 1) return { result: 'already_paid' as const }
      await tx.$executeRaw`
        INSERT INTO "AiCreditLedger" ("id", "tenantId", "kind", "amountMicros", "sourceKey", "note", "createdBy")
        VALUES (${randomUUID()}, ${p.tenantId}, 'purchase', ${credit}, ${`purchase:${p.id}`}, ${`Paquete ${p.packId}`}, 'tilopay')
        ON CONFLICT ("sourceKey") DO NOTHING`
      return { result: 'credited' as const, tenantId: p.tenantId, creditMicros: credit }
    })
  } catch (error) {
    // Same Tilopay transaction id on another purchase (replayed proof) → never credit.
    if (error instanceof Error && /AiCreditPurchase_transaction_key|unique/i.test(error.message)) return { result: 'mismatch' }
    throw error
  }
}

/** True when a raw-SQL error only means SQL 060 is missing (routes answer "not ready" instead of 500). */
export function isBillingTableMissing(error: unknown): boolean {
  return error instanceof AiBillingNotReadyError || isMissingRelation(error)
}
