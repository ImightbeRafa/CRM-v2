'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'

type Mode = 'all' | 'gam' | 'list'
type Row = {
  shippingMethodId: string
  name: string
  coverage: Mode
  places: string[]
  allowsCod: boolean
  codCoverage: 'same' | 'gam' | 'list'
  codPlaces: string[]
}

const MODE_LABEL: Record<Mode, string> = { all: 'Todo el país', gam: 'Solo GAM', list: 'Solo estas zonas' }
const PLACES_HINT = 'Una zona por línea: Provincia | Cantón | Distrito (cantón y distrito opcionales). Ej: San José | Escazú'

/**
 * Where each shipping method delivers and where it accepts contra entrega (SQL 053). The AI agent asks this to
 * code — it never decides coverage itself. Hidden until the database step is applied.
 */
export function ShippingZonesEditor() {
  const { data: session } = useSession()
  const canEdit = hasSessionPermission(session, 'update_config')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [available, setAvailable] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/config/shipping/zones', { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return
    const json = (await res.json()) as { available: boolean; methods: Row[] }
    setAvailable(json.available)
    setRows(json.methods)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(r: Row) {
    setSaving(r.shippingMethodId)
    setMsg(null)
    const res = await fetch('/api/config/shipping/zones', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    }).catch(() => null)
    const json = res ? ((await res.json().catch(() => ({}))) as { error?: string; methods?: Row[] }) : {}
    if (res?.ok && json.methods) {
      setRows(json.methods)
      setMsg(`Guardado: ${r.name}`)
    } else setMsg(json.error || 'No se pudo guardar.')
    setSaving(null)
  }

  if (!available || !rows?.length) return null
  const patch = (id: string, p: Partial<Row>) => setRows((list) => (list || []).map((x) => (x.shippingMethodId === id ? { ...x, ...p } : x)))
  const toText = (l: string[]) => l.map((k) => k.split('|').join(' | ')).join('\n')
  const fromText = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean)

  return (
    <div className="mt-6 space-y-3 border-t border-border pt-5" data-testid="shipping-zones">
      <div>
        <h3 className="text-base font-semibold text-foreground">Zonas de entrega y contra entrega</h3>
        <p className="text-sm text-muted-foreground">El agente de IA usa esto para saber si llega a la dirección del cliente y si puede ofrecer contra entrega.</p>
      </div>
      {rows.map((r) => (
        <div key={r.shippingMethodId} className="space-y-2 rounded-lg bg-muted p-4">
          <p className="font-medium text-foreground">{r.name}</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => patch(r.shippingMethodId, { coverage: m })}
                className={`rounded-full px-3 py-1 text-sm ${r.coverage === m ? 'bg-orange-600 text-white' : 'bg-card text-foreground ring-1 ring-border'}`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {r.coverage === 'list' ? (
            <textarea
              rows={3}
              defaultValue={toText(r.places)}
              onBlur={(e) => patch(r.shippingMethodId, { places: fromText(e.target.value) })}
              placeholder={PLACES_HINT}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
          ) : null}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={r.allowsCod} onChange={(e) => patch(r.shippingMethodId, { allowsCod: e.target.checked })} className="h-4 w-4" />
            Acepta contra entrega
          </label>
          {r.allowsCod ? (
            <div className="space-y-2 pl-6">
              <select
                value={r.codCoverage}
                onChange={(e) => patch(r.shippingMethodId, { codCoverage: e.target.value as Row['codCoverage'] })}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              >
                <option value="same">En todas las zonas de entrega</option>
                <option value="gam">Solo en GAM</option>
                <option value="list">Solo en estas zonas</option>
              </select>
              {r.codCoverage === 'list' ? (
                <textarea
                  rows={3}
                  defaultValue={toText(r.codPlaces)}
                  onBlur={(e) => patch(r.shippingMethodId, { codPlaces: fromText(e.target.value) })}
                  placeholder={PLACES_HINT}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                />
              ) : null}
            </div>
          ) : null}
          {canEdit ? (
          <button
            type="button"
            disabled={saving === r.shippingMethodId}
            onClick={() => void save(r)}
            className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving === r.shippingMethodId ? 'Guardando…' : 'Guardar zonas'}
          </button>
          ) : null}
        </div>
      ))}
      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
    </div>
  )
}
