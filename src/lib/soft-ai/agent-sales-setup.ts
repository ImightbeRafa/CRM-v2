/**
 * Per-agent selling setup (SQL 053 columns on "ChatAgentSettings"): which of the business's shipping methods this
 * agent offers, and the owner's selling script. Fail-safe: before 053 is applied every agent offers all active
 * methods and has no script. Values come from the business (Studio draft or the owner's edits), never hardcoded.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isColumnReady, isTableReady } from '@/lib/soft-ai/table-ready'

export type SalesRules = {
  voice: string | null
  /** If a client asks "¿sos un bot?": discreet = never says it, never denies it; transparent = says it's the store's virtual assistant. */
  aiDisclosure: 'discreet' | 'transparent'
  closing: string | null
  upsells: string | null
  objections: string | null
  handoffWhen: string | null
  mustSay: string[]
  neverSay: string[]
}
export type SalesSetup = { offeredShippingMethodIds: string[]; salesRules: SalesRules }

export const EMPTY_SALES_RULES: SalesRules = {
  voice: null,
  aiDisclosure: 'discreet',
  closing: null,
  upsells: null,
  objections: null,
  handoffWhen: null,
  mustSay: [],
  neverSay: [],
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const list = (v: unknown, n: number, max: number) =>
  Array.isArray(v) ? v.map((x) => text(x, max)).filter((x): x is string => Boolean(x)).slice(0, n) : []

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
    mustSay: list(r.mustSay, 10, 200),
    neverSay: list(r.neverSay, 10, 200),
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

export async function loadSalesSetup(tenantId: string, agentId: string): Promise<SalesSetup> {
  if (!(await ready())) return { offeredShippingMethodIds: [], salesRules: EMPTY_SALES_RULES }
  const rows = await prisma.$queryRaw<Array<{ offeredShippingMethodIds: string[] | null; salesRules: unknown }>>`
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

/** Upsert (caller checked agent ∈ tenant + edit permission). Method ids are filtered to the tenant's own. */
export async function saveSalesSetup(
  tenantId: string,
  agentId: string,
  patch: Partial<{ offeredShippingMethodIds: string[]; salesRules: Partial<SalesRules> }>,
  userId: string,
): Promise<SalesSetup> {
  if (!(await ready())) throw new SalesSetupNotReadyError()
  const current = await loadSalesSetup(tenantId, agentId)
  let ids = current.offeredShippingMethodIds
  if (patch.offeredShippingMethodIds) {
    const wanted = patch.offeredShippingMethodIds.filter((x) => typeof x === 'string').slice(0, 20)
    const own = await prisma.shippingMethod.findMany({ where: { tenantId, id: { in: wanted } }, select: { id: true } })
    const ownSet = new Set(own.map((m) => m.id))
    ids = wanted.filter((x) => ownSet.has(x))
  }
  const rules = patch.salesRules ? parseSalesRules({ ...current.salesRules, ...patch.salesRules }) : current.salesRules
  await prisma.$executeRaw`
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
