'use client'

/**
 * Estadísticas › Equipo y chats: how fast the team answers, what is waiting, who carries the load and
 * which channel sells (Lane E2). Math: src/lib/insights/team-chat-metrics.ts.
 */
import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowRight, Gauge, Hourglass, Inbox, MessagesSquare, Radio, Timer, Users } from 'lucide-react'
import { AuroraEmptyState } from '@/components/aurora/states'
import { formatDayLabel } from '@/lib/statistics-aurora'
import { formatDurationEs, formatPercent } from '@/lib/insights/stats-math'
import type { ChannelMetrics, TeamChatReport } from '@/lib/insights/team-chat-metrics'
import { InsightsHeader, SourceNote, nf, useInsightsJson, useUrlPeriod } from './InsightsShared'
import { AreaChart, InsightCard, Meter, SERIES, StatTile, StatusChip, Swatch, type ChipTone } from './charts'

type Payload = {
  range: { startDate: string; endDate: string }
  report: TeamChatReport
  team: Array<{ userId: string; name: string }>
}

const CHANNEL_LABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram' } as const
const DAY_MS = 86_400_000

/** "Al día" / "N esperando" / "N esperando · más de un día". */
function waitingChip(waiting: number, oldestMs: number | null): { tone: ChipTone; text: string } {
  if (waiting === 0) return { tone: 'good', text: 'Al día' }
  if (oldestMs !== null && oldestMs > DAY_MS) return { tone: 'critical', text: `${nf.format(waiting)} esperando · más de un día` }
  return { tone: 'warning', text: `${nf.format(waiting)} esperando` }
}

function ChannelPanel({ c }: { c: ChannelMetrics }) {
  const chip = waitingChip(c.waiting, c.oldestWaitingMs)
  return (
    <div className="rounded-xl border border-slate-100 p-3.5" data-testid={`team-channel-${c.channel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-900">
          <Swatch cls={c.channel === 'instagram' ? SERIES[3] : SERIES[1]} />
          {CHANNEL_LABEL[c.channel]}
        </p>
        <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <dt className="text-slate-400">1.ª respuesta</dt>
          <dd className="text-[17px] font-semibold text-slate-900">{formatDurationEs(c.firstResponseMedianMs)}</dd>
          <dd className="text-[10.5px] text-slate-400">
            9 de 10: {formatDurationEs(c.firstResponseP90Ms)} · {nf.format(c.firstResponseSamples)} medidos
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Esperando ahora</dt>
          <dd className="text-[17px] font-semibold text-slate-900">{nf.format(c.waiting)}</dd>
          <dd className="text-[10.5px] text-slate-400">más viejo: {formatDurationEs(c.oldestWaitingMs)}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-[12px]">
          <span className="text-slate-500">Chat → pedido</span>
          <span className="font-semibold tabular-nums text-slate-900">{formatPercent(c.chatToSale)}</span>
        </div>
        <Meter value={c.chatToSale ?? 0} tone="brand" label={`Chat a pedido en ${CHANNEL_LABEL[c.channel]}`} />
        <p className="mt-1 text-[10.5px] text-slate-400">
          {nf.format(c.linkedOrders)} pedidos / {nf.format(c.chatsStarted)} chats nuevos
        </p>
      </div>
    </div>
  )
}

function View() {
  const { spec, setSpec, range, query } = useUrlPeriod()
  const [res, reload] = useInsightsJson<Payload>(range ? `/api/estadisticas/equipo?${query}` : null)
  const data = res.data
  const report = data?.report
  const names = new Map((data?.team ?? []).map((m) => [m.userId, m.name]))
  const teammates = (report?.teammates ?? []).filter((t) => names.has(t.userId))
  const maxReplies = teammates.reduce((m, t) => Math.max(m, t.replies), 0)
  const daily = report?.daily ?? []
  const hasDaily = daily.some((d) => d.medianMs !== null)
  // Plot in the unit that gives round gridlines: hours for slow days, minutes, or seconds when everything is fast.
  const maxDailyMs = daily.reduce((m, d) => Math.max(m, d.medianMs ?? 0), 0)
  const unit = maxDailyMs >= 2 * 3_600_000 ? { ms: 3_600_000, label: 'h' } : maxDailyMs >= 120_000 ? { ms: 60_000, label: 'min' } : { ms: 1000, label: 's' }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insights-team">
      <InsightsHeader title="Equipo y chats" subtitle="Qué tan rápido respondemos, qué está esperando y qué canal vende" spec={spec} range={range} onPeriod={setSpec} />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-8 pt-5 md:px-7">
        <InsightCard
          icon={Timer}
          title="Velocidad del equipo"
          subtitle="Primera respuesta de una persona y chats esperando"
          state={res.state}
          onRetry={reload}
          skeletonClass="h-[260px]"
          right={
            report && report.overall.waiting > 0 ? (
              <Link
                href="/chats"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-[#5B6CFF] px-3.5 text-[12.5px] font-semibold text-white hover:opacity-95"
              >
                Ir a responder <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : undefined
          }
          footer={
            <SourceNote range={data?.range}>
              primera respuesta = desde el primer mensaje del cliente hasta la primera respuesta de una persona en Betsy (solo chats que
              respondió primero una persona, medido desde el 30 sep 2026); “esperando” = el último mensaje es del cliente (ahora mismo)
            </SourceNote>
          }
        >
          {report ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatTile icon={Timer} label="1.ª respuesta (mediana)" value={formatDurationEs(report.overall.firstResponseMedianMs)} hint={`${nf.format(report.overall.samples)} chats medidos`} />
                <StatTile icon={Gauge} tone="amber" label="1.ª respuesta (9 de 10)" value={formatDurationEs(report.overall.firstResponseP90Ms)} hint="el 90 % respondió en menos" />
                <StatTile
                  icon={Hourglass}
                  tone={report.overall.waiting > 0 ? 'pink' : 'green'}
                  label="Esperando ahora"
                  value={nf.format(report.overall.waiting)}
                  hint={`${nf.format(report.overall.waitingUnassigned)} sin asignar`}
                />
                <StatTile icon={Inbox} tone="neutral" label="Chats abiertos" value={nf.format(report.overall.open)} hint="con movimiento en 30 días" />
              </dl>
              <div className="rounded-xl border border-slate-100 p-3.5">
                <p className="text-[12.5px] font-semibold text-slate-800">Primera respuesta por día</p>
                <p className="mb-3 text-[11px] text-slate-400">Mediana de cada día (más bajo es mejor)</p>
                {hasDaily ? (
                  <AreaChart
                    labels={daily.map((d) => d.date)}
                    tickLabel={(d) => formatDayLabel(d)}
                    series={[{ key: 'median', label: 'Mediana', cls: SERIES[0], values: daily.map((d) => (d.medianMs === null ? null : d.medianMs / unit.ms)) }]}
                    format={(v) => formatDurationEs(v * unit.ms)}
                    axisFormat={(v) => `${nf.format(Math.round(v * 10) / 10)} ${unit.label}`}
                    ariaLabel="Mediana de la primera respuesta por día"
                  />
                ) : (
                  <p className="py-6 text-center text-[12px] text-slate-400">Todavía no hay respuestas medidas en este período.</p>
                )}
              </div>
            </div>
          ) : null}
        </InsightCard>

        <InsightCard
          icon={Radio}
          title="Por canal"
          subtitle="WhatsApp e Instagram"
          state={res.state}
          onRetry={reload}
          skeletonClass="h-[160px]"
          footer={
            <SourceNote range={data?.range}>
              chats nuevos del período por canal y pedidos del período vinculados a un chat (aproximado: un pedido puede venir de un chat
              anterior)
            </SourceNote>
          }
        >
          {report ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {report.channels.map((c) => (
                <ChannelPanel key={c.channel} c={c} />
              ))}
            </div>
          ) : null}
        </InsightCard>

        <InsightCard
          icon={Users}
          title="Por persona"
          subtitle="Carga de trabajo y velocidad de cada quien"
          state={res.state}
          onRetry={reload}
          skeletonClass="h-[180px]"
          footer={
            teammates.length ? (
              <SourceNote range={data?.range}>
                respuestas enviadas desde Betsy en el período; asignados y esperando = ahora mismo (chats abiertos con movimiento en 30 días)
              </SourceNote>
            ) : undefined
          }
        >
          {report ? (
            teammates.length === 0 ? (
              <AuroraEmptyState
                tone="neutral"
                icon={<Users className="h-6 w-6" />}
                title="Todavía no hay datos del equipo"
                description="Cuando alguien del equipo responda chats desde Betsy, vas a ver aquí su velocidad y su carga."
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="team-list">
                {teammates.map((t) => {
                  const chip = waitingChip(t.waitingAssigned, null)
                  return (
                    <li key={t.userId} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4" data-testid="team-row">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-au-tint-eef0ff text-[11px] font-semibold text-au-ink-5b6cff" aria-hidden>
                            {(names.get(t.userId) ?? '?').trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate text-[13.5px] font-semibold text-slate-900">{names.get(t.userId)}</span>
                          <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between text-[12px]">
                          <span className="flex items-center gap-1 text-slate-500">
                            <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Respuestas
                          </span>
                          <span className="font-semibold tabular-nums text-slate-900">{nf.format(t.replies)}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-r-[4px] bg-slate-100/80">
                          <div className={`${SERIES[0]} h-full rounded-r-[4px] bg-current`} style={{ width: `${maxReplies > 0 ? Math.max(t.replies > 0 ? 2 : 0, (t.replies / maxReplies) * 100) : 0}%` }} />
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-slate-400">{nf.format(t.openAssigned)} chats asignados ahora</p>
                      </div>
                      <div className="text-[12px]">
                        <span className="text-slate-500">1.ª respuesta </span>
                        <span className="font-semibold text-slate-900">{formatDurationEs(t.firstResponseMedianMs)}</span>
                        <p className="text-[10.5px] text-slate-400">
                          9 de 10: {formatDurationEs(t.firstResponseP90Ms)} · {nf.format(t.firstResponseSamples)} medidos
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          ) : null}
        </InsightCard>
      </div>
    </div>
  )
}

export function TeamChatView() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  )
}
