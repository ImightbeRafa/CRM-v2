/**
 * GET /api/super-admin/ai-usage — owner AI usage & cost across all of Betsy (every AI call: inbox agents, tests,
 * imports, customer paste, staff bot text + voice). Betsy platform admins only (others get 404).
 * ?days=7|30|90 &tenantId= &model= &feature= &format=csv   (opens are audited, throttled per admin)
 * PUT    { scope: 'global' | tenantId, monthlyUsd: number > 0, autoPause: boolean } — save a budget.
 * DELETE ?scope=…                                                                — remove a budget.
 * Aggregates only, no customer text. Costs are list-price estimates. Heavy reads go through the analytics guard
 * (busy → 503 with Retry-After).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import { AnalyticsBusyError, memoTtl } from '@/lib/soft-ai/safe-query'
import { AI_USAGE_FEATURE_LABELS, loadSpendHeadline, loadUsageDashboard, usageCsv } from '@/lib/ai-usage-admin/summary'
import { AiBudgetNotReadyError, deleteAiBudget, listAiBudgets, saveAiBudget } from '@/lib/ai-usage-admin/budgets'
import { AI_PRICING_VERSION } from '@/lib/ai-usage/rate-card'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const TEXT_RE = /^[A-Za-z0-9._:-]{1,80}$/
const lastViewAudit = new Map<string, number>()
const VIEW_AUDIT_EVERY_MS = 10 * 60_000

async function owner(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return { denied: auth.response }
  if (!(await isSuperAdmin(auth.userId))) {
    return { denied: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) }
  }
  return { auth }
}

function busy() {
  return NextResponse.json(
    { error: 'El panel está ocupado, probá de nuevo en unos segundos.' },
    { status: 503, headers: { ...NO_STORE, 'Retry-After': '5' } },
  )
}

/** Audit rows about one business go to THAT business's log (never another business's). */
function auditTenantFor(scope: string, fallback: string) {
  return scope === 'global' ? fallback : scope
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
    const [data, headline] = await memoTtl(key, 60_000, async () => {
      const to = new Date()
      const from = new Date(to.getTime() - days * 86_400_000)
      // Sequential: the analytics guard already limits concurrency; this keeps one open to ≤2 connections.
      const d = await loadUsageDashboard({ from, to, ...filters })
      const h = await loadSpendHeadline(to)
      return [d, h] as const
    })
    // Budgets are read fresh (a save must show immediately).
    const budgets = await listAiBudgets()

    const csv = p.get('format') === 'csv'
    const last = lastViewAudit.get(auth.userId) || 0
    if (csv || Date.now() - last > VIEW_AUDIT_EVERY_MS) {
      lastViewAudit.set(auth.userId, Date.now())
      await logAuditEvent({
        action: 'EXPORT',
        entityType: 'ai_usage_dashboard',
        entityId: 'platform',
        description: csv ? `Exportó uso de IA (${days} días)` : `Abrió Uso de IA (${days} días)`,
        userId: auth.userId,
        userRole: 'SUPER_ADMIN',
        tenantId: auth.tenantId,
      }).catch(() => {})
    }

    if (csv) {
      if (!data.available) return NextResponse.json({ error: 'Sin datos' }, { status: 404, headers: NO_STORE })
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
        disclaimer: 'Costos estimados a precio de lista; no son la factura del proveedor. Días y meses en hora de Costa Rica.',
        featureLabels: AI_USAGE_FEATURE_LABELS,
        headline,
        data,
        budgets,
        tenants,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof AnalyticsBusyError) return busy()
    console.error('[super-admin/ai-usage GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Error al cargar' }, { status: 500, headers: NO_STORE })
  }
}

async function validScope(scope: string): Promise<boolean> {
  if (scope === 'global') return true
  return ID_RE.test(scope) && Boolean(await prisma.tenant.findFirst({ where: { id: scope }, select: { id: true } }))
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
    if (!(await validScope(scope))) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 400, headers: NO_STORE })
    const raw = body?.monthlyUsd
    if (!(typeof raw === 'number' && Number.isFinite(raw) && raw > 0)) {
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400, headers: NO_STORE })
    }
    const autoPause = body?.autoPause === true && scope !== 'global'
    await saveAiBudget({ scope, monthlyUsd: raw, autoPause, updatedBy: auth.userId })
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ai_budget',
      entityId: scope,
      description: `Presupuesto de IA US$${raw}/mes${autoPause ? ' (pausa al 100%)' : ''}`,
      newValues: { scope, monthlyUsd: raw, autoPause },
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auditTenantFor(scope, auth.tenantId),
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

export async function DELETE(request: NextRequest) {
  const o = await owner(request)
  if ('denied' in o) return o.denied
  const { auth } = o
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403, headers: NO_STORE })
  }
  try {
    const scope = request.nextUrl.searchParams.get('scope') || ''
    if (!(await validScope(scope))) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 400, headers: NO_STORE })
    await deleteAiBudget(scope)
    await logAuditEvent({
      action: 'DELETE',
      entityType: 'ai_budget',
      entityId: scope,
      description: 'Quitó presupuesto de IA',
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auditTenantFor(scope, auth.tenantId),
    }).catch(() => {})
    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof AiBudgetNotReadyError) {
      return NextResponse.json({ error: 'Los presupuestos todavía no están disponibles.' }, { status: 503, headers: NO_STORE })
    }
    console.error('[super-admin/ai-usage DELETE]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudo quitar' }, { status: 500, headers: NO_STORE })
  }
}
