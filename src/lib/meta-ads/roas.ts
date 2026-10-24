/**
 * Ad spend (Meta Ads Insights) × orders Betsy credits to each ad (ad-sales.ts) → spend, orders, revenue, ROAS.
 * Pure. Joined by ad id. An ad with spend but no Betsy chats still shows (0 orders: money spent, nothing sold);
 * an ad with orders but no spend in the range shows its orders with spend 0 (its spend fell outside the dates).
 */
import type { AdSalesReport } from '@/lib/insights/ad-sales'
import { computeRoas, type AdInsightRow } from '@/lib/meta-ads/core'

export type RoasRow = {
  adId: string
  adName: string | null
  adsetName: string | null
  campaignName: string | null
  headline: string | null
  spend: number
  impressions: number
  clicks: number
  orders: number
  paidOrders: number
  revenue: number
  roas: number | null
}

export type RoasReport = {
  rows: RoasRow[]
  /** Ads of the connected account (with Insights rows in the range). */
  totals: { spend: number; impressions: number; clicks: number; orders: number; revenue: number; roas: number | null }
  /** Ads Betsy credits with sales but no spend in this account for these dates (another account / older spend). */
  withoutSpend: { ads: number; orders: number; revenue: number }
  roasReason: 'ok' | 'no_spend' | 'currency_mismatch'
  storeCurrency: string | null
  adCurrency: string | null
  fxRate: number | null
}

const MAX_ROWS = 200

export function buildRoasReport(input: {
  sales: Pick<AdSalesReport, 'rows'>
  spend: AdInsightRow[]
  revenueMode: 'booked' | 'collected'
  storeCurrency: string | null
  adCurrency: string | null
  fxRate: number | null
}): RoasReport {
  const money = (r: { booked: number; collected: number }) => (input.revenueMode === 'collected' ? r.collected : r.booked)
  const salesByAd = new Map(input.sales.rows.filter((r) => r.adId).map((r) => [r.adId as string, r]))
  const spendByAd = new Map(input.spend.map((r) => [r.adId, r]))
  const ids = [...new Set([...spendByAd.keys(), ...salesByAd.keys()])]
  const roasOf = (revenue: number, spend: number) =>
    computeRoas({ revenue, spend, storeCurrency: input.storeCurrency, adCurrency: input.adCurrency, fxRate: input.fxRate })

  const rows: RoasRow[] = ids.map((adId) => {
    const s = spendByAd.get(adId)
    const sale = salesByAd.get(adId)
    const revenue = sale ? money(sale) : 0
    const spend = s?.spend ?? 0
    return {
      adId,
      adName: s?.adName ?? null,
      adsetName: s?.adsetName ?? null,
      campaignName: s?.campaignName ?? sale?.campaignName ?? null,
      headline: sale?.headline ?? null,
      spend,
      impressions: s?.impressions ?? 0,
      clicks: s?.clicks ?? 0,
      orders: sale?.orders ?? 0,
      paidOrders: sale?.paidOrders ?? 0,
      revenue,
      roas: roasOf(revenue, spend).roas,
    }
  })
  // Most money spent first, then most revenue.
  rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue || a.adId.localeCompare(b.adId))

  // Totals over the ads of the connected account (in Insights for these dates). Sales from ads without spend here
  // (another ad account, or spend outside the dates) are shown apart, so they never inflate the total ROAS.
  const inAccount = rows.filter((r) => spendByAd.has(r.adId))
  const totals = inAccount.reduce(
    (t, r) => ({
      spend: t.spend + r.spend,
      impressions: t.impressions + r.impressions,
      clicks: t.clicks + r.clicks,
      orders: t.orders + r.orders,
      revenue: t.revenue + r.revenue,
    }),
    { spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0 },
  )
  const outside = rows.filter((r) => !spendByAd.has(r.adId))
  const total = roasOf(totals.revenue, totals.spend)
  return {
    rows: rows.slice(0, MAX_ROWS),
    totals: { ...totals, spend: Math.round(totals.spend * 100) / 100, roas: total.roas },
    withoutSpend: { ads: outside.length, orders: outside.reduce((n, r) => n + r.orders, 0), revenue: outside.reduce((n, r) => n + r.revenue, 0) },
    roasReason: total.reason,
    storeCurrency: input.storeCurrency,
    adCurrency: input.adCurrency,
    fxRate: input.fxRate,
  }
}
