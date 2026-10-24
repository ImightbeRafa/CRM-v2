/**
 * GET /api/estadisticas/anuncios/roas — ad spend (Meta Ads Insights, ads_read) × orders Betsy credits to each ad
 * → spend, orders, revenue, ROAS. Read-only, tenant from the session. ?period=…&from=&to= (CR calendar).
 * Without a connected ad account it answers the connection state only (the card shows "Conectá tu cuenta").
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { readTenantUiReadiness } from '@/lib/feature-flags'
import { loadAdSalesReport } from '@/lib/insights/insights-server'
import { badPeriod, cached, insightsError, limitInsights, NO_STORE, readPeriod } from '@/lib/insights/route-helpers'
import { normalizeCurrency } from '@/lib/meta-ads/core'
import { loadAdSpend } from '@/lib/meta-ads/insights'
import { buildRoasReport } from '@/lib/meta-ads/roas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_statistics')
    if (!auth.ok) return auth.response
    const tenantId = auth.tenantId as string
    const limited = await limitInsights(tenantId)
    if (limited) return limited
    const period = readPeriod(request.nextUrl.searchParams)
    if (!period) return badPeriod()

    const spend = await loadAdSpend(tenantId, period.range)
    if (spend.state !== 'ok') {
      const connection =
        spend.state === 'pending_pick' || spend.state === 'problem'
          ? { status: spend.connection.status, adAccountName: spend.connection.adAccountName }
          : null
      return NextResponse.json(
        { range: period.range, state: spend.state, problem: spend.state === 'problem' ? spend.problem : null, connection, report: null },
        { headers: NO_STORE },
      )
    }

    const [readiness, tenant, sales] = await Promise.all([
      readTenantUiReadiness(tenantId),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
      // Same cache key as GET /api/estadisticas/anuncios (all channels): one load for both cards.
      cached(tenantId, ['ads', period.range.startDate, period.range.endDate, null], () =>
        loadAdSalesReport({ tenantId, range: period.range, platform: null }),
      ),
    ])
    const revenueMode = readiness.statistics.enabled && readiness.statistics.mode === 'primary' ? 'collected' : 'booked'
    const settings = tenant?.settings && typeof tenant.settings === 'object' ? (tenant.settings as { currency?: unknown }) : {}
    const storeCurrency = normalizeCurrency(settings.currency) ?? 'CRC'
    const report = buildRoasReport({
      sales,
      spend: spend.rows,
      revenueMode,
      storeCurrency,
      adCurrency: spend.currency,
      fxRate: spend.connection.storeFxRate,
    })
    return NextResponse.json(
      {
        range: period.range,
        state: 'ok',
        revenueMode,
        connection: {
          status: spend.connection.status,
          adAccountName: spend.connection.adAccountName,
          timezoneName: spend.connection.timezoneName,
        },
        truncated: spend.truncated,
        report,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    return insightsError('anuncios-roas', error)
  }
}
