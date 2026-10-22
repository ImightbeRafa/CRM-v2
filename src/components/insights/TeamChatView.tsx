'use client'

/**
 * Estadísticas › Equipo y chats: how fast the team answers, what is waiting, who carries the load and
 * which channel sells (Lane E2). Math: src/lib/insights/team-chat-metrics.ts.
 */
import { Suspense } from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { StatsCard } from '@/components/aurora/estadisticas/StatsCard'
import { AuroraEmptyState } from '@/components/aurora/states'
import { formatDurationEs, formatPercent } from '@/lib/insights/stats-math'
import type { TeamChatReport } from '@/lib/insights/team-chat-metrics'
import { InsightsHeader, SourceNote, Tile, nf, useInsightsJson, useUrlPeriod } from './InsightsShared'

type Payload = {
  range: { startDate: string; endDate: string }
  report: TeamChatReport
  team: Array<{ userId: string; name: string }>
}

const CHANNEL_LABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram' } as const

function View() {
  const { spec, setSpec, range, query } = useUrlPeriod('30d')
  const [res, reload] = useInsightsJson<Payload>(range ? `/api/estadisticas/equipo?${query}` : null)
  const data = res.data
  const report = data?.report
  const names = new Map((data?.team ?? []).map((m) => [m.userId, m.name]))
  const teammates = (report?.teammates ?? []).filter((t) => names.has(t.userId))

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insights-team">
      <InsightsHeader title="Equipo y chats" subtitle="Qué tan rápido respondemos, qué está esperando y qué canal vende" spec={spec} range={range} onPeriod={setSpec} />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-6 pt-5 md:px-7">
        <StatsCard title="Resumen" subtitle="Primera respuesta de una persona y chats esperando" state={res.state} onRetry={reload} skeletonClass="h-[90px]">
          {report ? (
            <>
              <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Tile label="Primera respuesta (mediana)" value={formatDurationEs(report.overall.firstResponseMedianMs)} hint={`${nf.format(report.overall.samples)} chats medidos`} />
                <Tile label="Primera respuesta (9 de 10)" value={formatDurationEs(report.overall.firstResponseP90Ms)} hint="el 90 % respondió en menos" />
                <Tile label="Esperando respuesta ahora" value={nf.format(report.overall.waiting)} hint={`${nf.format(report.overall.waitingUnassigned)} sin asignar`} />
                <Tile label="Chats abiertos" value={nf.format(report.overall.open)} hint="con movimiento en 30 días" />
              </dl>
              {report.overall.waiting > 0 ? (
                <Link href="/chats" className="mt-3 inline-flex min-h-[40px] items-center rounded-xl bg-au-tint-eef0ff px-3 text-[13px] font-medium text-au-ink-5b6cff">
                  Ir a responder
                </Link>
              ) : null}
              <SourceNote range={data?.range}>
                primera respuesta = desde el primer mensaje del cliente hasta la primera respuesta de una persona en Betsy (solo chats que
                respondió primero una persona, medido desde el 30 sep 2026); “esperando” = el último mensaje es del cliente (ahora mismo)
              </SourceNote>
            </>
          ) : null}
        </StatsCard>

        <StatsCard title="Por canal" subtitle="WhatsApp e Instagram" state={res.state} onRetry={reload} skeletonClass="h-[140px]">
          {report ? (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {report.channels.map((c) => (
                  <div key={c.channel} className="rounded-xl border border-slate-100 p-3" data-testid={`team-channel-${c.channel}`}>
                    <p className="text-[13px] font-semibold text-slate-900">{CHANNEL_LABEL[c.channel]}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
                      <div>
                        <dt className="text-slate-400">1.ª respuesta</dt>
                        <dd className="font-semibold tabular-nums">{formatDurationEs(c.firstResponseMedianMs)}</dd>
                        <dd className="text-[10.5px] text-slate-400">9 de 10: {formatDurationEs(c.firstResponseP90Ms)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Esperando</dt>
                        <dd className="font-semibold tabular-nums">{nf.format(c.waiting)}</dd>
                        <dd className="text-[10.5px] text-slate-400">más viejo: {formatDurationEs(c.oldestWaitingMs)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Chat → pedido</dt>
                        <dd className="font-semibold tabular-nums">{formatPercent(c.chatToSale)}</dd>
                        <dd className="text-[10.5px] text-slate-400">
                          {nf.format(c.linkedOrders)} pedidos / {nf.format(c.chatsStarted)} chats nuevos
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
              <SourceNote range={data?.range}>
                chats nuevos del período por canal y pedidos del período vinculados a un chat (aproximado: un pedido puede venir de un chat
                anterior)
              </SourceNote>
            </>
          ) : null}
        </StatsCard>

        <StatsCard title="Por persona" subtitle="Carga de trabajo y velocidad de cada quien" state={res.state} onRetry={reload} skeletonClass="h-[160px]">
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
              <>
                <div className="hidden md:block">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-3 font-medium">Persona</th>
                        <th className="pb-2 pr-3 text-right font-medium">Respuestas enviadas</th>
                        <th className="pb-2 pr-3 text-right font-medium">Chats asignados</th>
                        <th className="pb-2 pr-3 text-right font-medium">Esperando</th>
                        <th className="pb-2 pr-3 text-right font-medium">1.ª respuesta</th>
                        <th className="pb-2 text-right font-medium">9 de 10</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teammates.map((t) => (
                        <tr key={t.userId} className="border-t border-slate-100" data-testid="team-row">
                          <td className="py-2.5 pr-3 font-medium text-slate-900">{names.get(t.userId)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(t.replies)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(t.openAssigned)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{nf.format(t.waitingAssigned)}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">
                            {formatDurationEs(t.firstResponseMedianMs)}
                            <span className="block text-[10.5px] text-slate-400">{nf.format(t.firstResponseSamples)} medidos</span>
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{formatDurationEs(t.firstResponseP90Ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="space-y-2 md:hidden">
                  {teammates.map((t) => (
                    <li key={t.userId} className="rounded-xl border border-slate-100 p-3 text-[12px]" data-testid="team-card">
                      <p className="text-[13px] font-semibold text-slate-900">{names.get(t.userId)}</p>
                      <p className="mt-1 text-slate-600">
                        {nf.format(t.replies)} respuestas · {nf.format(t.openAssigned)} asignados · {nf.format(t.waitingAssigned)} esperando
                      </p>
                      <p className="text-slate-500">
                        1.ª respuesta {formatDurationEs(t.firstResponseMedianMs)} (9 de 10: {formatDurationEs(t.firstResponseP90Ms)})
                      </p>
                    </li>
                  ))}
                </ul>
                <SourceNote range={data?.range}>
                  respuestas enviadas desde Betsy en el período; asignados y esperando = ahora mismo (chats abiertos con movimiento en 30
                  días)
                </SourceNote>
              </>
            )
          ) : null}
        </StatsCard>
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
