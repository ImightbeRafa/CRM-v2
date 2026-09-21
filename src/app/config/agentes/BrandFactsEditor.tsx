'use client'

import React, { useCallback, useEffect, useState } from 'react'

const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 placeholder:!text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100'
const HINT = 'text-[11px] text-slate-600'

type FactsForm = {
  storeName: string
  website: string
  hoursText: string
  address: string
  pickupInstructions: string
  eaEnabled: boolean
  gamCost: string
  outsideGamCost: string
  raEnabled: boolean
  raText: string
  sharePayments: boolean
  methods: string[]
  sinpeNumber: string
  sinpeHolder: string
  bank: string
  iban: string
  instructionsText: string
  maxLines: string
}

const EMPTY: FactsForm = {
  storeName: '',
  website: '',
  hoursText: '',
  address: '',
  pickupInstructions: '',
  eaEnabled: false,
  gamCost: '',
  outsideGamCost: '',
  raEnabled: false,
  raText: '',
  sharePayments: false,
  methods: [],
  sinpeNumber: '',
  sinpeHolder: '',
  bank: '',
  iban: '',
  instructionsText: '',
  maxLines: '4',
}

const METHOD_OPTIONS = [
  ['sinpe', 'SINPE'],
  ['transferencia', 'Transferencia'],
  ['tarjeta', 'Tarjeta'],
  ['efectivo', 'Efectivo'],
  ['contra_entrega', 'Contra entrega'],
] as const

function numOrUndef(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

export function BrandFactsEditor({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [form, setForm] = useState<FactsForm>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/chat/agents/${agentId}`)
    const data = await res.json()
    const facts = data.agent?.brandFacts || {}
    const style = data.agent?.replyStyle || {}
    const payment = facts.payment || {}
    const shipping = facts.shipping || {}
    setForm({
      storeName: facts.storeName || '',
      website: facts.website || '',
      hoursText: facts.hoursText || '',
      address: facts.location?.address || '',
      pickupInstructions: facts.location?.pickupInstructions || '',
      eaEnabled: Boolean(shipping.ea?.enabled),
      gamCost: shipping.ea?.gamCost != null ? String(shipping.ea.gamCost) : '',
      outsideGamCost: shipping.ea?.outsideGamCost != null ? String(shipping.ea.outsideGamCost) : '',
      raEnabled: Boolean(shipping.ra?.enabled),
      raText: shipping.ra?.text || '',
      sharePayments: Boolean(payment.shareWithCustomers),
      methods: Array.isArray(payment.methods) ? payment.methods : [],
      sinpeNumber: payment.sinpe?.number || '',
      sinpeHolder: payment.sinpe?.holderName || '',
      bank: payment.transfer?.bank || '',
      iban: payment.transfer?.iban || '',
      instructionsText: payment.instructionsText || '',
      maxLines: style.maxLines != null ? String(style.maxLines) : '4',
    })
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  function toggleMethod(method: string) {
    setForm((prev) => ({
      ...prev,
      methods: prev.methods.includes(method)
        ? prev.methods.filter((item) => item !== method)
        : [...prev.methods, method],
    }))
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const brandFacts = {
      schemaVersion: 1,
      storeName: form.storeName,
      website: form.website,
      hoursText: form.hoursText,
      location: {
        address: form.address,
        pickupInstructions: form.pickupInstructions,
      },
      shipping: {
        ea: {
          enabled: form.eaEnabled,
          gamCost: numOrUndef(form.gamCost),
          outsideGamCost: numOrUndef(form.outsideGamCost),
        },
        ra: { enabled: form.raEnabled, text: form.raText },
      },
      payment: {
        shareWithCustomers: form.sharePayments,
        methods: form.methods,
        sinpe: { number: form.sinpeNumber, holderName: form.sinpeHolder },
        transfer: { bank: form.bank, iban: form.iban },
        instructionsText: form.instructionsText,
      },
    }
    const replyStyle = {
      schemaVersion: 1,
      maxLines: Number(form.maxLines) || 4,
      askOneQuestion: true,
      emojiLevel: 'light',
      purchaseInfoMustBeComplete: true,
    }
    try {
      const res = await fetch(`/api/chat/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandFacts, replyStyle }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se guardó')
      setSaved(true)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Datos de la marca</h2>
      <p className={`mt-0.5 ${HINT}`}>
        Sitio, pagos, envío a domicilio (EA), retiro (RA) y horario. Nada de esto va fijo en el código.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-700">
          Nombre de tienda
          <input className={FIELD} value={form.storeName} disabled={!canEdit} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Sitio web
          <input className={FIELD} value={form.website} disabled={!canEdit} placeholder="URL del catálogo" onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-700 sm:col-span-2">
          Horario
          <input className={FIELD} value={form.hoursText} disabled={!canEdit} onChange={(e) => setForm({ ...form, hoursText: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Dirección de retiro
          <input className={FIELD} value={form.address} disabled={!canEdit} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-slate-700">
          Indicaciones de retiro
          <input className={FIELD} value={form.pickupInstructions} disabled={!canEdit} onChange={(e) => setForm({ ...form, pickupInstructions: e.target.value })} />
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-900">
            <input type="checkbox" checked={form.eaEnabled} disabled={!canEdit} onChange={(e) => setForm({ ...form, eaEnabled: e.target.checked })} />
            Envío a domicilio (EA)
          </label>
          <label className="mt-2 block text-xs text-slate-700">
            Costo GAM
            <input className={FIELD} value={form.gamCost} disabled={!canEdit} inputMode="numeric" onChange={(e) => setForm({ ...form, gamCost: e.target.value })} />
          </label>
          <label className="mt-2 block text-xs text-slate-700">
            Fuera del GAM
            <input className={FIELD} value={form.outsideGamCost} disabled={!canEdit} inputMode="numeric" onChange={(e) => setForm({ ...form, outsideGamCost: e.target.value })} />
          </label>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-900">
            <input type="checkbox" checked={form.raEnabled} disabled={!canEdit} onChange={(e) => setForm({ ...form, raEnabled: e.target.checked })} />
            Retiro (RA)
          </label>
          <label className="mt-2 block text-xs text-slate-700">
            Texto de retiro
            <input className={FIELD} value={form.raText} disabled={!canEdit} onChange={(e) => setForm({ ...form, raText: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-900">
          <input type="checkbox" checked={form.sharePayments} disabled={!canEdit} onChange={(e) => setForm({ ...form, sharePayments: e.target.checked })} />
          Compartir formas de pago con clientes
        </label>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-800">
          {METHOD_OPTIONS.map(([value, label]) => (
            <label key={value} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={form.methods.includes(value)} disabled={!canEdit} onChange={() => toggleMethod(value)} />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-700">
            Número SINPE
            <input className={FIELD} value={form.sinpeNumber} disabled={!canEdit} onChange={(e) => setForm({ ...form, sinpeNumber: e.target.value })} />
          </label>
          <label className="text-xs text-slate-700">
            Titular SINPE
            <input className={FIELD} value={form.sinpeHolder} disabled={!canEdit} onChange={(e) => setForm({ ...form, sinpeHolder: e.target.value })} />
          </label>
          <label className="text-xs text-slate-700">
            Banco
            <input className={FIELD} value={form.bank} disabled={!canEdit} onChange={(e) => setForm({ ...form, bank: e.target.value })} />
          </label>
          <label className="text-xs text-slate-700">
            IBAN
            <input className={FIELD} value={form.iban} disabled={!canEdit} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
          </label>
        </div>
        <label className="mt-2 block text-xs text-slate-700">
          Instrucciones de pago
          <input className={FIELD} value={form.instructionsText} disabled={!canEdit} onChange={(e) => setForm({ ...form, instructionsText: e.target.value })} />
        </label>
      </div>
      <label className="mt-3 block text-xs font-medium text-slate-700">
        Máximo de líneas por respuesta
        <input className={`${FIELD} max-w-[8rem]`} value={form.maxLines} disabled={!canEdit} onChange={(e) => setForm({ ...form, maxLines: e.target.value })} />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {saved ? <p className="mt-2 text-xs text-emerald-800">Datos guardados.</p> : null}
      <button
        type="button"
        disabled={!canEdit || saving}
        onClick={() => void save()}
        className="mt-3 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-indigo-400"
      >
        {saving ? 'Guardando…' : 'Guardar datos de la marca'}
      </button>
    </div>
  )
}
