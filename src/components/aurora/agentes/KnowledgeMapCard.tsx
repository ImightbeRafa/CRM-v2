'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, EyeOff, MessageCircleQuestion } from 'lucide-react'

type MapFieldStatus = 'ok' | 'hidden' | 'missing' | 'na'
type MapFix = 'answer' | 'inventory' | 'brand_facts' | 'hours'
type MapField = { key: string; label: string; status: MapFieldStatus; source: string | null; snippet: string | null; fix: MapFix }
type MapLane = { key: string; label: string; used: number; written: number; budget: number }
type GapGroup = { question: string; count: number; lastAt: string; turnId: string; conversationId: string | null; answered: boolean }
type MapData = {
  agentName: string
  products: Array<{ id: string; name: string; fields: MapField[] }>
  store: MapField[]
  conflicts: Array<{ key: string; label: string; detail: string }>
  lanes: MapLane[]
  filled: number
  total: number
  percent: number
  gaps: GapGroup[] | null
  goldTest: { savedTests: number; lastPassRate: number | null; lastRunAt: string | null }
  productsAvailable: boolean
}

const STATUS: Record<MapFieldStatus, { text: string; tone: string; Icon: typeof CheckCircle2 }> = {
  ok: { text: 'Lo sabe', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  hidden: { text: 'Escrito, pero no entra', tone: 'border-amber-200 bg-amber-50 text-amber-800', Icon: EyeOff },
  missing: { text: 'Falta', tone: 'border-red-200 bg-red-50 text-red-700', Icon: CircleDashed },
  na: { text: 'No aplica', tone: 'border-slate-200 bg-slate-50 text-slate-500', Icon: CircleDashed },
}

const FIX_TEXT: Record<MapFix, string> = {
  answer: 'Agregalo en una fuente de conocimiento (abajo) o en una respuesta guardada.',
  inventory: 'Se toma del inventario: ponele precio al producto en Ventas.',
  brand_facts: 'Se toma de los datos del negocio (pestaña Personalidad).',
  hours: 'Se toma del horario de atención del agente.',
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })

function FieldChip({ field }: { field: MapField }) {
  const s = STATUS[field.status]
  const detail =
    field.status === 'ok'
      ? `${field.source ?? ''}${field.snippet ? ` · "${field.snippet}"` : ''}`
      : field.status === 'hidden'
        ? `Está en "${field.source}", pero esa fuente no entra en el espacio de la IA: el agente no la ve.`
        : field.status === 'missing'
          ? FIX_TEXT[field.fix]
          : 'Marcado como no aplica.'
  return (
    <span title={detail} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.tone}`}>
      <s.Icon className="h-3 w-3" aria-hidden="true" />
      {field.label}
    </span>
  )
}

/**
 * Mapa de conocimiento: what this agent knows, measured against what really fits in the AI's space, per product and
 * for the store; conflicts with the settings; and the questions it could not answer (last 90 days).
 */
export function KnowledgeMapCard({ agentId, refreshKey }: { agentId: string; refreshKey: number }) {
  const [map, setMap] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/knowledge-map`)
      const data = await res.json()
      if (requestRef.current !== requestId) return
      if (!res.ok || !data?.success) throw new Error(typeof data?.error === 'string' ? data.error : 'No se pudo cargar el mapa')
      setMap(data.map as MapData)
      setError(null)
    } catch (e) {
      if (requestRef.current !== requestId) return
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapa')
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load, refreshKey])

  if (loading && !map) return <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-[13px] text-slate-500">Cargando el mapa…</div>
  if (error && !map) return <div className="rounded-2xl border border-red-200 bg-white p-4 text-[13px] text-red-600">{error}</div>
  if (!map) return null

  const overflow = map.lanes.filter((l) => l.written > l.used)
  const pending = (map.gaps ?? []).filter((g) => !g.answered)

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5" data-testid="knowledge-map">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-au-ink-0e0d17">Mapa de conocimiento</h3>
          <p className="text-[12px] text-slate-500">Lo que el agente sabe de cada producto y de la tienda, contando solo lo que de verdad entra en su espacio.</p>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-semibold text-au-ink-0e0d17">
            {map.filled} de {map.total} · {map.percent} %
          </p>
          <span className="mt-1 block h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF]" style={{ width: `${map.percent}%` }} />
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {map.lanes.map((l) => {
          const over = l.written > l.used
          return (
            <div key={l.key} className={`rounded-xl border px-3 py-2 ${over ? 'border-amber-300 bg-amber-50' : 'border-slate-200/70'}`}>
              <p className="text-[12px] font-medium text-au-ink-0e0d17">Espacio · {l.label}</p>
              <p className="text-[11px] text-slate-600">
                {l.used.toLocaleString('es-CR')} de {l.budget.toLocaleString('es-CR')} caracteres
                {over ? ` · ${(l.written - l.used).toLocaleString('es-CR')} escritos que la IA no ve` : ''}
              </p>
            </div>
          )
        })}
      </div>
      {overflow.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Hay fuentes que no entran en el espacio de la IA y se saltan enteras. Acortalas o uní lo repetido para que el agente las vea.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-au-ink-0e0d17">Productos</p>
        {!map.productsAvailable || map.products.length === 0 ? (
          <p className="text-[12px] text-slate-500">Este agente todavía no tiene productos asignados.</p>
        ) : (
          map.products.map((p) => (
            <div key={p.id} className="flex flex-col gap-1.5 border-b border-slate-100 pb-2 last:border-0 sm:flex-row sm:items-start">
              <span className="w-44 shrink-0 text-[12px] font-medium text-au-ink-0e0d17">{p.name}</span>
              <span className="flex flex-wrap gap-1.5">
                {p.fields.map((f) => (
                  <FieldChip key={f.key} field={f} />
                ))}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-au-ink-0e0d17">Tienda</p>
        <span className="flex flex-wrap gap-1.5">
          {map.store.map((f) => (
            <FieldChip key={f.key} field={f} />
          ))}
        </span>
      </div>

      {map.conflicts.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-red-200 px-3 py-2">
          <p className="text-[13px] font-semibold text-red-700">Datos que no coinciden</p>
          {map.conflicts.map((c) => (
            <p key={c.key} className="text-[12px] text-slate-700">
              <span className="font-medium">{c.label}:</span> {c.detail}
            </p>
          ))}
          <p className="text-[11px] text-slate-500">Elegí cuál es el correcto y corregí el otro; mientras tanto el agente puede contestar distinto según la pregunta.</p>
        </div>
      )}

      {map.gaps !== null && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-au-ink-0e0d17">
            <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
            Preguntas que no supo responder (90 días)
            {pending.length > 0 && <span className="rounded-full bg-red-50 px-2 text-[11px] text-red-700">{pending.length} sin respuesta</span>}
          </p>
          {map.gaps.length === 0 ? (
            <p className="text-[12px] text-slate-500">Ninguna por ahora. Cuando el agente pase un chat porque no tenía la respuesta, la pregunta aparece acá.</p>
          ) : (
            map.gaps.map((g) => (
              <div key={g.turnId} className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
                <span className="text-[12px] text-slate-800">“{g.question}”</span>
                <span className="shrink-0 text-right text-[11px] text-slate-500">
                  {g.count > 1 ? `${g.count} veces · ` : ''}
                  {dateText(g.lastAt)}
                  {g.answered ? <span className="ml-1 rounded-full bg-emerald-50 px-1.5 text-emerald-700">ya respondida</span> : null}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <p className="text-[12px] text-slate-500">
        Pruebas guardadas: {map.goldTest.savedTests}
        {map.goldTest.lastPassRate !== null && map.goldTest.lastRunAt
          ? ` · última corrida: ${map.goldTest.lastPassRate} % (${dateText(map.goldTest.lastRunAt)})`
          : ' · todavía no se corrieron en Probar'}
      </p>
    </section>
  )
}
