import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/support/super-admin-guard'
import { costaRicaPeriodKey } from '@/lib/ai-usage/period'
import { clearCreditAllowanceCache } from '@/lib/ai-billing/allowance'
import {
  MAX_FREE_MICROS,
  MAX_LIMIT_MICROS,
  MAX_MARKUP_BPS,
  MICROS_PER_USD,
  MIN_MARKUP_BPS,
  normalizePacks,
  quotePack,
  rateForPeriod,
} from '@/lib/ai-billing/math'
import { addAdjustment, aiBillingReady, getSettings, isBillingTableMissing, listRates, saveRate, saveSettings } from '@/lib/ai-billing/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Owner (super admin) settings for AI credits: markup, free credit, packs, ceiling, enforcement, adjustments. */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin(request)
  if (!guard.ok) return guard.response
  const [ready, settings, rates] = await Promise.all([aiBillingReady(), getSettings(), listRates()])
  const period = costaRicaPeriodKey(new Date())
  return NextResponse.json({
    ready,
    periodKey: period,
    current: rateForPeriod(rates, period),
    rates,
    settings,
    packQuotes: settings.packs.map((p) => quotePack(p)),
  })
}

const settingsSchema = z.object({
  markup: z.number().finite().min(MIN_MARKUP_BPS / 10_000).max(MAX_MARKUP_BPS / 10_000),
  freeMonthlyUsd: z.number().finite().min(0).max(MAX_FREE_MICROS / MICROS_PER_USD),
  effectiveNow: z.boolean().default(false),
  packsUsd: z.array(z.number().finite()).min(1).max(6),
  ceilingUsd: z.number().finite().min(1).max(MAX_LIMIT_MICROS / MICROS_PER_USD).nullable(),
  enforce: z.boolean(),
})

export async function PUT(request: NextRequest) {
  const guard = await requireSuperAdmin(request, { write: true })
  if (!guard.ok) return guard.response
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const d = parsed.data
  const packs = normalizePacks(d.packsUsd.map((usd, i) => ({ id: `p${i + 1}`, creditCents: Math.round(usd * 100) })))
  if (!packs) return NextResponse.json({ error: 'Paquetes: entre $5 y $1.000, sin repetir.' }, { status: 400 })
  try {
    const now = new Date()
    const before = await getSettings()
    const rate = await saveRate(
      {
        markupBps: Math.round(d.markup * 10_000),
        freeMonthlyMicros: Math.round(d.freeMonthlyUsd * 100) * 10_000,
        effectiveNow: d.effectiveNow,
        createdBy: guard.userId,
      },
      now,
    )
    await saveSettings(
      {
        packs,
        ceilingMicros: d.ceilingUsd === null ? null : Math.round(d.ceilingUsd * 100) * 10_000,
        enforce: d.enforce,
        cutoverPeriod: before.cutoverPeriod,
        updatedBy: guard.userId,
      },
      now,
    )
    clearCreditAllowanceCache()
    if (d.effectiveNow) console.warn('[super-admin/ai-billing] rate changed for the CURRENT month', { periodKey: rate.periodKey })
    return NextResponse.json({ ok: true, ratePeriod: rate.periodKey })
  } catch (error) {
    if (isBillingTableMissing(error)) return NextResponse.json({ error: 'Falta aplicar SQL 060.' }, { status: 503 })
    console.error('[super-admin/ai-billing] save failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }
}

const adjustSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  amountUsd: z.number().finite().min(-10_000).max(10_000).refine((v) => v !== 0),
  note: z.string().trim().min(3).max(160),
  requestId: z.string().uuid(),
})

/** Manual credit or correction for one business (e.g. a gift, a refund, a bank transfer paid outside Tilopay). */
export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin(request, { write: true })
  if (!guard.ok) return guard.response
  const parsed = adjustSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const d = parsed.data
  const tenant = await prisma.tenant.findUnique({ where: { id: d.tenantId }, select: { id: true } })
  if (!tenant) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 })
  try {
    const written = await addAdjustment({
      tenantId: d.tenantId,
      amountMicros: Math.round(d.amountUsd * 100) * 10_000,
      note: d.note,
      createdBy: guard.userId,
      requestId: d.requestId,
    })
    clearCreditAllowanceCache(d.tenantId)
    return NextResponse.json({ ok: true, duplicate: written === 0 })
  } catch (error) {
    if (isBillingTableMissing(error)) return NextResponse.json({ error: 'Falta aplicar SQL 060.' }, { status: 503 })
    console.error('[super-admin/ai-billing] adjust failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }
}
