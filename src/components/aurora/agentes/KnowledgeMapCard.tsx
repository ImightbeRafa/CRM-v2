'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, EyeOff, MessageCircleQuestion, MinusCircle } from 'lucide-react'

type MapFieldStatus = 'ok' | 'hidden' | 'missing' | 'na'
type MapFix = 'answer' | 'inventory' | 'brand_facts' | 'shipping_methods' | 'sales_rules'
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
  notMeasured: number
  gaps: GapGroup[] | null
  goldTest: { savedTests: number; lastPassRate: number | null; lastRunAt: string | null }
  productsAvailable: boolean
}

const STATUS: Record<MapFieldStatus, { text: string; tone: string; Icon: typeof CheckCircle2 }> = {
  ok: { text: 'Lo sabe', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  hidden: { text: 'Escrito, pero no entra', tone: 'border-amber-200 bg-amber-50 text-amber-800', Icon: EyeOff },
  missing: { text: 'Falta', tone: 'border-red-200 bg-red-50 text-red-700', Icon: CircleDashed },
  na: { text: 'No aplica', tone: 'border-slate-200 bg-slate-50 text-slate-500', Icon: MinusCircle },
}

const FIX_TEXT: Record<MapFix, string> = {
  answer: 'Escribilo en una fuente de conocimiento (abajo) o en una respuesta guardada.',
  inventory: 'Se toma del inventario: ponele precio al producto en Ventas.',
  brand_facts: 'Se toma de los datos del negocio (pestaña Personalidad).',
  shipping_methods: 'Se toma de Configuración › Métodos de envío.',
  sales_rules: 'Se toma de los combos o la promoción del agente.',
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })

function fieldDetail(field: MapField): string {
  if (field.status === 'ok') return `Fuente: ${field.source ?? '—'}${field.snippet ? ` · “${field.snippet}”` : ''}`
  if (field.status === 'hidden') return `Está en “${field.source}”, pero esa fuente no entra en el espacio de la IA: el agente no la ve. Acortala o uní lo repetido.`
  if (field.status === 'missing') return FIX_TEXT[field.fix]
  return 'Marcado como no aplica para este negocio.'
}

function FieldChip({ field, selected, onSelect }: { field: MapField; selected: boolean; onSelect: () => void }) {
  const s = STATUS[field.status]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.tone} ${selected ? 'ring-2 ring-[#5B6CFF]/40' : ''}`}
    >
      <s.Icon className="h-3 w-3" aria-hidden="true" />
      {field.label}
      <span className="font-normal opacity-80">· {s.text}</span>
    </button>
  )
}

function FieldRow({ fields, rowKey, open, onOpen }: { fields: MapField[]; rowKey: string; open: string | null; onOpen: (key: string | null) => void }) {
  const selected = fields.find((f) => `${rowKey}:${f.key}` === open) ?? null
  return (
    <div className="space-y-1.5">
      <span className="flex flex-wrap gap-1.5">
        {fields.map((f) => {
          const id = `${rowKey}:${f.key}`
          return <FieldChip key={f.key} field={f} selected={open === id} onSelect={() => onOpen(open === id ? null : id)} />
        })}
      </span>
      {selected && <p className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">{fieldDetail(selected)}</p>}
    </div>
  )
}

/**
 * Mapa de conocimiento: what this agent knows, measured against what really fits in the AI's space, per product and
 * for the store; data that does not match the settings; and the questions it could not answer (last 90 days).
 * Loads only while the Conocimiento tab is open.
 */
export function KnowledgeMapCard({ agentId, active, refreshKey }: { agentId: string; active: boolean; refreshKey: number }) {
  const [map, setMap] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    try {
      // After a knowledge change (refreshKey > 0) skip the server's short cache so the change shows at once.
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/knowledge-map${refreshKey > 0 ? '?fresh=1' : ''}`)
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
  }, [agentId, refreshKey])

  useEffect(() => {
    if (!active) return
    void load()
  }, [active, load])

  if (!map) {
    if (error) return <div className="rounded-2xl border border-red-200 bg-white p-4 text-[13px] text-red-600">{error}</div>
    return <div className="rounded-2xl border border-slate-200/70 bg-white p-4 text-[13px] text-slate-500">{loading ? 'Cargando el mapa…' : 'Abrí esta pestaña para ver el mapa.'}</div>
  }

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
            <span className="block h-full rounded-full bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF]" style={{ width: `${Math.max(0, Math.min(100, map.percent))}%` }} />
          </span>
        </div>
      </header>
      {error && <p className="text-[12px] text-red-600">No se pudo actualizar: {error}</p>}
      {map.notMeasured > 0 && (
        <p className="text-[12px] text-amber-800">Hay {map.notMeasured} textos muy largos o de más que el mapa no alcanzó a revisar completos.</p>
      )}

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {(Object.keys(STATUS) as MapFieldStatus[]).map((k) => {
          const s = STATUS[k]
          return (
            <span key={k} className="inline-flex items-center gap-1">
              <s.Icon className="h-3 w-3" aria-hidden="true" />
              {s.text}
            </span>
          )
        })}
        <span>· Tocá un dato para ver de dónde sale o cómo completarlo.</span>
      </p>

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
              <FieldRow fields={p.fields} rowKey={p.id} open={open} onOpen={setOpen} />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-au-ink-0e0d17">Tienda</p>
        <FieldRow fields={map.store} rowKey="store" open={open} onOpen={setOpen} />
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
      <p className="text-[11px] text-slate-400">El mapa cuenta el conocimiento propio del agente; los textos especiales de una sola línea no se incluyen.</p>
    </section>
  )
}
