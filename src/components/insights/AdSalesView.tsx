'use client'

/**
 * Estadísticas › Anuncios: which Meta ad brought chats, orders and money (Lane E2).
 * Rules shown to the user in the "¿Cómo se cuenta?" box; the math lives in src/lib/insights/ad-sales.ts.
 */
import { Suspense, useState } from 'react'
import { ExternalLink, Megaphone } from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { StatsCard } from '@/components/aurora/estadisticas/StatsCard'
import { AuroraEmptyState } from '@/components/aurora/states'
import { formatCompactMoney } from '@/lib/statistics-aurora'
import { formatPercent, rate } from '@/lib/insights/stats-math'
import { safeAdLink, type AdSalesReport, type AdSalesRow } from '@/lib/insights/ad-sales'
import { InsightsHeader, SourceNote, Tile, nf, useInsightsJson, useUrlPeriod } from './InsightsShared'

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

function PlatformBadges({ platforms }: { platforms: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {platforms.map((p) => (
        <span
          key={p}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p === 'instagram' ? 'bg-pink-50 text-pink-700' : 'bg-emerald-50 text-emerald-700'}`}
        >
          {p === 'instagram' ? 'IG' : 'WA'}
        </span>
      ))}
    </span>
  )
}

function AdTitle({ row }: { row: AdSalesRow }) {
  if (row.key === 'organic') {
    return (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">Sin anuncio</p>
        <p className="text-[11px] text-slate-400">Escribieron solos (o el anuncio fue hace más de 7 días)</p>
      </div>
    )
  }
  const link = safeAdLink(row.sourceUrl)
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-slate-900" title={row.headline ?? undefined}>
        {row.campaignName ? `${row.campaignName} · ` : ''}
        {row.headline || 'Anuncio sin título'}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
        {row.adId ? <span className="tabular-nums">ID {row.adId}</span> : null}
        <PlatformBadges platforms={row.platforms} />
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-au-ink-5b6cff hover:underline">
            Ver anuncio <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </p>
    </div>
  )
}

function Row({ row, symbol, collectedFirst }: { row: AdSalesRow; symbol: string; collectedFirst: boolean }) {
  const main = collectedFirst ? row.collected : row.booked
  const second = collectedFirst ? row.booked : row.collected
  return (
    <tr className="border-t border-slate-100 align-top" data-testid="ad-row">
      <td className="max-w-[320px] py-2.5 pr-3">
        <AdTitle row={row} />
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(row.chats)}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(row.orders)}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(row.paidOrders)}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">
        <span className="font-medium text-slate-900">{formatCompactMoney(main, symbol)}</span>
        <span className="block text-[11px] text-slate-400">
          {collectedFirst ? 'vendido' : 'cobrado'} {formatCompactMoney(second, symbol)}
        </span>
      </td>
      <td className="py-2.5 text-right tabular-nums">{formatPercent(row.conversion)}</td>
    </tr>
  )
}

function MobileRow({ row, symbol, collectedFirst }: { row: AdSalesRow; symbol: string; collectedFirst: boolean }) {
  return (
    <li className="rounded-xl border border-slate-100 p-3" data-testid="ad-card">
      <AdTitle row={row} />
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="text-slate-400">Chats</dt>
          <dd className="font-semibold tabular-nums">{nf.format(row.chats)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Pedidos</dt>
          <dd className="font-semibold tabular-nums">
            {nf.format(row.orders)} <span className="font-normal text-slate-400">({nf.format(row.paidOrders)} pag.)</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Conversión</dt>
          <dd className="font-semibold tabular-nums">{formatPercent(row.conversion)}</dd>
        </div>
        <div className="col-span-3">
          <dt className="text-slate-400">{collectedFirst ? 'Cobrado' : 'Vendido'}</dt>
          <dd className="font-semibold tabular-nums">
            {formatCompactMoney(collectedFirst ? row.collected : row.booked, symbol)}{' '}
            <span className="font-normal text-slate-400">
              · {collectedFirst ? 'vendido' : 'cobrado'} {formatCompactMoney(collectedFirst ? row.booked : row.collected, symbol)}
            </span>
          </dd>
        </div>
      </dl>
    </li>
  )
}

function Report({ data, symbol }: { data: Payload; symbol: string }) {
  const { report, revenueMode } = data
  const collectedFirst = revenueMode === 'collected'
  const rows: AdSalesRow[] = [...report.rows, report.organic]
  const noChat = report.withoutChat
  const cancelled = report.cancelled
  const adMoney = report.rows.reduce((s, r) => s + (collectedFirst ? r.collected : r.booked), 0)
  const totalMoney = collectedFirst ? report.totals.collected : report.totals.booked

  return (
    <>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Chats desde anuncios" value={nf.format(report.totals.adChatsDistinct)} hint={`${nf.format(report.totals.organicChats)} sin anuncio`} />
        <Tile label="Pedidos desde anuncios" value={nf.format(report.totals.adOrders)} hint={`de ${nf.format(report.totals.orders)} pedidos en total`} />
        <Tile
          label={collectedFirst ? 'Cobrado por anuncios' : 'Vendido por anuncios'}
          value={formatCompactMoney(adMoney, symbol)}
          hint={`${formatPercent(rate(adMoney, totalMoney))} del total`}
        />
        <Tile
          label="Conversión anuncios"
          value={formatPercent(rate(report.totals.adOrders, report.totals.adChatsDistinct))}
          hint={`sin anuncio: ${formatPercent(report.organic.conversion)}`}
        />
      </dl>

      {report.rows.length === 0 ? (
        <AuroraEmptyState
          tone="neutral"
          icon={<Megaphone className="h-6 w-6" />}
          title="Todavía no hay chats desde anuncios en este período"
          description="Cuando un cliente escribe tocando un anuncio de Facebook o Instagram, Betsy guarda de qué anuncio vino y aparece aquí con sus pedidos."
          className="py-8"
        />
      ) : null}

      <div className="mt-4 hidden md:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="pb-2 pr-3 font-medium">Anuncio</th>
              <th className="pb-2 pr-3 text-right font-medium">Chats</th>
              <th className="pb-2 pr-3 text-right font-medium">Pedidos</th>
              <th className="pb-2 pr-3 text-right font-medium">Pagados</th>
              <th className="pb-2 pr-3 text-right font-medium">{collectedFirst ? 'Cobrado' : 'Vendido'}</th>
              <th className="pb-2 text-right font-medium">Conversión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.key} row={row} symbol={symbol} collectedFirst={collectedFirst} />
            ))}
            {noChat.orders > 0 ? (
              <tr className="border-t border-slate-100 align-top text-slate-500" data-testid="ad-row-no-chat">
                <td className="py-2.5 pr-3">
                  <p className="font-medium">Pedido sin chat</p>
                  <p className="text-[11px] text-slate-400">Pedidos que no están vinculados a ningún chat</p>
                </td>
                <td className="py-2.5 pr-3 text-right">—</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(noChat.orders)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(noChat.paidOrders)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{formatCompactMoney(collectedFirst ? noChat.collected : noChat.booked, symbol)}</td>
                <td className="py-2.5 text-right">—</td>
              </tr>
            ) : null}
            {cancelled.orders > 0 ? (
              <tr className="border-t border-slate-100 align-top text-slate-400" data-testid="ad-row-cancelled">
                <td className="py-2.5 pr-3">
                  <p className="font-medium">Cancelados</p>
                  <p className="text-[11px]">No se atribuyen a ningún anuncio; están para que el total cuadre con el Resumen</p>
                </td>
                <td className="py-2.5 pr-3 text-right">—</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(cancelled.orders)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(cancelled.paidOrders)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{formatCompactMoney(collectedFirst ? cancelled.collected : cancelled.booked, symbol)}</td>
                <td className="py-2.5 text-right">—</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-2 md:hidden">
        {rows.map((row) => (
          <MobileRow key={row.key} row={row} symbol={symbol} collectedFirst={collectedFirst} />
        ))}
        {noChat.orders > 0 ? (
          <li className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-500" data-testid="ad-card-no-chat">
            <p className="font-medium">Pedido sin chat</p>
            <p>
              {nf.format(noChat.orders)} pedidos · {formatCompactMoney(collectedFirst ? noChat.collected : noChat.booked, symbol)}
            </p>
          </li>
        ) : null}
        {cancelled.orders > 0 ? (
          <li className="rounded-xl border border-dashed border-slate-200 p-3 text-[12px] text-slate-400" data-testid="ad-card-cancelled">
            <p className="font-medium">Cancelados (no se atribuyen)</p>
            <p>
              {nf.format(cancelled.orders)} pedidos · {formatCompactMoney(collectedFirst ? cancelled.collected : cancelled.booked, symbol)}
            </p>
          </li>
        ) : null}
      </ul>

      {report.hiddenAds > 0 ? (
        <p className="mt-2 text-[11.5px] text-slate-400">
          Y {nf.format(report.hiddenAds)} anuncios más con menos actividad (están sumados en los totales de arriba).
        </p>
      ) : null}

      <details className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">¿Cómo se cuenta?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Un chat cuenta para un anuncio si el cliente escribió tocando ese anuncio dentro del período.</li>
          <li>
            Un pedido es del último anuncio que tocó el cliente antes de hacer el pedido, si fue en los {report.windowDays} días
            anteriores (la misma regla que usa Meta). Si no, cuenta como “Sin anuncio”.
          </li>
          <li>Solo se pueden atribuir los pedidos vinculados a un chat. Los demás aparecen como “Pedido sin chat”.</li>
          <li>Conversión = pedidos del período ÷ chats del período (aproximada: un pedido puede venir de un chat de antes).</li>
          <li>Pagados y cobrado usan la misma regla que el Resumen (pagado o contra entrega confirmada). Los cancelados no se atribuyen a ningún anuncio; aparecen aparte para que el total cuadre con el Resumen.</li>
          <li>Solo cuentan los chats que llegaron de un anuncio pagado; un post orgánico o un enlace de la biografía cuentan como “Sin anuncio”.</li>
          <li>El nombre de la campaña aparecerá cuando Meta nos dé permiso de leer tus anuncios; por ahora mostramos el título y el ID.</li>
        </ul>
      </details>
    </>
  )
}

function View() {
  const { spec, setSpec, range, query } = useUrlPeriod()
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const [canal, setCanal] = useState<string>('')
  const [res, reload] = useInsightsJson<Payload>(range ? `/api/estadisticas/anuncios?${query}${canal ? `&canal=${canal}` : ''}` : null)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insights-ads">
      <InsightsHeader title="Ventas por anuncio" subtitle="Qué anuncio de Meta trae chats, pedidos y plata" spec={spec} range={range} onPeriod={setSpec} />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-6 pt-5 md:px-7">
        <StatsCard
          title="Anuncio → chat → venta"
          subtitle="Último anuncio que tocó el cliente antes del pedido"
          state={res.state}
          onRetry={reload}
          skeletonClass="h-[260px]"
          right={
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Canal">
              {CHANNELS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={canal === c.key}
                  onClick={() => setCanal(c.key)}
                  className={`min-h-[32px] rounded-md px-2.5 text-[12px] font-medium ${canal === c.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          }
        >
          {res.data ? <Report data={res.data} symbol={symbol} /> : null}
          <SourceNote range={res.data?.range ?? range}>
            chats que llegaron desde anuncios de Meta (WhatsApp e Instagram) y pedidos vinculados a esos chats
            {res.data?.revenueMode === 'collected' ? ' · montos cobrados' : ' · montos vendidos'}
          </SourceNote>
        </StatsCard>
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
