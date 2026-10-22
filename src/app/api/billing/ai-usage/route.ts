import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { getCreditState } from '@/lib/ai-billing/state'
import { buildUsageReport } from '@/lib/ai-billing/report'
import { getSettings, listLedger, listPurchases, listRates, monthDailyUsage } from '@/lib/ai-billing/store'
import { loadAgentNames } from '@/lib/soft-ai/agent-usage-server'
import { isPeriodKey, quotePack, rateForPeriod } from '@/lib/ai-billing/math'
import { IVA_BPS } from '@/lib/pricing/plan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * This business's AI spend: month-to-date vs credit / limit, daily breakdown by feature and agent, the math,
 * packs it can buy, purchases and balance movements. Owner and admins; tenant from the session only.
 * `?period=YYYY-MM` shows an earlier month's breakdown (the balance and limit are always "now").
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config', { skipBillingGuard: true })
  if (!auth.ok) return auth.response
  if (auth.role !== 'OWNER' && auth.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo el dueño o un administrador ve el uso de IA.' }, { status: 403 })
  }
  const tenantId = auth.tenantId
  try {
    const state = await getCreditState(tenantId)
    const asked = request.nextUrl.searchParams.get('period')
    const period = isPeriodKey(asked) && asked <= state.periodKey ? asked : state.periodKey
    const [daily, settings, ledger, purchases, rates] = await Promise.all([
      monthDailyUsage(tenantId, period),
      getSettings(),
      listLedger(tenantId, 30),
      listPurchases(tenantId, 20),
      listRates(),
    ])
    const report = buildUsageReport(daily, rateForPeriod(rates, period), period)
    const agentIds = [...new Set(daily.map((d) => d.agentId).filter((x): x is string => !!x))]
    const agentNames = await loadAgentNames(agentIds, tenantId)
    return NextResponse.json({
      ready: state.ready,
      periodKey: state.periodKey,
      viewPeriod: period,
      renewsAt: state.renewsAt,
      ivaBps: IVA_BPS,
      rate: state.rate,
      nextRate: state.nextRate,
      listMicros: state.listMicros,
      balanceMicros: state.balanceMicros,
      ownLimitMicros: state.ownLimitMicros,
      ceilingMicros: state.ceilingMicros,
      agentEnabled: state.agentEnabled,
      exempt: state.exempt,
      enforce: state.settings.enforce,
      decision: state.decision,
      canManage: auth.role === 'OWNER',
      packs: state.agentEnabled && state.ready ? settings.packs.map((p) => quotePack(p)) : [],
      report,
      agentNames: Object.fromEntries(Object.entries(agentNames).map(([id, a]) => [id, a.name])),
      ledger,
      purchases,
    })
  } catch (error) {
    console.error('[billing/ai-usage] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No pudimos cargar el uso de IA.' }, { status: 500 })
  }
}
