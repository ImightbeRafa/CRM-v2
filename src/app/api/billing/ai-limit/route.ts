import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { clearCreditAllowanceCache } from '@/lib/ai-billing/allowance'
import { MAX_LIMIT_MICROS, MICROS_PER_USD, effectiveLimit } from '@/lib/ai-billing/math'
import { exemptTenantIds } from '@/lib/soft-ai/ai-allowance'
import { getSettings, getTenantLimit, isBillingTableMissing, setTenantLimit } from '@/lib/ai-billing/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The business's own monthly AI limit (USD before IVA). Read: owner + admins. Write: owner (manage_billing). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config', { skipBillingGuard: true })
  if (!auth.ok) return auth.response
  if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [own, settings] = await Promise.all([getTenantLimit(auth.tenantId), getSettings()])
  return NextResponse.json({
    ownLimitMicros: own,
    ceilingMicros: settings.ceilingMicros,
    effectiveLimitMicros: effectiveLimit(own, settings.ceilingMicros),
  })
}

const schema = z.object({
  // null clears the limit. Dollars with up to 2 decimals.
  monthlyLimitUsd: z.number().finite().min(1).max(MAX_LIMIT_MICROS / MICROS_PER_USD).nullable(),
})

export async function PUT(request: NextRequest) {
  // Billing guard skipped: a business with an unpaid plan may still lower its AI limit.
  const auth = await authenticateAPIWithPermission(request, 'manage_billing', { skipBillingGuard: true })
  if (!auth.ok) return auth.response
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 })
  if (exemptTenantIds().has(auth.tenantId)) {
    return NextResponse.json({ error: 'Esta cuenta no tiene límite de IA.' }, { status: 400 })
  }
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'El límite debe ser entre $1 y $100.000.' }, { status: 400 })
  try {
    const settings = await getSettings()
    let micros = parsed.data.monthlyLimitUsd === null ? null : Math.round(parsed.data.monthlyLimitUsd * 100) * 10_000
    let clamped = false
    if (micros !== null && settings.ceilingMicros !== null && micros > settings.ceilingMicros) {
      micros = settings.ceilingMicros
      clamped = true
    }
    await setTenantLimit(auth.tenantId, micros, auth.userId)
    clearCreditAllowanceCache(auth.tenantId)
    return NextResponse.json({ ok: true, ownLimitMicros: micros, clamped, ceilingMicros: settings.ceilingMicros })
  } catch (error) {
    if (isBillingTableMissing(error)) return NextResponse.json({ error: 'El uso de IA aún no está disponible.' }, { status: 503 })
    console.error('[billing/ai-limit] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No pudimos guardar el límite.' }, { status: 500 })
  }
}
