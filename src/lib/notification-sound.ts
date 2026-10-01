'use client'

/**
 * Betsy's notification chime: a short, soft two-note "marimba" (E5 → A5), synthesised with the
 * Web Audio API — no audio file, nothing to download. Calm by design: low volume, gentle attack,
 * ~0.9 s decay, and at most one chime every few seconds however many messages arrive.
 *
 * Browsers only allow sound after the person has interacted with the page, so the audio context is
 * unlocked on the first click / key press. Each person can turn it off (stored in this browser).
 */
const STORAGE_KEY = 'betsy:notification-sound'
const MIN_GAP_MS = 4000
const VOLUME = 0.12

let ctx: AudioContext | null = null
let lastPlayedAt = 0
let unlockInstalled = false

export function isNotificationSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setNotificationSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode: the toggle just won't persist */
  }
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/** Call once (e.g. when the inbox mounts): unlocks audio on the first user gesture. */
export function installNotificationSoundUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const unlock = () => {
    const c = audioContext()
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined)
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

/** One soft marimba-like note: a sine plus a quiet octave partial, quick attack, smooth decay. */
function note(c: AudioContext, frequency: number, start: number, duration: number, gainPeak: number) {
  const out = c.createGain()
  out.gain.setValueAtTime(0.0001, start)
  out.gain.exponentialRampToValueAtTime(gainPeak, start + 0.015)
  out.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  out.connect(c.destination)
  for (const [mult, level] of [
    [1, 1],
    [2, 0.18],
    [3.01, 0.05],
  ] as const) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency * mult, start)
    g.gain.setValueAtTime(level, start)
    osc.connect(g)
    g.connect(out)
    osc.start(start)
    osc.stop(start + duration + 0.05)
  }
}

/** Plays the chime (respecting the person's setting and the minimum gap). Never throws. */
export function playNotificationChime(force = false): boolean {
  try {
    if (!force && !isNotificationSoundEnabled()) return false
    const now = Date.now()
    if (!force && now - lastPlayedAt < MIN_GAP_MS) return false
    const c = audioContext()
    if (!c || c.state !== 'running') return false
    lastPlayedAt = now
    const t = c.currentTime + 0.01
    note(c, 659.25, t, 0.75, VOLUME) // E5
    note(c, 880.0, t + 0.13, 0.95, VOLUME * 0.85) // A5
    return true
  } catch {
    return false
  }
}

/**
 * True when a refreshed chat row means "a customer just wrote": the last message is inbound and
 * the viewer's unread count went up (new chats count from zero).
 */
export function isNewInboundActivity(
  previousUnread: number | undefined,
  next: { unreadCount?: number | null; lastMessageDirection?: string | null },
): boolean {
  const before = previousUnread ?? 0
  const after = next.unreadCount ?? 0
  return next.lastMessageDirection === 'inbound' && after > before
}
