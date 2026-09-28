'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, Info, Loader2, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { ChatInboxMessage } from '@/lib/chat-inbox'

export type ChatMediaKind = 'image' | 'video' | 'audio' | 'file'

const MEDIA_LABEL: Record<ChatMediaKind, string> = {
  image: 'la imagen',
  audio: 'el audio',
  video: 'el video',
  file: 'el archivo',
}

export function chatMediaKind(msg: Pick<ChatInboxMessage, 'messageType' | 'mediaMimeType'>): ChatMediaKind {
  const mime = (msg.mediaMimeType || '').toLowerCase()
  const type = (msg.messageType || '').toLowerCase()
  if (type === 'image' || type === 'sticker' || mime.startsWith('image/')) return 'image'
  if (type === 'video' || mime.startsWith('video/')) return 'video'
  if (type === 'audio' || type === 'voice' || mime.startsWith('audio/')) return 'audio'
  return 'file'
}

/** Spanish reason for a failed `/api/chat/media` response (status + JSON `error`). */
export function mediaFailureReason(status: number, error: string | null | undefined): string {
  const e = String(error || '').toLowerCase()
  if (status === 413) return 'El archivo supera el límite de 25 MB.'
  if (status === 404) return 'Este mensaje ya no tiene el archivo disponible.'
  if (status === 401 || status === 403) return 'Tu sesión no tiene acceso a este archivo.'
  if (status === 400 && e.includes('token')) return 'La línea necesita reconectarse para descargar archivos.'
  if (/(does not exist|expired|unsupported get request|invalid parameter|not found)/.test(e)) {
    return 'WhatsApp ya no guarda este archivo (se borra después de unos días).'
  }
  if (/(access token|oauth|session has expired|appsecret)/.test(e)) {
    return 'La línea necesita reconectarse para descargar archivos.'
  }
  return 'No se pudo descargar desde el canal. Probá de nuevo.'
}

function withRetry(src: string, attempt: number): string {
  return attempt > 0 ? `${src}?r=${attempt}` : src
}

/** Failed media: real reason (asks the server once) + Reintentar + Descargar. */
function MediaFallback({
  src,
  kind,
  filename,
  onRetry,
}: {
  src: string
  kind: ChatMediaKind
  filename?: string | null
  onRetry: () => void
}) {
  const [reason, setReason] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    fetch(src, { credentials: 'same-origin', signal: ctrl.signal })
      .then(async (res) => {
        if (!alive) return
        if (res.ok) {
          // Bytes arrive fine: the browser cannot decode this format.
          setReason(kind === 'audio' ? 'Este navegador no reproduce este formato de audio. Descargalo para escucharlo.' : 'Este navegador no puede mostrar este formato.')
          try {
            await res.body?.cancel()
          } catch {
            // ignore
          }
          return
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (alive) setReason(mediaFailureReason(res.status, body.error))
      })
      .catch(() => {
        if (alive) setReason('Sin conexión. Probá de nuevo.')
      })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [src, kind])

  return (
    <div
      className="mt-1 flex min-w-[220px] max-w-xs items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600 ring-1 ring-slate-200/70"
      data-testid="soft-thread-media-fallback"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-700">No se pudo mostrar {MEDIA_LABEL[kind]}</span>
        {reason ? <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">{reason}</span> : null}
        {filename ? <span className="mt-0.5 block truncate text-slate-400">{filename}</span> : null}
        <span className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-semibold text-[#5B6CFF] hover:underline"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Reintentar
          </button>
          <a href={src} download className="inline-flex items-center gap-1 font-semibold text-[#5B6CFF] hover:underline">
            <Download className="h-3 w-3" aria-hidden /> Descargar
          </a>
        </span>
      </span>
    </div>
  )
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Stable pseudo-waveform per message (no decoding needed; purely visual). */
function waveformBars(seed: string, count = 36): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  const bars: number[] = []
  for (let i = 0; i < count; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const v = ((h >>> 0) % 1000) / 1000
    const envelope = 0.55 + 0.45 * Math.sin((i / count) * Math.PI)
    bars.push(Math.max(0.18, Math.min(1, v * envelope + 0.12)))
  }
  return bars
}

const SPEEDS = [1, 1.5, 2] as const

/** WhatsApp-style voice note / audio player. Pauses other chat audio when it starts. */
export function ChatAudioPlayer({
  src,
  seed,
  outbound,
  onFailed,
}: {
  src: string
  seed: string
  outbound?: boolean
  onFailed: () => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)
  const bars = useMemo(() => waveformBars(seed), [seed])
  const progress = duration > 0 ? Math.min(1, current / duration) : 0

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail !== audioRef.current) audioRef.current?.pause()
    }
    window.addEventListener('betsy:chat-audio-play', onOther)
    return () => window.removeEventListener('betsy:chat-audio-play', onOther)
  }, [])

  const toggle = useCallback(async () => {
    const el = audioRef.current
    if (!el) return
    if (!el.paused) {
      el.pause()
      return
    }
    window.dispatchEvent(new CustomEvent('betsy:chat-audio-play', { detail: el }))
    setLoading(true)
    try {
      await el.play()
    } catch (error) {
      // NotAllowedError = autoplay policy only; anything else means the file is unusable.
      if (!(error instanceof DOMException && error.name === 'NotAllowedError')) onFailed()
    } finally {
      setLoading(false)
    }
  }, [onFailed])

  const seek = (clientX: number, target: HTMLElement) => {
    const el = audioRef.current
    if (!el || !duration) return
    const rect = target.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
    setCurrent(el.currentTime)
  }

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]
  }

  const accent = outbound ? 'bg-[#5B3FE0]' : 'bg-[#5B6CFF]'
  return (
    <div
      className="mt-1 flex w-[260px] max-w-full items-center gap-2.5 rounded-2xl py-1"
      data-testid="chat-audio-player"
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d)) setDuration(d)
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d)) setDuration(d)
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onEnded={(e) => {
          setPlaying(false)
          e.currentTarget.currentTime = 0
          setCurrent(0)
        }}
        onError={onFailed}
      />
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? 'Pausar audio' : 'Reproducir audio'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition active:scale-95 ${accent}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : playing ? (
          <Pause className="h-4 w-4" fill="currentColor" aria-hidden />
        ) : (
          <Play className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Posición del audio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          className="flex h-7 cursor-pointer items-center gap-[2px]"
          onClick={(e) => seek(e.clientX, e.currentTarget)}
          onKeyDown={(e) => {
            const el = audioRef.current
            if (!el || !duration) return
            if (e.key === 'ArrowRight') el.currentTime = Math.min(duration, el.currentTime + 5)
            if (e.key === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 5)
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              void toggle()
            }
          }}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={`w-[3px] shrink-0 rounded-full transition-colors ${
                i / bars.length < progress ? accent : 'bg-slate-300'
              }`}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[10.5px] tabular-nums text-slate-500">
          <span>{formatClock(playing || current > 0 ? current : duration)}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleSpeed}
              className="rounded-full bg-slate-200/80 px-1.5 py-px text-[10px] font-semibold text-slate-600 hover:bg-slate-300/80"
              aria-label="Velocidad de reproducción"
            >
              {SPEEDS[speedIdx]}×
            </button>
            <a href={src} download aria-label="Descargar audio" className="text-slate-400 hover:text-slate-600">
              <Download className="h-3 w-3" aria-hidden />
            </a>
          </span>
        </div>
      </div>
    </div>
  )
}

/** Full-screen image viewer (Esc / click outside closes). */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagen"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={src}
          download
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Descargar imagen"
        >
          <Download className="h-4 w-4" aria-hidden />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  )
}

/** Media inside a chat bubble (served by message id from `/api/chat/media/[id]`). */
export function ChatMediaBubble({ msg, outbound }: { msg: ChatInboxMessage; outbound?: boolean }) {
  const baseSrc = `/api/chat/media/${encodeURIComponent(msg.id)}`
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const src = withRetry(baseSrc, attempt)
  const kind = chatMediaKind(msg)
  const type = (msg.messageType || '').toLowerCase()
  const markFailed = useCallback(() => setFailed(true), [])
  const retry = useCallback(() => {
    setFailed(false)
    setLoaded(false)
    setAttempt((n) => n + 1)
  }, [])

  if (failed) return <MediaFallback src={src} kind={kind} filename={msg.mediaFilename} onRetry={retry} />

  if (kind === 'image') {
    const alt = msg.content && !msg.content.startsWith('[') ? msg.content : 'imagen'
    const sticker = type === 'sticker'
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className={`relative mt-1 block overflow-hidden rounded-xl ${loaded ? '' : 'min-h-[140px] min-w-[180px] animate-pulse bg-slate-200/70'}`}
          aria-label="Ver imagen"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className={`max-w-full object-contain ${sticker ? 'max-h-32' : 'max-h-72'} ${loaded ? '' : 'opacity-0'}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={markFailed}
          />
        </button>
        {lightbox ? <ImageLightbox src={src} alt={alt} onClose={() => setLightbox(false)} /> : null}
      </>
    )
  }
  if (kind === 'audio') {
    return <ChatAudioPlayer src={src} seed={msg.id} outbound={outbound} onFailed={markFailed} />
  }
  if (kind === 'video') {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        src={src}
        className="mt-1 max-h-72 max-w-full rounded-xl bg-black/5"
        onError={markFailed}
      />
    )
  }
  const name = msg.mediaFilename || (type === 'document' || (msg.mediaMimeType || '').includes('pdf') ? 'Documento' : 'Archivo')
  return (
    <div className="mt-1 flex w-[240px] max-w-full items-center gap-3 rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-slate-200/70">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5B6CFF]/10 text-[#5B6CFF]">
        <FileText className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-slate-800">{name}</span>
        <span className="mt-0.5 flex gap-3 text-[11px] font-semibold text-[#5B6CFF]">
          <a href={src} target="_blank" rel="noreferrer" className="hover:underline">
            Abrir
          </a>
          <a href={src} download className="hover:underline">
            Descargar
          </a>
        </span>
      </span>
    </div>
  )
}
