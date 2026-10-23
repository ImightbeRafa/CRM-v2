'use client'

/**
 * Estadísticas › Anuncios: which Meta ad brought chats, orders and money (Lane E2).
 * Rules shown to the user in "¿Cómo se cuenta?"; the math lives in src/lib/insights/ad-sales.ts.
 */
import { Suspense, useState } from 'react'
import { ExternalLink, HelpCircle, Megaphone, MessageCircle, ShoppingBag, TrendingUp, Wallet } from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { AuroraEmptyState } from '@/components/aurora/states'
import { formatCompactMoney, formatDayLabel } from '@/lib/statistics-aurora'
import { formatPercent, rate } from '@/lib/insights/stats-math'
import { safeAdLink, type AdSalesReport, type AdSalesRow } from '@/lib/insights/ad-sales'
import { InsightsHeader, SourceNote, nf, useInsightsJson, useUrlPeriod } from './InsightsShared'
import { AreaChart, InsightCard, NEUTRAL_SERIES, SERIES, Segmented, SplitBar, StatTile, StatusChip } from './charts'

type Payload = {
  range: { startDate: string; endDate: string }
  revenueMode: 'booked' | 'collected'
  platform: 'whatsapp' | 'instagram' | null
  report: AdSalesReport
}

const CHANNELS = [
  { key: '', label: 'Todos' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram' },
] as const
type ChannelKey = (typeof CHANNELS)[number]['key']

function PlatformBadges({ platforms }: { platforms: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {platforms.map((p) => (
        <span
          key={p}
          className={`rounded-md px-1.5 py-px text-[10px] font-semibold ring-1 ${p === 'instagram' ? 'bg-pink-50 text-pink-700 ring-pink-200/70' : 'bg-emerald-50 text-emerald-700 ring-emerald-200/70'}`}
        >
          {p === 'instagram' ? 'Instagram' : 'WhatsApp'}
        </span>
      ))}
    </span>
  )
}

function ConversionChip({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[12px] text-slate-400">—</span>
  const tone = value >= 0.1 ? 'good' : value > 0 ? 'info' : 'neutral'
  return (
    <StatusChip tone={tone} icon={null}>
      {formatPercent(value)}
    </StatusChip>
  )
}

function AdTitle({ row }: { row: AdSalesRow }) {
  if (row.key === 'organic') {
    return (
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">Sin anuncio</p>
        <p className="text-[11px] text-slate-400">Escribieron solos (o el anuncio fue hace más de 7 días)</p>
      </div>
    )
  }
  const link = safeAdLink(row.sourceUrl)
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-slate-900" title={row.headline ?? undefined}>
        {row.campaignName ? `${row.campaignName} · ` : ''}
        {row.headline || 'Anuncio sin título'}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
        <PlatformBadges platforms={row.platforms} />
        {row.adId ? <span className="tabular-nums">ID {row.adId}</span> : null}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 font-medium text-au-ink-5b6cff hover:underline">
            Ver anuncio <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </p>
    </div>
  )
}

/** Money bar behind the amount: the ad's share of the best-selling ad. */
function MoneyCell({ main, second, secondLabel, max, symbol, cls }: { main: number; second: number; secondLabel: string; max: number; symbol: string; cls: string }) {
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-end gap-2">
        <span className="font-semibold tabular-nums text-slate-900">{formatCompactMoney(main, symbol)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-r-[4px] bg-slate-100/80">
        <div className={`${cls} h-full rounded-r-[4px] bg-current`} style={{ width: `${max > 0 ? Math.max(main > 0 ? 2 : 0, (main / max) * 100) : 0}%` }} />
      </div>
      <p className="mt-0.5 text-right text-[10.5px] text-slate-400">
        {secondLabel} {formatCompactMoney(second, symbol)}
      </p>
    </div>
  )
}

function Report({ data, symbol }: { data: Payload; symbol: string }) {
  const { report, revenueMode } = data
  const collectedFirst = revenueMode === 'collected'
  const money = (r: { booked: number; collected: number }) => (collectedFirst ? r.collected : r.booked)
  const rows: AdSalesRow[] = [...report.rows, report.organic]
  const max = rows.reduce((m, r) => Math.max(m, money(r)), 0)
  const noChat = report.withoutChat
  const cancelled = report.cancelled
  const adMoney = report.rows.reduce((s, r) => s + money(r), 0)
  const totalMoney = collectedFirst ? report.totals.collected : report.totals.booked
  const secondLabel = collectedFirst ? 'vendido' : 'cobrado'

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile icon={MessageCircle} label="Chats desde anuncios" value={nf.format(report.totals.adChatsDistinct)} hint={`${nf.format(report.totals.organicChats)} chats sin anuncio`} />
        <StatTile icon={ShoppingBag} tone="green" label="Pedidos desde anuncios" value={nf.format(report.totals.adOrders)} hint={`de ${nf.format(report.totals.orders)} pedidos en total`} />
        <StatTile
          icon={Wallet}
          tone="amber"
          label={collectedFirst ? 'Cobrado por anuncios' : 'Vendido por anuncios'}
          value={formatCompactMoney(adMoney, symbol)}
          hint={`${formatPercent(rate(adMoney, totalMoney))} del total`}
        />
        <StatTile
          icon={TrendingUp}
          tone="pink"
          label="Conversión de anuncios"
          value={formatPercent(rate(report.totals.adOrders, report.totals.adChatsDistinct))}
          hint={`sin anuncio: ${formatPercent(report.organic.conversion)}`}
        />
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl border border-slate-100 p-3.5">
          <p className="text-[12.5px] font-semibold text-slate-800">Pedidos por día</p>
          <p className="mb-3 text-[11px] text-slate-400">Pedidos vinculados a un chat, por día de venta</p>
          {report.daily.every((d) => d.adOrders + d.organicOrders === 0) ? (
            <p className="py-10 text-center text-[12px] text-slate-400">Todavía no hay pedidos vinculados a un chat en este período.</p>
          ) : (
          <AreaChart
            labels={report.daily.map((d) => d.date)}
            tickLabel={(d) => formatDayLabel(d)}
            series={[
              { key: 'ads', label: 'Desde anuncios', cls: SERIES[0], values: report.daily.map((d) => d.adOrders) },
              { key: 'organic', label: 'Sin anuncio', cls: SERIES[1], values: report.daily.map((d) => d.organicOrders), area: false },
            ]}
            format={(v) => nf.format(Math.round(v))}
            ariaLabel="Pedidos por día desde anuncios y sin anuncio"
            integer
          />
          )}
        </div>
        <div className="rounded-xl border border-slate-100 p-3.5">
          <p className="text-[12.5px] font-semibold text-slate-800">De dónde vienen los pedidos</p>
          <p className="mb-3 text-[11px] text-slate-400">
            {data.platform ? `Pedidos del período vinculados a un chat de ${data.platform === 'instagram' ? 'Instagram' : 'WhatsApp'}` : 'Todos los pedidos del período'}
          </p>
          <SplitBar
            label="Pedidos por origen"
            parts={[
              { key: 'ads', label: 'Anuncios', value: report.totals.adOrders, display: nf.format(report.totals.adOrders), cls: SERIES[0] },
              { key: 'organic', label: 'Sin anuncio', value: report.organic.orders, display: nf.format(report.organic.orders), cls: SERIES[1] },
              // Orders without a chat have no channel: only in the unfiltered view.
              ...(data.platform
                ? []
                : [
                    { key: 'nochat', label: 'Sin chat', value: noChat.orders, display: nf.format(noChat.orders), cls: SERIES[2] },
                    { key: 'cancelled', label: 'Cancelados', value: cancelled.orders, display: nf.format(cancelled.orders), cls: NEUTRAL_SERIES },
                  ]),
            ]}
          />
        </div>
      </div>

      {report.rows.length === 0 ? (
        <AuroraEmptyState
          tone="neutral"
          icon={<Megaphone className="h-6 w-6" />}
          title="Todavía no hay chats desde anuncios en este período"
          description="Cuando un cliente escribe tocando un anuncio de Facebook o Instagram, Betsy guarda de qué anuncio vino y aparece aquí con sus pedidos."
          className="py-8"
        />
      ) : null}

      <div className="hidden overflow-hidden rounded-xl border border-slate-100 md:block">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50/80">
            <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2.5 font-medium">Anuncio</th>
              <th className="px-3 py-2.5 text-right font-medium">Chats</th>
              <th className="px-3 py-2.5 text-right font-medium">Pedidos</th>
              <th className="px-3 py-2.5 text-right font-medium">Pagados</th>
              <th className="px-3 py-2.5 text-right font-medium">{collectedFirst ? 'Cobrado' : 'Vendido'}</th>
              <th className="px-3 py-2.5 text-right font-medium">Conversión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={`border-t border-slate-100 align-top ${row.key === 'organic' ? 'bg-slate-50/50' : ''}`} data-testid="ad-row">
                <td className="max-w-[340px] px-3 py-3">
                  <AdTitle row={row} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-700">{nf.format(row.chats)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-700">{nf.format(row.orders)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-700">{nf.format(row.paidOrders)}</td>
                <td className="px-3 py-3">
                  <MoneyCell
                    main={money(row)}
                    second={collectedFirst ? row.booked : row.collected}
                    secondLabel={secondLabel}
                    max={max}
                    symbol={symbol}
                    cls={row.key === 'organic' ? NEUTRAL_SERIES : SERIES[0]}
                  />
                </td>
                <td className="px-3 py-3 text-right">
                  <ConversionChip value={row.conversion} />
                </td>
              </tr>
            ))}
            {[
              { key: 'nochat', show: noChat.orders > 0, title: 'Pedido sin chat', sub: 'Pedidos que no están vinculados a ningún chat', t: noChat, testId: 'ad-row-no-chat' },
              { key: 'cancelled', show: cancelled.orders > 0, title: 'Cancelados', sub: 'No se atribuyen a ningún anuncio; están para que el total cuadre con el Resumen', t: cancelled, testId: 'ad-row-cancelled' },
            ]
              .filter((r) => r.show)
              .map((r) => (
                <tr key={r.key} className="border-t border-dashed border-slate-200 align-top text-slate-500" data-testid={r.testId}>
                  <td className="px-3 py-3">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-[11px] text-slate-400">{r.sub}</p>
                  </td>
                  <td className="px-3 py-3 text-right">—</td>
                  <td className="px-3 py-3 text-right tabular-nums">{nf.format(r.t.orders)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{nf.format(r.t.paidOrders)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCompactMoney(money(r.t), symbol)}</td>
                  <td className="px-3 py-3 text-right">—</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.key} className={`rounded-xl border border-slate-100 p-3 ${row.key === 'organic' ? 'bg-slate-50/60' : ''}`} data-testid="ad-card">
            <div className="flex items-start justify-between gap-2">
              <AdTitle row={row} />
              <ConversionChip value={row.conversion} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div>
                <dt className="text-slate-400">Chats</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{nf.format(row.chats)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Pedidos</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{nf.format(row.orders)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Pagados</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{nf.format(row.paidOrders)}</dd>
              </div>
            </dl>
            <div className="mt-2">
              <MoneyCell
                main={money(row)}
                second={collectedFirst ? row.booked : row.collected}
                secondLabel={secondLabel}
                max={max}
                symbol={symbol}
                cls={row.key === 'organic' ? NEUTRAL_SERIES : SERIES[0]}
              />
            </div>
          </li>
        ))}
        {noChat.orders > 0 ? (
          <li className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-500" data-testid="ad-card-no-chat">
            <p className="font-medium">Pedido sin chat</p>
            <p className="tabular-nums">
              {nf.format(noChat.orders)} pedidos · {formatCompactMoney(money(noChat), symbol)}
            </p>
          </li>
        ) : null}
        {cancelled.orders > 0 ? (
          <li className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-400" data-testid="ad-card-cancelled">
            <p className="font-medium">Cancelados (no se atribuyen)</p>
            <p className="tabular-nums">
              {nf.format(cancelled.orders)} pedidos · {formatCompactMoney(money(cancelled), symbol)}
            </p>
          </li>
        ) : null}
      </ul>

      {report.hiddenAds > 0 ? (
        <p className="text-[11.5px] text-slate-400">
          Y {nf.format(report.hiddenAds)} anuncios más con menos actividad (están sumados en los totales de arriba).
        </p>
      ) : null}

      <details className="group rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12px] text-slate-600">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-slate-700">
          <HelpCircle className="h-4 w-4 text-slate-400" aria-hidden />
          ¿Cómo se cuenta?
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Un chat cuenta para un anuncio si el cliente escribió tocando ese anuncio dentro del período.</li>
          <li>
            Un pedido es del último anuncio que tocó el cliente antes de hacer el pedido, si fue en los {report.windowDays} días
            anteriores (la misma regla que usa Meta). Si no, cuenta como “Sin anuncio”.
          </li>
          <li>Solo se pueden atribuir los pedidos vinculados a un chat. Los demás aparecen como “Pedido sin chat”.</li>
          <li>Conversión = pedidos del período ÷ chats del período (aproximada: un pedido puede venir de un chat de antes).</li>
          <li>
            Pagados y cobrado usan la misma regla que el Resumen (pagado o contra entrega confirmada). Los cancelados no se atribuyen a
            ningún anuncio; aparecen aparte para que el total cuadre con el Resumen.
          </li>
          <li>Solo cuentan los chats que llegaron de un anuncio pagado; un post orgánico o un enlace de la biografía cuentan como “Sin anuncio”.</li>
          <li>El nombre de la campaña aparecerá cuando Meta nos dé permiso de leer tus anuncios; por ahora mostramos el título y el ID.</li>
        </ul>
      </details>
    </div>
  )
}

function View() {
  const { spec, setSpec, range, query } = useUrlPeriod()
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const [canal, setCanal] = useState<ChannelKey>('')
  const [res, reload] = useInsightsJson<Payload>(range ? `/api/estadisticas/anuncios?${query}${canal ? `&canal=${canal}` : ''}` : null)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insights-ads">
      <InsightsHeader title="Ventas por anuncio" subtitle="Qué anuncio de Meta trae chats, pedidos y plata" spec={spec} range={range} onPeriod={setSpec} />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-8 pt-5 md:px-7">
        <InsightCard
          icon={Megaphone}
          title="Anuncio → chat → venta"
          subtitle="Último anuncio que tocó el cliente antes del pedido"
          state={res.state}
          onRetry={reload}
          skeletonClass="h-[320px]"
          right={<Segmented value={canal} options={CHANNELS} onChange={setCanal} label="Canal" />}
          footer={
            <SourceNote range={res.data?.range ?? range}>
              chats que llegaron desde anuncios de Meta (WhatsApp e Instagram) y pedidos vinculados a esos chats
              {res.data?.revenueMode === 'collected' ? ' · montos cobrados' : ' · montos vendidos'}
            </SourceNote>
          }
          testId="insights-ads-card"
        >
          {res.data ? <Report data={res.data} symbol={symbol} /> : null}
        </InsightCard>
      </div>
    </div>
  )
}

export function AdSalesView() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  )
}
