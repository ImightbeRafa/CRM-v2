'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Lock, Pencil, Pin, PinOff, StickyNote, Trash2, Users } from 'lucide-react'
import { auroraConfirm } from '@/components/aurora/ui/AuroraConfirmHost'
import { activeMentionQuery, insertMention, matchTeammates, mentionIdsFromText, type Teammate } from '@/lib/note-mentions'

type NoteScope = 'client' | 'chat'

type Note = {
  id: string
  body: string
  scope?: NoteScope
  canChangeScope?: boolean
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
  // Unknown until the first answer: nothing renders before we know notes exist (035 applied).
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // "Todo el cliente" by default when the chat has a client; otherwise a note is chat-only anyway.
  const [scope, setScope] = useState<NoteScope>('client')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const seq = useRef(0)
  // @mentions: teammates who can work chats (loaded on the first "@"), and the picker state.
  const [team, setTeam] = useState<{ viewerId: string | null; list: Teammate[] } | null>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const teamLoading = useRef(false)

  const ensureTeam = useCallback(async () => {
    if (team || teamLoading.current) return team
    teamLoading.current = true
    try {
      const res = await fetch('/api/chat/assignees', { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; viewerUserId?: string; assignees?: Teammate[] } | null
      const next = { viewerId: json?.viewerUserId ?? null, list: res.ok && Array.isArray(json?.assignees) ? json!.assignees : [] }
      setTeam(next)
      return next
    } catch {
      return null
    } finally {
      teamLoading.current = false
    }
  }, [team])

  const mentionMatches = mention && team ? matchTeammates(team.list, mention.query, team.viewerId) : []

  function onDraftChange(value: string, caret: number) {
    setDraft(value.slice(0, MAX))
    const q = activeMentionQuery(value, caret)
    setMention(q)
    setMentionIndex(0)
    if (q) void ensureTeam()
  }

  function pickMention(t: Teammate) {
    if (!mention) return
    const el = draftRef.current
    const caret = el ? el.selectionStart : draft.length
    const next = insertMention(draft, mention.start, caret, t)
    setDraft(next.text.slice(0, MAX))
    setMention(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }

  /** Ids for the "@Name"s still present in the text (loads the team list if needed). */
  async function mentionIdsFor(text: string): Promise<string[] | undefined> {
    if (!text.includes('@')) return []
    const t = team ?? (await ensureTeam())
    return t ? mentionIdsFromText(text, t.list, t.viewerId) : undefined
  }

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
      const mentionUserIds = await mentionIdsFor(body)
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/notes`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, scope: hasClient ? scope : 'chat', ...(mentionUserIds ? { mentionUserIds } : {}) }),
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

  async function patch(id: string, payload: { body?: string; pinned?: boolean; scope?: NoteScope }) {
    setBusyId(id)
    setError(null)
    try {
      // An edit re-reads the "@Name"s in the new text (only newly added people are notified).
      const mentionUserIds = payload.body !== undefined ? await mentionIdsFor(payload.body) : undefined
      const res = await fetch(`/api/crm/notes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...(mentionUserIds ? { mentionUserIds } : {}) }),
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

  // Before migration 035: no notes yet, but the client's original note still shows (read-only).
  if (available === false && legacyNote) {
    return (
      <section className="space-y-2" data-testid="chat-notes-panel" aria-label="Notas internas">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notas</h3>
        <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-2.5 py-2 text-[12.5px] text-slate-700 ring-1 ring-slate-100" data-testid="chat-note-legacy">
          {legacyNote}
        </p>
        <p className="text-[10.5px] text-slate-400">Nota original del cliente</p>
      </section>
    )
  }
  if (available !== true) return null

  return (
    <section className="space-y-2" data-testid="chat-notes-panel" aria-label="Notas internas">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <StickyNote className="h-3.5 w-3.5" aria-hidden /> Notas internas
        </p>
        <span className="text-[10.5px] text-slate-400">{hasClient ? 'Chat y cliente' : 'Este chat'}</span>
      </div>

      <div className="relative rounded-xl bg-white p-2 ring-1 ring-slate-100">
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (mentionMatches.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                setMentionIndex((i) => (i + step + mentionMatches.length) % mentionMatches.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pickMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMention(null)
                return
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void add()
            }
          }}
          rows={2}
          placeholder="Escribí una nota para el equipo (el cliente no la ve)… Usá @ para avisarle a alguien."
          className="w-full resize-none rounded-lg bg-slate-50 px-2.5 py-2 text-[12.5px] text-slate-900 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-au-ink-5b6cff"
          aria-label="Nueva nota"
        />
        {mention && mentionMatches.length ? (
          <ul
            role="listbox"
            aria-label="Mencionar a alguien del equipo"
            className="absolute left-2 right-2 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg bg-white p-1 shadow-lg ring-1 ring-slate-200"
            data-testid="note-mention-picker"
          >
            {mentionMatches.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickMention(t)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${i === mentionIndex ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-au-tint-eef0ff text-[10px] font-semibold text-au-ink-4a46e5" aria-hidden>
                    {t.name.charAt(0).toUpperCase()}
                  </span>
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {hasClient ? (
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[10.5px] font-medium" role="radiogroup" aria-label="Quién ve la nota" data-testid="note-scope-toggle">
              {(
                [
                  ['client', 'Todo el cliente', Users],
                  ['chat', 'Solo este chat', Lock],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={scope === key}
                  onClick={() => setScope(key)}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ${scope === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[10.5px] text-slate-400">Ctrl + Enter para guardar</span>
          )}
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
                      {n.scope === 'chat' ? (
                        <span className="mr-0.5 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 py-px text-[10px] text-slate-500" data-testid="note-scope-chat">
                          <Lock className="h-2.5 w-2.5" aria-hidden /> Solo este chat
                        </span>
                      ) : null}
                      {n.canChangeScope && n.conversationId === conversationId && (n.scope === 'client' || hasClient) ? (
                        <button
                          type="button"
                          disabled={busyId === n.id}
                          onClick={() => void patch(n.id, { scope: n.scope === 'chat' ? 'client' : 'chat' })}
                          className="rounded p-1 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={n.scope === 'chat' ? 'Compartir con todo el cliente' : 'Dejar solo en este chat'}
                          title={n.scope === 'chat' ? 'Compartir con todo el cliente' : 'Dejar solo en este chat'}
                        >
                          {n.scope === 'chat' ? <Users className="h-3 w-3" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}
                        </button>
                      ) : null}
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
