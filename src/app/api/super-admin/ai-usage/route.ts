/**
 * GET /api/super-admin/ai-usage — owner AI usage & cost across all of Betsy (every AI call: inbox agents, tests,
 * imports, customer paste, staff bot text + voice). Betsy platform admins only (others get 404).
 * ?days=7|30|90 &tenantId= &model= &feature= &format=csv
 * PUT { scope: 'global' | tenantId, monthlyUsd: number|null, autoPause: boolean } — save / delete a budget.
 * Aggregates only, no customer text. Costs are list-price estimates.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import { memoTtl } from '@/lib/soft-ai/safe-query'
import { AI_USAGE_FEATURE_LABELS, loadSpendHeadline, loadUsageDashboard, usageCsv } from '@/lib/ai-usage-admin/summary'
import { AiBudgetNotReadyError, listAiBudgets, saveAiBudget } from '@/lib/ai-usage-admin/budgets'
import { AI_PRICING_VERSION } from '@/lib/ai-usage/rate-card'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TEXT_RE = /^[A-Za-z0-9._:-]{1,80}$/

async function owner(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return { denied: auth.response }
  if (!(await isSuperAdmin(auth.userId))) {
    return { denied: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) }
  }
  return { auth }
}

export async function GET(request: NextRequest) {
  const o = await owner(request)
  if ('denied' in o) return o.denied
  const { auth } = o
  try {
    const p = request.nextUrl.searchParams
    const daysRaw = Number(p.get('days') || 30)
    const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30
    const tenantId = p.get('tenantId')
    const model = p.get('model')
    const feature = p.get('feature')
    const filters = {
      tenantId: tenantId && ID_RE.test(tenantId) ? tenantId : null,
      model: model && TEXT_RE.test(model) ? model : null,
      feature: feature && TEXT_RE.test(feature) ? feature : null,
    }
    const key = `ai-usage:${days}:${filters.tenantId}:${filters.model}:${filters.feature}`
    const [data, headline, budgets] = await memoTtl(key, 60_000, () => {
      const to = new Date()
      const from = new Date(to.getTime() - days * 86_400_000)
      return Promise.all([loadUsageDashboard({ from, to, ...filters }), loadSpendHeadline(to), listAiBudgets()])
    })

    if (p.get('format') === 'csv') {
      if (!data.available) return NextResponse.json({ error: 'Sin datos' }, { status: 404, headers: NO_STORE })
      await logAuditEvent({
        action: 'EXPORT',
        entityType: 'ai_usage_dashboard',
        entityId: 'platform',
        description: `Exportó uso de IA (${days} días)`,
        userId: auth.userId,
        userRole: 'SUPER_ADMIN',
        tenantId: auth.tenantId,
      }).catch(() => {})
      return new NextResponse(usageCsv(data), {
        headers: {
          ...NO_STORE,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="uso-ia-${days}d.csv"`,
        },
      })
    }

    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 })
    return NextResponse.json(
      {
        success: true,
        days,
        filters,
        pricingVersion: AI_PRICING_VERSION,
        disclaimer: 'Costos estimados a precio de lista; no son la factura del proveedor.',
        featureLabels: AI_USAGE_FEATURE_LABELS,
        headline,
        data,
        budgets,
        tenants,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('[super-admin/ai-usage GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Error al cargar' }, { status: 500, headers: NO_STORE })
  }
}

export async function PUT(request: NextRequest) {
  const o = await owner(request)
  if ('denied' in o) return o.denied
  const { auth } = o
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403, headers: NO_STORE })
  }
  try {
    const body = (await request.json().catch(() => null)) as { scope?: unknown; monthlyUsd?: unknown; autoPause?: unknown } | null
    const scope = typeof body?.scope === 'string' ? body.scope : ''
    if (scope !== 'global') {
      if (!ID_RE.test(scope) || !(await prisma.tenant.findFirst({ where: { id: scope }, select: { id: true } }))) {
        return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 400, headers: NO_STORE })
      }
    }
    const raw = body?.monthlyUsd
    const monthlyUsd = raw === null ? null : typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : undefined
    if (monthlyUsd === undefined) {
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400, headers: NO_STORE })
    }
    await saveAiBudget({ scope, monthlyUsd, autoPause: body?.autoPause === true && scope !== 'global', updatedBy: auth.userId })
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ai_budget',
      entityId: scope,
      description: monthlyUsd == null ? 'Quitó presupuesto de IA' : `Presupuesto de IA US$${monthlyUsd}/mes`,
      newValues: { scope, monthlyUsd, autoPause: body?.autoPause === true },
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof AiBudgetNotReadyError) {
      return NextResponse.json({ error: 'Los presupuestos todavía no están disponibles.' }, { status: 503, headers: NO_STORE })
    }
    console.error('[super-admin/ai-usage PUT]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500, headers: NO_STORE })
  }
}
