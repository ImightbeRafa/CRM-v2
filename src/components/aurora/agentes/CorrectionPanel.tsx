'use client'

/**
 * "Corregir" panel (Agentes IA 2.0 · E): the owner writes how the agent should have answered and saves it as an
 * example (recommended), a saved reply or a rule. Used in the test chat (AgentTestSandbox) and in real chats
 * (the inbox thread). The server checks everything (POST /api/chat/agents/[id]/tune) and its Spanish message is shown.
 *
 * Review fixes 2026-10-15: the customer's question is an editable field prefilled with the cleaned text ("Así lo va a
 * ver el agente") and what the owner confirms is sent (INT-103); real chats send only the message id and the server
 * loads both texts (INT-107); the panel says which agent it saves to (INT-108) and shows the exact rule line (INT-106);
 * a reply sent by code points to Respuestas guardadas (V11).
 */
import { useEffect, useState } from 'react'
import {
  ruleLine,
  sanitizeTuneQuestion,
  TUNE_CODE_REPLY_NOTE,
  TUNE_CORRECTED_MAX,
  TUNE_DEFAULT_TITLE,
  TUNE_NOTE_MAX,
  TUNE_QUESTION_MAX,
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

type Loaded = { customerMessage: string; agentReply: string; agentName: string | null; decidedByCode: boolean }

export function CorrectionPanel({
  agentId,
  agentName,
  messageId,
  customerMessage,
  agentReply,
  decidedByCode,
  onClose,
  onAskAgain,
}: {
  agentId: string
  /** Shown as "Se guarda en: …" (real chats: from the server). */
  agentName?: string | null
  /** Real chats: the AI message id; the server loads the customer message and the reply itself. */
  messageId?: string
  /** Test chat: the customer message this reply answered. */
  customerMessage?: string
  agentReply?: string
  /** Test chat: code answered (a keyword saved reply / system message), not the agent. */
  decidedByCode?: boolean
  onClose: () => void
  /** Test chat: re-send the same customer message to see the new answer. */
  onAskAgain?: () => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(
    messageId
      ? null
      : {
          customerMessage: sanitizeTuneQuestion(customerMessage || ''),
          agentReply: agentReply || '',
          agentName: agentName ?? null,
          decidedByCode: decidedByCode === true,
        },
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [question, setQuestion] = useState(loaded?.customerMessage ?? '')
  const [corrected, setCorrected] = useState((loaded?.agentReply ?? '').slice(0, TUNE_CORRECTED_MAX))
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('')
  const [saveAs, setSaveAs] = useState<TuneSaveAs>('example')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!messageId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/tune?messageId=${encodeURIComponent(messageId)}`)
        const data = (await res.json().catch(() => null)) as
          | { error?: unknown; customerMessage?: unknown; agentReply?: unknown; agentName?: unknown; decidedByCode?: unknown }
          | null
        if (cancelled) return
        if (!res.ok || !data) {
          setLoadError(typeof data?.error === 'string' ? data.error : 'No se pudo cargar el mensaje.')
          return
        }
        const next: Loaded = {
          customerMessage: typeof data.customerMessage === 'string' ? data.customerMessage : '',
          agentReply: typeof data.agentReply === 'string' ? data.agentReply : '',
          agentName: typeof data.agentName === 'string' ? data.agentName : agentName ?? null,
          decidedByCode: data.decidedByCode === true,
        }
        setLoaded(next)
        setQuestion(next.customerMessage)
        setCorrected(next.agentReply.slice(0, TUNE_CORRECTED_MAX))
      } catch {
        if (!cancelled) setLoadError('No se pudo cargar el mensaje. Revisá tu conexión.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentId, messageId, agentName])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/tune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(messageId ? { messageId } : { agentReply: (loaded?.agentReply ?? '').slice(0, 1500) }),
          // What the owner confirmed in "Así lo va a ver el agente" (the server cleans it again).
          customerMessage: question.trim().slice(0, TUNE_QUESTION_MAX),
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

  const closeButton = (
    <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200">
      Cerrar
    </button>
  )

  if (loadError) {
    return (
      <div className="mt-2 space-y-2 rounded-lg bg-white p-3 text-[12px] !text-slate-900 ring-1 ring-slate-200" data-testid="correction-panel">
        <p role="alert" className="text-red-800">
          {loadError}
        </p>
        {closeButton}
      </div>
    )
  }
  if (!loaded) {
    return (
      <div className="mt-2 rounded-lg bg-white p-3 text-[12px] text-slate-600 ring-1 ring-slate-200" data-testid="correction-panel">
        Cargando…
      </div>
    )
  }
  if (loaded.decidedByCode) {
    return (
      <div className="mt-2 space-y-2 rounded-lg bg-white p-3 text-[12px] !text-slate-900 ring-1 ring-slate-200" data-testid="correction-code-reply">
        <p>{TUNE_CODE_REPLY_NOTE}</p>
        {closeButton}
      </div>
    )
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
          {closeButton}
        </div>
      </div>
    )
  }

  const needsText = saveAs !== 'rule' && !corrected.trim()
  const needsNote = saveAs === 'rule' && !note.trim()
  const needsQuestion = !question.trim()
  const rulePreview = saveAs === 'rule' ? ruleLine(note) : ''
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-white p-3 text-left text-[12px] !text-slate-900 ring-1 ring-slate-200" data-testid="correction-panel">
      {loaded.agentName ? (
        <p className="text-[11px] text-slate-600" data-testid="correction-target">
          <span className="font-medium">Se guarda en:</span> {loaded.agentName}
        </p>
      ) : null}
      <label className="block">
        <span className="font-medium">Así lo va a ver el agente</span>
        <span className="block text-[11px] text-slate-600">La pregunta del cliente, sin datos personales ni enlaces. Podés acortarla.</span>
        <input
          className={`${FIELD} mt-1`}
          maxLength={TUNE_QUESTION_MAX}
          value={question}
          disabled={busy}
          onChange={(e) => setQuestion(e.target.value)}
          data-testid="correction-question"
        />
      </label>
      <p className="text-[11px] text-slate-600">
        <span className="font-medium">El agente respondió:</span> {loaded.agentReply || '—'}
      </p>
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
            placeholder={`Si lo dejás vacío: «${TUNE_DEFAULT_TITLE}»`}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      ) : null}
      {needsNote ? <p className="text-[11px] text-slate-600">Para guardar una regla, escribila en Nota.</p> : null}
      {rulePreview ? (
        <p className="text-[11px] text-slate-700" data-testid="correction-rule-preview">
          <span className="font-medium">Se va a guardar como:</span> {rulePreview}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-red-800">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || needsText || needsNote || needsQuestion}
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
