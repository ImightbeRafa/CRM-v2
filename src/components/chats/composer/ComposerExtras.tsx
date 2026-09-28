'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { FileText, Image as ImageIcon, Loader2, Paperclip, Pencil, Plus, Search, Trash2, X, Zap } from 'lucide-react'
import { EMOJI_CATEGORIES, EMOJI_RECENT_KEY, pushRecentEmoji, searchEmojis } from './emoji-data'
import {
  QUICK_REPLY_MAX_TEXT,
  normalizeShortcut,
  QUICK_REPLY_MAX_MEDIA,
  type ChatQuickReply,
  type QuickReplyMedia,
} from '@/lib/chat-quick-replies'

export function quickReplyMediaUrl(path: string): string {
  return `/api/chat/quick-replies/media?path=${encodeURIComponent(path)}`
}

/** Small square preview of a quick-reply file (photo thumbnail or document icon). */
export function QuickReplyMediaThumb({ media, className = 'h-9 w-9' }: { media: QuickReplyMedia; className?: string }) {
  if (media.mime.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={quickReplyMediaUrl(media.path)}
        alt={media.filename}
        loading="lazy"
        className={`${className} shrink-0 rounded-md object-cover ring-1 ring-slate-200`}
      />
    )
  }
  return (
    <span className={`${className} flex shrink-0 items-center justify-center rounded-md bg-au-tint-eef0ff text-au-ink-5b6cff ring-1 ring-slate-200`}>
      <FileText className="h-4 w-4" aria-hidden />
    </span>
  )
}

/** Grows the textarea with its content up to `maxPx`, then scrolls inside. */
export function useAutoGrowTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx: number) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, maxPx)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [ref, value, maxPx])
}

/** Closes a popover on outside pointer down or Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (ref.current && target && !ref.current.contains(target)) {
        // Toggle buttons mark themselves so a click on them does not close-then-reopen.
        if ((target as HTMLElement).closest?.('[data-popover-toggle]')) return
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, ref, onClose])
}

function readRecentEmojis(): string[] {
  try {
    const raw = window.localStorage.getItem(EMOJI_RECENT_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : []
  } catch {
    return []
  }
}

export function EmojiPickerPopover({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [category, setCategory] = useState<string>(EMOJI_CATEGORIES[0].id)
  useDismiss(true, ref, onClose)
  useEffect(() => setRecent(readRecentEmojis()), [])

  const results = useMemo(() => searchEmojis(query), [query])
  const pick = (emoji: string) => {
    const next = pushRecentEmoji(recent, emoji)
    setRecent(next)
    try {
      window.localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(next))
    } catch {
      // ignore (private mode)
    }
    onPick(emoji)
  }
  const active = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0]

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emojis"
      className="aurora-light text-slate-900 absolute bottom-full left-0 z-40 mb-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
      data-testid="composer-emoji-picker"
    >
      <div className="border-b border-slate-100 p-2">
        <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-100">
          <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar emoji (ej. envío, gracias)"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-800 outline-none placeholder:text-slate-400"
            aria-label="Buscar emoji"
          />
        </label>
      </div>
      <div className="h-[220px] overflow-y-auto px-2 py-1.5">
        {query.trim() ? (
          results.length ? (
            <EmojiGrid emojis={results.map((e) => e[0])} onPick={pick} />
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-slate-400">Sin resultados</p>
          )
        ) : (
          <>
            {recent.length && category === EMOJI_CATEGORIES[0].id ? (
              <>
                <p className="px-1 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Recientes</p>
                <EmojiGrid emojis={recent} onPick={pick} />
              </>
            ) : null}
            <p className="px-1 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{active.label}</p>
            <EmojiGrid emojis={active.emojis.map((e) => e[0])} onPick={pick} />
          </>
        )}
      </div>
      <div className="flex border-t border-slate-100 px-1 py-1">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setQuery('')
              setCategory(c.id)
            }}
            aria-label={c.label}
            title={c.label}
            className={`flex h-8 flex-1 items-center justify-center rounded-lg text-[17px] transition ${
              c.id === category && !query ? 'bg-au-tint-eef0ff' : 'opacity-70 hover:bg-slate-50 hover:opacity-100'
            }`}
          >
            {c.icon}
          </button>
        ))}
      </div>
    </div>
  )
}

function EmojiGrid({ emojis, onPick }: { emojis: readonly string[]; onPick: (e: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          className="flex h-9 items-center justify-center rounded-lg text-[21px] leading-none transition hover:scale-110 hover:bg-slate-100"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

/** Inline "/" suggestions above the composer (keyboard handled by the textarea). */
export function QuickReplySuggestions({
  items,
  activeIndex,
  query,
  onPick,
  onHover,
  onManage,
}: {
  items: ChatQuickReply[]
  activeIndex: number
  query: string
  onPick: (item: ChatQuickReply) => void
  onHover: (index: number) => void
  onManage: () => void
}) {
  const listRef = useRef<HTMLUListElement | null>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])
  return (
    <div
      className="aurora-light text-slate-900 absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
      data-testid="composer-quick-replies"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <Zap className="h-3 w-3" aria-hidden /> Respuestas rápidas
        </p>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onManage} className="text-[11px] font-semibold text-au-ink-5b6cff hover:underline">
          Administrar
        </button>
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-slate-500">
          {query ? `No hay un atajo /${query}.` : 'Todavía no hay respuestas rápidas.'}{' '}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onManage} className="font-semibold text-au-ink-5b6cff hover:underline">
            Crear una
          </button>
        </div>
      ) : (
        <ul ref={listRef} role="listbox" aria-label="Respuestas rápidas" className="max-h-64 overflow-y-auto py-1">
          {items.map((item, i) => (
            <li key={item.id} data-index={i} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(item)}
                className={`flex w-full items-start gap-3 px-3 py-2 text-left ${i === activeIndex ? 'bg-au-tint-eef0ff' : 'hover:bg-slate-50'}`}
              >
                <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-slate-700">
                  /{item.shortcut}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line text-[12.5px] leading-snug text-slate-600">
                  {item.text || (item.media?.length ? 'Solo archivos' : '')}
                </span>
                {item.media?.length ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <QuickReplyMediaThumb media={item.media[0]} className="h-8 w-8" />
                    {item.media.length > 1 ? <span className="text-[10.5px] font-semibold text-slate-500">+{item.media.length - 1}</span> : null}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-slate-100 px-3 py-1.5 text-[10.5px] text-slate-400">
        ↑↓ elegir · Enter o Tab insertar · Esc cerrar · {'{nombre}'} = nombre del cliente
      </p>
    </div>
  )
}

/** Create / edit / delete the team's quick replies (saved for everyone in the business). */
export function QuickRepliesManager({
  items,
  onSave,
  onClose,
  initialShortcut,
  canManage = true,
}: {
  items: ChatQuickReply[]
  onSave: (items: ChatQuickReply[]) => Promise<string | null>
  onClose: () => void
  initialShortcut?: string
  canManage?: boolean
}) {
  const [draft, setDraft] = useState<ChatQuickReply[]>(items)
  // A save conflict reloads the list from the server: show it.
  useEffect(() => setDraft(items), [items])
  const [editing, setEditing] = useState<{ id: string | null; shortcut: string; text: string; media: QuickReplyMedia[] } | null>(
    initialShortcut !== undefined ? { id: null, shortcut: initialShortcut, text: '', media: [] } : null,
  )
  const [uploading, setUploading] = useState(false)
  const mediaInputRef = useRef<HTMLInputElement | null>(null)

  const uploadMedia = async (file: File) => {
    if (!editing) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/chat/quick-replies/media', { method: 'POST', credentials: 'same-origin', body: form })
      const json = (await res.json().catch(() => null)) as { success?: boolean; media?: QuickReplyMedia; error?: string } | null
      if (!res.ok || !json?.success || !json.media) {
        setError(res.status === 403 ? 'Solo administradores pueden adjuntar archivos.' : json?.error || 'No se pudo subir el archivo.')
        return
      }
      const media = json.media
      setEditing((prev) => (prev ? { ...prev, media: [...prev.media, media].slice(0, QUICK_REPLY_MAX_MEDIA) } : prev))
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setUploading(false)
    }
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const persist = async (next: ChatQuickReply[]) => {
    setSaving(true)
    setError(null)
    const err = await onSave(next)
    setSaving(false)
    if (err) {
      setError(err)
      return false
    }
    setDraft(next)
    return true
  }

  const submitEdit = async () => {
    if (!editing) return
    const shortcut = normalizeShortcut(editing.shortcut)
    const text = editing.text.trim()
    const media = editing.media
    if (!shortcut || (!text && media.length === 0)) {
      setError('Completá el atajo y el texto (o adjuntá un archivo).')
      return
    }
    if (draft.some((r) => r.shortcut === shortcut && r.id !== editing.id)) {
      setError(`Ya existe /${shortcut}.`)
      return
    }
    const next = editing.id
      ? draft.map((r) => (r.id === editing.id ? { ...r, shortcut, text, media } : r))
      : [...draft, { id: `qr_${Date.now().toString(36)}`, shortcut, text, media }]
    if (await persist(next)) setEditing(null)
  }

  const visible = filter.trim()
    ? draft.filter((r) => r.shortcut.includes(normalizeShortcut(filter)) || r.text.toLowerCase().includes(filter.toLowerCase()))
    : draft

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Respuestas rápidas"
        className="aurora-light text-slate-900 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="quick-replies-manager"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <Zap className="h-4 w-4 text-au-ink-5b6cff" aria-hidden /> Respuestas rápidas
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Escribí <span className="font-mono font-semibold">/atajo</span> en el chat para usarlas. Compartidas con todo el equipo.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {editing ? (
            <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
              <label className="block">
                <span className="text-[11.5px] font-medium text-slate-600">Atajo</span>
                <span className="mt-1 flex items-center rounded-xl bg-white px-3 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-[#5B6CFF]/40">
                  <span className="font-mono text-[13px] text-slate-400">/</span>
                  <input
                    autoFocus
                    value={editing.shortcut}
                    onChange={(e) =>
                      // Lenient while typing (a trailing "-" is fine); normalized on save.
                      setEditing({
                        ...editing,
                        shortcut: e.target.value.toLowerCase().replace(/^\/+/, '').replace(/\s+/g, '-').slice(0, 32),
                      })
                    }
                    placeholder="precio"
                    className="min-w-0 flex-1 bg-transparent px-1 py-2 font-mono text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </span>
              </label>
              <label className="block">
                <span className="text-[11.5px] font-medium text-slate-600">Mensaje</span>
                <textarea
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value.slice(0, QUICK_REPLY_MAX_TEXT) })}
                  rows={5}
                  placeholder={'Hola {nombre} 👋 el precio es ₡…'}
                  className="mt-1 w-full resize-y rounded-xl bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 ring-1 ring-slate-200 focus:ring-2 focus:ring-[#5B6CFF]/40"
                />
                <span className="mt-1 flex justify-between text-[11px] text-slate-400">
                  <span>{'{nombre}'} se reemplaza con el nombre del cliente.</span>
                  <span>
                    {editing.text.length}/{QUICK_REPLY_MAX_TEXT}
                  </span>
                </span>
              </label>
              <div>
                <span className="text-[11.5px] font-medium text-slate-600">Archivos (opcional)</span>
                <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="quick-reply-media">
                  {editing.media.map((m) => (
                    <span key={m.path} className="group relative">
                      <QuickReplyMediaThumb media={m} className="h-14 w-14" />
                      <button
                        type="button"
                        onClick={() => setEditing({ ...editing, media: editing.media.filter((x) => x.path !== m.path) })}
                        aria-label={`Quitar ${m.filename}`}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow ring-2 ring-white"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                  {editing.media.length < QUICK_REPLY_MAX_MEDIA ? (
                    <>
                      <input
                        ref={mediaInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,.mp4"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) void uploadMedia(file)
                        }}
                      />
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => mediaInputRef.current?.click()}
                        className="flex h-14 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 text-[12px] font-medium text-slate-600 hover:border-slate-400 hover:bg-white disabled:opacity-50"
                      >
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Paperclip className="h-4 w-4" aria-hidden />}
                        Adjuntar foto o PDF
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Hasta {QUICK_REPLY_MAX_MEDIA}. Se envían primero; el texto va como descripción de la primera foto.</p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="rounded-xl px-3.5 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-200/60">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitEdit()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#5B6CFF] px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  Guardar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                  <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Buscar"
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </label>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => setEditing({ id: null, shortcut: '', text: '', media: [] })}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#5B6CFF] px-3 py-2 text-[12.5px] font-semibold text-white"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Nueva
                  </button>
                ) : null}
              </div>
              {!canManage ? (
                <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
                  Solo administradores pueden crear o editar respuestas rápidas.
                </p>
              ) : null}
              {visible.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-[12.5px] text-slate-500">
                  {draft.length ? 'Sin coincidencias.' : 'Creá respuestas para precios, métodos de pago, envíos o saludos.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {visible.map((r) => (
                    <li key={r.id} className="group flex items-start gap-3 rounded-2xl bg-white px-3.5 py-3 ring-1 ring-slate-200/70">
                      <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-slate-700">
                        /{r.shortcut}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-3 whitespace-pre-line text-[12.5px] leading-snug text-slate-600">{r.text || 'Solo archivos'}</p>
                        {r.media?.length ? (
                          <div className="mt-1.5 flex gap-1.5">
                            {r.media.map((m) => (
                              <QuickReplyMediaThumb key={m.path} media={m} className="h-9 w-9" />
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span className={canManage ? 'flex shrink-0 gap-1' : 'hidden'}>
                        <button
                          type="button"
                          aria-label={`Editar /${r.shortcut}`}
                          onClick={() => setEditing({ id: r.id, shortcut: r.shortcut, text: r.text, media: r.media ?? [] })}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Borrar /${r.shortcut}`}
                          disabled={saving}
                          onClick={() => void persist(draft.filter((x) => x.id !== r.id))}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}

type RecentItem = { messageId: string; mimeType: string | null; filename: string | null; sentAt: string }

/** "Recientes": photos already sent from any chat of this business, one click to re-send. */
export function RecentMediaPopover({
  onPick,
  onUpload,
  onClose,
  sending,
}: {
  onPick: (item: RecentItem) => void
  onUpload: () => void
  onClose: () => void
  sending?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<RecentItem[] | null>(null)
  const [error, setError] = useState(false)
  useDismiss(true, ref, onClose)
  useEffect(() => {
    let alive = true
    fetch('/api/chat/recent-media?kind=image', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { items?: RecentItem[] }) => {
        if (alive) setItems(Array.isArray(data.items) ? data.items : [])
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Adjuntar"
      className="aurora-light text-slate-900 absolute bottom-full left-0 z-40 mb-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
      data-testid="composer-recent-media"
    >
      <button
        type="button"
        onClick={onUpload}
        className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5B6CFF]/10 text-au-ink-5b6cff">
          <Plus className="h-4 w-4" aria-hidden />
        </span>
        <span>
          <span className="block text-[13px] font-semibold text-slate-800">Subir desde el equipo</span>
          <span className="block text-[11.5px] text-slate-500">Foto, video, audio o documento (máx. 9 MB)</span>
        </span>
      </button>
      <div className="px-3 pb-3 pt-2.5">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
          <ImageIcon className="h-3 w-3" aria-hidden /> Recientes
        </p>
        {error ? (
          <p className="px-1 py-4 text-center text-[12px] text-slate-500">No se pudieron cargar las imágenes recientes.</p>
        ) : items === null ? (
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-1 py-4 text-center text-[12px] text-slate-500">
            Las fotos que envíes desde los chats aparecen acá para reusarlas.
          </p>
        ) : (
          <div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto">
            {items.map((item) => (
              <button
                key={item.messageId}
                type="button"
                disabled={sending}
                onClick={() => onPick(item)}
                title={item.filename || 'Imagen'}
                className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200/70 disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/chat/media/${encodeURIComponent(item.messageId)}`}
                  alt={item.filename || 'Imagen reciente'}
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  onError={(e) => {
                    ;(e.currentTarget.parentElement as HTMLElement).style.display = 'none'
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export type { RecentItem as RecentMediaItem }
