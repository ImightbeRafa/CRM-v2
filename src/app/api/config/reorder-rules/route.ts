/**
 * GET/PUT /api/config/reorder-rules — "1 unit of <product> lasts N days" rules for reorder reminders (Lane E2).
 * Stored in Tenant.settings.reorderRules (jsonb_set under FOR UPDATE; no other settings key is touched).
 * Tenant from the session; GET view_config, PUT update_config (+ billing write guard).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { loadReorderProducts, loadReorderRules, saveReorderRules } from '@/lib/insights/customers-server'
import { parseReorderRules, REORDER_LIMITS } from '@/lib/insights/reorder'
import { NO_STORE } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config')
  if (!auth.ok) return auth.response
  try {
    const [rules, products] = await Promise.all([loadReorderRules(auth.tenantId), loadReorderProducts(auth.tenantId)])
    return NextResponse.json({ rules, products, limits: REORDER_LIMITS }, { headers: NO_STORE })
  } catch (error) {
    console.error('[reorder-rules GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudieron cargar las reglas.' }, { status: 500, headers: NO_STORE })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { rules?: unknown } | null
  if (!body || !Array.isArray(body.rules) || body.rules.length > REORDER_LIMITS.rules) {
    return NextResponse.json({ error: `Enviá hasta ${REORDER_LIMITS.rules} reglas.` }, { status: 400, headers: NO_STORE })
  }
  const rules = parseReorderRules(body.rules)
  if (rules.length !== body.rules.length) {
    return NextResponse.json(
      { error: 'Revisá las reglas: cada una necesita nombre, producto o texto a buscar, y de 1 a 365 días.' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    // An inventory product must belong to this business.
    const ids = rules.map((r) => r.inventoryItemId).filter((id): id is string => Boolean(id))
    if (ids.length) {
      const own = new Set((await loadReorderProducts(auth.tenantId)).map((p) => p.id))
      if (ids.some((id) => !own.has(id))) {
        return NextResponse.json({ error: 'Ese producto no existe en tu inventario.' }, { status: 400, headers: NO_STORE })
      }
    }
    const saved = await saveReorderRules(auth.tenantId, rules)
    return NextResponse.json({ rules: saved }, { headers: NO_STORE })
  } catch (error) {
    console.error('[reorder-rules PUT]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudieron guardar las reglas.' }, { status: 500, headers: NO_STORE })
  }
}
