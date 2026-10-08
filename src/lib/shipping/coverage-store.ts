/**
 * Tenant-scoped reads/writes of shipping coverage (SQL 053). Only the business's own active shipping methods.
 * Missing table → every method falls back to "all, no contra entrega" (safe: never promises contra entrega).
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { DEFAULT_COVERAGE, normalizePlaces, parseCoverageRow, type MethodCoverage } from '@/lib/shipping/coverage'

const TABLE = 'ShippingMethodCoverage'

export class CoverageNotReadyError extends Error {
  constructor() {
    super('COVERAGE_NOT_READY')
    this.name = 'CoverageNotReadyError'
  }
}

export async function loadCoverage(tenantId: string): Promise<Array<MethodCoverage & { name: string; basePrice: number }>> {
  const methods = await prisma.shippingMethod.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true, basePrice: true },
    orderBy: { name: 'asc' },
    take: 50,
  })
  const rows = (await isTableReady(TABLE))
    ? await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "ShippingMethodCoverage" WHERE "tenantId" = ${tenantId} LIMIT 100`
    : []
  const byId = new Map(rows.map((r) => [String(r.shippingMethodId), parseCoverageRow(r)]))
  return methods.map((m) => ({ ...(byId.get(m.id) ?? DEFAULT_COVERAGE(m.id)), name: m.name, basePrice: Number(m.basePrice) }))
}

export async function saveCoverage(tenantId: string, userId: string, input: Partial<MethodCoverage> & { shippingMethodId: string }) {
  if (!(await isTableReady(TABLE))) throw new CoverageNotReadyError()
  const method = await prisma.shippingMethod.findFirst({ where: { id: input.shippingMethodId, tenantId }, select: { id: true } })
  if (!method) throw new Error('METHOD_NOT_FOUND')
  const c = { ...DEFAULT_COVERAGE(method.id), ...input }
  const coverage = c.coverage === 'gam' || c.coverage === 'list' ? c.coverage : 'all'
  const codCoverage = c.codCoverage === 'gam' || c.codCoverage === 'list' ? c.codCoverage : 'same'
  const places = normalizePlaces(c.places)
  const codPlaces = normalizePlaces(c.codPlaces)
  await prisma.$executeRaw`
    INSERT INTO "ShippingMethodCoverage"
      ("shippingMethodId", "tenantId", "coverage", "places", "allowsCod", "codCoverage", "codPlaces", "updatedBy", "updatedAt")
    VALUES (${method.id}, ${tenantId}, ${coverage}, ${places}::text[], ${c.allowsCod === true}, ${codCoverage},
            ${codPlaces}::text[], ${userId}, NOW())
    ON CONFLICT ("shippingMethodId") DO UPDATE SET
      "coverage" = EXCLUDED."coverage", "places" = EXCLUDED."places", "allowsCod" = EXCLUDED."allowsCod",
      "codCoverage" = EXCLUDED."codCoverage", "codPlaces" = EXCLUDED."codPlaces",
      "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW()
    WHERE "ShippingMethodCoverage"."tenantId" = ${tenantId}`
}
