'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pencil, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react'
import { auroraConfirm } from '@/components/aurora/ui/AuroraConfirmHost'

type Note = {
  id: string
  body: string
  clientId: string | null
  conversationId: string | null
  author: { id: string | null; name: string }
  pinned: boolean
  edited: boolean
  createdAt: string
  canEdit: boolean
  canDelete: boolean
}

const MAX = 4000

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-CR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Internal notes (never sent to the customer, never read by the AI): written in this chat and
 * shared with the linked client, so they follow the client to every chat. Author + date,
 * pinnable. `legacyNote` is the old free-text Client.notes, shown read-only.
 */
export function ChatNotesPanel({
  conversationId,
  hasClient,
  legacyNote,
}: {
  conversationId: string
  hasClient: boolean
  legacyNote?: string | null
}) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/notes`, { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; available?: boolean; notes?: Note[] } | null
      if (mine !== seq.current) return
      if (!res.ok || !json?.success) {
        setError('No se pudieron cargar las notas.')
        return
      }
      setError(null)
      setAvailable(json.available !== false)
      setNotes(json.notes ?? [])
    } catch {
      if (mine === seq.current) setError('Sin conexión.')
    }
  }, [conversationId])

  useEffect(() => {
    setNotes(null)
    setDraft('')
    setEditing(null)
    void load()
  }, [load])

  async function add() {
    const body = draft.trim()
    if (!body || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/notes`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; note?: Note; error?: string } | null
      if (!res.ok || !json?.success || !json.note) {
        setError(json?.error || 'No se pudo guardar la nota.')
        return
      }
      setDraft('')
      setNotes((prev) => [json.note!, ...(prev ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned)))
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  async function patch(id: string, payload: { body?: string; pinned?: boolean }) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/notes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setError(json?.error || 'No se pudo actualizar la nota.')
        return
      }
      setEditing(null)
      await load()
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(note: Note) {
    const ok = await auroraConfirm('¿Borrar esta nota?\nDeja de verse en este chat y en el cliente.', { confirmLabel: 'Borrar' })
    if (!ok) return
    setBusyId(note.id)
    try {
      const res = await fetch(`/api/crm/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE', credentials: 'same-origin' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setError(json?.error || 'No se pudo borrar la nota.')
        return
      }
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== note.id))
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  if (!available) return null

  return (
    <section className="space-y-2" data-testid="chat-notes-panel" aria-label="Notas internas">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <StickyNote className="h-3.5 w-3.5" aria-hidden /> Notas internas
        </p>
        <span className="text-[10.5px] text-slate-400">{hasClient ? 'Chat y cliente' : 'Este chat'}</span>
      </div>

      <div className="rounded-xl bg-white p-2 ring-1 ring-slate-100">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void add()
            }
          }}
          rows={2}
          placeholder="Escribí una nota para el equipo (el cliente no la ve)…"
          className="w-full resize-none rounded-lg bg-slate-50 px-2.5 py-2 text-[12.5px] text-slate-900 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-au-ink-5b6cff"
          aria-label="Nueva nota"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10.5px] text-slate-400">Ctrl + Enter para guardar</span>
          <button
            type="button"
            disabled={!draft.trim() || saving}
            onClick={() => void add()}
            className="inline-flex items-center gap-1 rounded-lg bg-au-ink-5b6cff px-2.5 py-1 text-[11.5px] font-semibold text-static-white disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            Guardar nota
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-700">
          {error}
        </p>
      ) : null}

      {notes === null ? (
        <div className="h-12 animate-pulse rounded-xl bg-slate-100" aria-busy="true" />
      ) : (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl px-2.5 py-2 text-[12.5px] ring-1 ${n.pinned ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-100'}`}
              data-testid="chat-note"
            >
              {editing?.id === n.id ? (
                <div>
                  <textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ id: n.id, body: e.target.value.slice(0, MAX) })}
                    rows={3}
                    className="w-full resize-none rounded-lg bg-white px-2 py-1.5 text-[12.5px] text-slate-900 ring-1 ring-slate-200"
                    aria-label="Editar nota"
                  />
                  <div className="mt-1 flex justify-end gap-1.5">
                    <button type="button" onClick={() => setEditing(null)} className="rounded-md px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100">
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!editing.body.trim() || busyId === n.id}
                      onClick={() => void patch(n.id, { body: editing.body })}
                      className="rounded-md bg-au-ink-5b6cff px-2 py-0.5 text-[11px] font-semibold text-static-white disabled:opacity-40"
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-slate-800">{n.body}</p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px] text-slate-400">
                    <span className="truncate">
                      {n.author.name} · {when(n.createdAt)}
                      {n.edited ? ' · editada' : ''}
                      {n.conversationId !== conversationId ? ' · otro chat' : ''}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={busyId === n.id}
                        onClick={() => void patch(n.id, { pinned: !n.pinned })}
                        className="rounded p-1 hover:bg-slate-100 hover:text-slate-700"
                        aria-label={n.pinned ? 'Desfijar nota' : 'Fijar nota'}
                        title={n.pinned ? 'Desfijar' : 'Fijar arriba'}
                      >
                        {n.pinned ? <PinOff className="h-3 w-3" aria-hidden /> : <Pin className="h-3 w-3" aria-hidden />}
                      </button>
                      {n.canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: n.id, body: n.body })}
                          className="rounded p-1 hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Editar nota"
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                        </button>
                      ) : null}
                      {n.canDelete ? (
                        <button
                          type="button"
                          disabled={busyId === n.id}
                          onClick={() => void remove(n)}
                          className="rounded p-1 hover:bg-red-50 hover:text-red-600"
                          aria-label="Borrar nota"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
          {legacyNote ? (
            <li className="rounded-xl bg-slate-50 px-2.5 py-2 text-[12.5px] ring-1 ring-slate-100" data-testid="chat-note-legacy">
              <p className="whitespace-pre-wrap break-words text-slate-700">{legacyNote}</p>
              <p className="mt-1 text-[10.5px] text-slate-400">Nota original del cliente</p>
            </li>
          ) : null}
          {notes.length === 0 && !legacyNote ? (
            <li className="px-1 py-2 text-[11.5px] text-slate-400">Todavía no hay notas.</li>
          ) : null}
        </ul>
      )}
    </section>
  )
}
