'use client'

import { FileText, Plus } from 'lucide-react'
import { KIND_LABELS, relativeUpdated, sourceStatus, sourceTopic } from './knowledge-format'

export type KnowledgeSourceRow = {
  id: string
  kind: string
  name: string
  status: string
  version: number
  updatedAt: string
}

const TONE: Record<'ok' | 'draft' | 'muted', string> = {
  ok: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-amber-50 text-amber-800',
  muted: 'bg-slate-100 text-slate-500',
}

function StatusChip({ status }: { status: string }) {
  const s = sourceStatus(status)
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[s.tone]}`}>{s.label}</span>
  )
}

/** "Fuentes": real `ChatKnowledgeSource` rows with real status and updated time. */
export function KnowledgeSourcesTable({
  sources,
  boundIds,
  loading,
  error,
  unavailable,
  canEdit,
  onPasteText,
}: {
  sources: KnowledgeSourceRow[]
  /** Source ids bound to this agent (approved sources outside it are flagged). */
  boundIds: ReadonlySet<string>
  loading: boolean
  error: string | null
  /** Knowledge schema not applied yet. */
  unavailable: boolean
  canEdit: boolean
  onPasteText: () => void
}) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white" data-testid="knowledge-sources">
      <header className="flex items-center justify-between gap-3 px-4 py-4 md:px-5">
        <h3 className="text-[15px] font-semibold text-[#0E0D17]">Fuentes</h3>
        {canEdit ? (
          <button
            type="button"
            onClick={onPasteText}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-[#0E0D17] hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Pegar texto
          </button>
        ) : null}
      </header>
      {unavailable ? (
        <p className="border-t border-slate-100 px-5 py-8 text-center text-[13px] text-slate-500">
          Conocimiento no disponible todavía
        </p>
      ) : error ? (
        <p role="alert" className="border-t border-slate-100 px-5 py-8 text-center text-[13px] text-red-700">
          {error}
        </p>
      ) : loading ? (
        <div className="space-y-2 border-t border-slate-100 p-5" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <p className="border-t border-slate-100 px-5 py-8 text-center text-[13px] text-slate-500">
          Sin fuentes todavía
        </p>
      ) : (
        <>
          <table className="hidden w-full text-[13px] md:table">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Fuente</th>
                <th className="px-3 py-2.5 font-semibold">Tema</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-5 py-2.5 font-semibold">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EEFF] text-[#7C5CFF]" aria-hidden>
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[#0E0D17]">{s.name}</span>
                        <span className="block text-[11px] text-slate-400">
                          {KIND_LABELS[s.kind as keyof typeof KIND_LABELS] ?? s.kind} · v{s.version}
                          {s.status === 'approved' && !boundIds.has(s.id) ? ' · sin vincular a este agente' : ''}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{sourceTopic(s.name, s.kind)}</td>
                  <td className="px-3 py-3">
                    <StatusChip status={s.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">{relativeUpdated(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden">
            {sources.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EEFF] text-[#7C5CFF]" aria-hidden>
                  <FileText className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[#0E0D17]">{s.name}</span>
                  <span className="block text-[11px] text-slate-400">
                    {sourceTopic(s.name, s.kind)} · {relativeUpdated(s.updatedAt)}
                  </span>
                </span>
                <StatusChip status={s.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
