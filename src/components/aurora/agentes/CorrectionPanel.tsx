'use client'

/**
 * "Corregir" panel (Agentes IA 2.0 · E): the owner writes how the agent should have answered and saves it as an
 * example (recommended), a saved reply or a rule. Used in the test chat (AgentTestSandbox) and in real chats
 * (the inbox thread). The server checks everything (POST /api/chat/agents/[id]/tune) and its Spanish message is shown.
 */
import { useState } from 'react'
import {
  TUNE_CORRECTED_MAX,
  TUNE_NOTE_MAX,
  TUNE_TITLE_MAX,
  type TuneSaveAs,
} from '@/lib/soft-ai/agent-tuning-core'

const SAVE_AS: Array<{ value: TuneSaveAs; label: string; hint: string }> = [
  { value: 'example', label: 'Ejemplo (recomendado)', hint: 'Aprende a responder así esta pregunta y otras parecidas.' },
  { value: 'saved_reply', label: 'Respuesta guardada', hint: 'La agrega a tus respuestas guardadas para usarla cuando pregunten eso.' },
  { value: 'rule', label: 'Regla', hint: 'Guarda la nota como regla para todas las conversaciones ("siempre…" o "nunca…").' },
]

const FIELD =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 disabled:bg-slate-100 disabled:!text-slate-600'

export function CorrectionPanel({
  agentId,
  customerMessage,
  agentReply,
  onClose,
  onAskAgain,
}: {
  agentId: string
  customerMessage: string
  agentReply: string
  onClose: () => void
  /** Test chat: re-send the same customer message to see the new answer. */
  onAskAgain?: () => void
}) {
  const [corrected, setCorrected] = useState(agentReply.slice(0, TUNE_CORRECTED_MAX))
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('')
  const [saveAs, setSaveAs] = useState<TuneSaveAs>('example')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerMessage: customerMessage.slice(0, 500),
          agentReply: agentReply.slice(0, 1500),
          correctedReply: corrected.trim(),
          note: note.trim() || undefined,
          saveAs,
          title: saveAs === 'saved_reply' && title.trim() ? title.trim() : undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : res.status === 403
              ? 'No tenés permiso para corregir este agente.'
              : 'No se pudo guardar la corrección.',
        )
        return
      }
      setSaved(true)
    } catch {
      setError('No se pudo guardar la corrección. Revisá tu conexión.')
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    return (
      <div className="mt-2 rounded-lg bg-emerald-50 p-3 text-[12px] text-emerald-900 ring-1 ring-emerald-100" data-testid="correction-saved">
        <p className="font-medium">Guardado. La próxima vez responde así.</p>
        <div className="mt-2 flex gap-2">
          {onAskAgain ? (
            <button
              type="button"
              onClick={() => {
                onAskAgain()
                onClose()
              }}
              className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[12px] font-medium text-white"
            >
              Volver a preguntar
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200">
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  const needsText = saveAs !== 'rule' && !corrected.trim()
  const needsNote = saveAs === 'rule' && !note.trim()
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-white p-3 text-left text-[12px] !text-slate-900 ring-1 ring-slate-200" data-testid="correction-panel">
      <div className="space-y-1">
        <p className="text-[11px] text-slate-600">
          <span className="font-medium">El cliente escribió:</span> {customerMessage || '—'}
        </p>
        <p className="text-[11px] text-slate-600">
          <span className="font-medium">El agente respondió:</span> {agentReply || '—'}
        </p>
      </div>
      <label className="block">
        <span className="font-medium">Cómo debería responder</span>
        <textarea
          className={`${FIELD} mt-1`}
          rows={4}
          maxLength={TUNE_CORRECTED_MAX}
          value={corrected}
          disabled={busy}
          onChange={(e) => setCorrected(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="font-medium">Nota (opcional)</span>
        <input
          className={`${FIELD} mt-1`}
          maxLength={TUNE_NOTE_MAX}
          value={note}
          disabled={busy}
          placeholder='Ej.: "nunca prometas bajar de peso"'
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <fieldset>
        <legend className="font-medium">Guardar como</legend>
        <div className="mt-1 space-y-1">
          {SAVE_AS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2">
              <input
                type="radio"
                name={`save-as-${agentId}`}
                className="mt-0.5"
                checked={saveAs === opt.value}
                disabled={busy}
                onChange={() => setSaveAs(opt.value)}
              />
              <span>
                <span className="font-medium">{opt.label}</span>
                <span className="block text-[11px] text-slate-600">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {saveAs === 'saved_reply' ? (
        <label className="block">
          <span className="font-medium">Título (opcional)</span>
          <input
            className={`${FIELD} mt-1`}
            maxLength={TUNE_TITLE_MAX}
            value={title}
            disabled={busy}
            placeholder="Si lo dejás vacío, usa la pregunta del cliente"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      ) : null}
      {needsNote ? <p className="text-[11px] text-slate-600">Para guardar una regla, escribila en Nota.</p> : null}
      {error ? (
        <p role="alert" className="text-[12px] text-red-800">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || needsText || needsNote}
          onClick={() => void save()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white disabled:bg-indigo-400"
        >
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200">
          Cancelar
        </button>
      </div>
    </div>
  )
}
