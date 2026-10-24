'use client'

/**
 * Estadísticas › Anuncios › Ad spend & ROAS (Meta ads_read): spend, impressions and clicks per ad from the
 * business's own ad account, joined by ad id with the orders Betsy credits to each ad. Math in
 * src/lib/meta-ads/roas.ts; data from GET /api/estadisticas/anuncios/roas. ES / EN for Meta's screencast.
 */
import Link from 'next/link'
import { BarChart3, HelpCircle } from 'lucide-react'
import { AdsLangToggle } from '@/components/meta-ads/AdsLangToggle'
import { adsText, useAdsLang, type AdsLang } from '@/lib/meta-ads/i18n'
import type { RoasReport, RoasRow } from '@/lib/meta-ads/roas'
import { InsightCard } from './charts'
import { useInsightsJson } from './InsightsShared'

type Payload = {
  state: 'ok' | 'unavailable' | 'not_connected' | 'pending_pick' | 'problem'
  problem?: string | null
  revenueMode?: 'booked' | 'collected'
  connection: { status: string; adAccountName: string | null; timezoneName?: string | null } | null
  truncated?: boolean
  report: RoasReport | null
}

function money(value: number, currency: string | null, lang: AdsLang): string {
  const locale = lang === 'en' ? 'en-US' : 'es-CR'
  if (!currency) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: currency === 'CRC' ? 0 : 2 }).format(value)
}

function roasText(value: number | null, lang: AdsLang): string {
  if (value === null) return '—'
  return `${new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}×`
}

function RoasChip({ value, lang }: { value: number | null; lang: AdsLang }) {
  const tone = value === null ? 'bg-slate-100 text-slate-500' : value >= 2 ? 'bg-emerald-50 text-emerald-700' : value >= 1 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${tone}`}>{roasText(value, lang)}</span>
}

function AdName({ row, unnamed }: { row: RoasRow; unnamed: string }) {
  const parts = [row.campaignName, row.adsetName].filter(Boolean).join(' · ')
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-slate-900" title={row.adName ?? row.headline ?? undefined}>
        {row.adName || row.headline || unnamed}
      </p>
      <p className="truncate text-[11px] text-slate-400">
        {parts ? `${parts} · ` : ''}
        <span className="tabular-nums">ID {row.adId}</span>
      </p>
    </div>
  )
}

export function AdRoasCard({ query }: { query: string | null }) {
  const [lang, setLang] = useAdsLang()
  const t = adsText(lang)
  const [res, reload] = useInsightsJson<Payload>(query ? `/api/estadisticas/anuncios/roas?${query}` : null)
  const data = res.data
  const report = data?.report ?? null
  const nf = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-CR')
  const revenueLabel = data?.revenueMode === 'collected' ? t.colRevenueCollected : t.colRevenueBooked

  // Before SQL 064 is applied the feature does not exist yet: no card at all.
  if (data?.state === 'unavailable') return null

  return (
    <InsightCard
      icon={BarChart3}
      title={t.roasTitle}
      subtitle={data?.connection?.adAccountName ? `${t.roasSubtitle} · ${data.connection.adAccountName}` : t.roasSubtitle}
      state={res.state}
      onRetry={reload}
      skeletonClass="h-[200px]"
      right={<AdsLangToggle lang={lang} onChange={setLang} label={t.langLabel} />}
      testId="insights-ads-roas"
    >
      {!data ? null : data.state === 'not_connected' || data.state === 'pending_pick' || (data.state === 'problem' && data.problem !== 'rate_limited') ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sky-50/70 px-3.5 py-3 text-[12.5px] text-sky-900" data-testid="ads-roas-connect">
          <span>
            {data.state === 'not_connected'
              ? t.connectCta
              : data.state === 'pending_pick'
                ? t.pickCta
                : data.problem === 'missing_permission'
                  ? t.missingPermission
                  : data.problem === 'token_invalid'
                    ? t.expired
                    : t.problemCta}
          </span>
          <Link href="/config/social#cuenta-publicitaria" className="rounded-lg bg-white px-2.5 py-1.5 font-semibold text-sky-800 ring-1 ring-sky-200 hover:bg-sky-50">
            {t.connectLink}
          </Link>
        </div>
      ) : data.state === 'problem' ? (
        <p className="py-4 text-[12.5px] text-amber-800">{t.rateLimited}</p>
      ) : report && report.rows.length === 0 ? (
        <p className="py-4 text-[12.5px] text-slate-500">{t.noSpend}</p>
      ) : report ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2.5 font-medium">{t.colAd}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.colSpend}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.colImpressions}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.colClicks}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.colOrders}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{revenueLabel}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t.colRoas}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.adId} className="border-t border-slate-100 align-top" data-testid="roas-row">
                    <td className="max-w-[320px] px-3 py-2.5">
                      <AdName row={row} unnamed={t.unnamed} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{money(row.spend, report.adCurrency, lang)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{nf.format(row.impressions)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{nf.format(row.clicks)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{nf.format(row.orders)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{money(row.revenue, report.storeCurrency, lang)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <RoasChip value={row.roas} lang={lang} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/60 font-semibold" data-testid="roas-total">
                  <td className="px-3 py-2.5 text-slate-900">{t.total}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(report.totals.spend, report.adCurrency, lang)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(report.totals.impressions)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(report.totals.clicks)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(report.totals.orders)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(report.totals.revenue, report.storeCurrency, lang)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <RoasChip value={report.totals.roas} lang={lang} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <ul className="space-y-1 text-[11.5px] text-slate-500">
            <li className="flex items-start gap-1.5">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {t.roasHelp}
            </li>
            {report.roasReason === 'currency_mismatch' && report.adCurrency && report.storeCurrency ? (
              <li className="text-amber-800" data-testid="roas-currency-note">
                {t.mismatch(report.adCurrency, report.storeCurrency)}
              </li>
            ) : null}
            {report.fxRate && report.adCurrency && report.storeCurrency && report.adCurrency !== report.storeCurrency ? (
              <li>{t.fxUsed(report.fxRate, report.adCurrency, report.storeCurrency)}</li>
            ) : null}
            {data.connection?.timezoneName && data.connection.timezoneName !== 'America/Costa_Rica' ? <li>{t.tzNote(data.connection.timezoneName)}</li> : null}
            {report.withoutSpend.ads > 0 ? (
              <li data-testid="roas-without-spend">{t.withoutSpend(report.withoutSpend.ads, money(report.withoutSpend.revenue, report.storeCurrency, lang))}</li>
            ) : null}
            <li>{t.windowNote}</li>
            {data.truncated ? <li>{t.truncated}</li> : null}
          </ul>
        </div>
      ) : null}
    </InsightCard>
  )
}
