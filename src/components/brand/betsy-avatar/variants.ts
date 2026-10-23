/**
 * Betsy avatar family: one character, per-agent variants (accent colors + shape nuance + name).
 * Pure data, no React: safe to import from server code, tests and client components.
 *
 * Deterministic: the same agent always gets the same variant. Known persona names (the
 * customer-facing first name in `introductionNames[0]`) get a curated look; every other agent
 * gets one generated from a stable hash of its name, so new agents need no setup.
 */

export type AvatarShape = 'drop' | 'orb' | 'pebble'

export type AvatarPalette = {
  /** Rim light gradient, top-left → bottom-right. */
  rim: readonly [string, string, string]
  /** Dark glossy body, center → edge. Tinted toward the rim so variants feel distinct. */
  body: readonly [string, string, string]
  /** Smile / small details (light enough to read on the dark body). */
  accent: string
}

export type AvatarVariant = {
  /** Stable key, e.g. `betsy`, `sofi`, `gen-3a`. */
  key: string
  shape: AvatarShape
  palette: AvatarPalette
  /** Name shown next to the avatar (customer-facing persona name when there is one). */
  displayName: string
}

/** Betsy's own colors: the original logo gradient (#1E5BF6 → #682BF8 → #9425F9), lifted for glow. */
export const BETSY_PALETTE: AvatarPalette = {
  rim: ['#3D72FF', '#6A3BFF', '#B24BFF'],
  body: ['#2B2A7A', '#161447', '#0B0A26'],
  accent: '#A68BFF',
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixHex(a: string, b: string, amount: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return (
    '#' +
    x
      .map((v, i) => Math.round(v * amount + y[i] * (1 - amount)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/** Build a full palette from a two-color accent: the body stays Betsy's night indigo, tinted. */
function paletteFrom(from: string, to: string, tint = 0.3): AvatarPalette {
  return {
    rim: [from, mixHex(from, to, 0.5), to],
    body: [
      mixHex(from, BETSY_PALETTE.body[0], tint),
      mixHex(to, BETSY_PALETTE.body[1], tint * 0.6),
      BETSY_PALETTE.body[2],
    ],
    accent: mixHex(to, '#FFFFFF', 0.6),
  }
}

/**
 * Curated looks for the live personas, keyed by normalized first name (no store names here:
 * the agents UI folder must stay free of pilot brand words).
 */
const PERSONAS: Record<string, { shape: AvatarShape; palette: AvatarPalette }> = {
  betsy: { shape: 'drop', palette: BETSY_PALETTE },
  sofi: { shape: 'pebble', palette: paletteFrom('#19C6A0', '#3D72FF') },
  vale: { shape: 'orb', palette: paletteFrom('#5B6CFF', '#C9A6FF') },
  laura: { shape: 'drop', palette: paletteFrom('#38BDF8', '#F472B6') },
  andres: { shape: 'pebble', palette: paletteFrom('#FF8A3D', '#E5367A') },
  dani: { shape: 'orb', palette: paletteFrom('#22D3EE', '#8B5CF6') },
  caro: { shape: 'drop', palette: paletteFrom('#A78BFA', '#F0A6FC') },
}

/** Generated accents for agents without a curated persona (all pass on dark and light). */
const GENERATED: ReadonlyArray<readonly [string, string]> = [
  ['#3D72FF', '#22D3EE'],
  ['#6366F1', '#EC4899'],
  ['#10B981', '#3B82F6'],
  ['#F59E0B', '#EF4444'],
  ['#8B5CF6', '#06B6D4'],
  ['#0EA5E9', '#A855F7'],
  ['#14B8A6', '#84CC16'],
  ['#F43F5E', '#8B5CF6'],
]
const SHAPES: ReadonlyArray<AvatarShape> = ['drop', 'orb', 'pebble']

/** FNV-1a 32-bit: tiny, stable across runtimes. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** "Andrés " → "andres". */
export function normalizePersonaName(name: string): string {
  return name
    .trim()
    .split(/\s+/)[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export type AvatarSource = {
  /** Agent id (any stable string). */
  id?: string | null
  /** Internal agent name, e.g. "Prototipo ventas". */
  name?: string | null
  /** Customer-facing names (`ChatAgent.introductionNames`); the first non-empty one wins. */
  introductionNames?: ReadonlyArray<string> | null
}

/** First non-empty customer-facing name, or null. */
export function personaName(src: AvatarSource): string | null {
  const first = (src.introductionNames ?? []).map((n) => n.trim()).find(Boolean)
  return first || null
}

export function resolveAvatarVariant(src: AvatarSource): AvatarVariant {
  const persona = personaName(src)
  const key = persona ? normalizePersonaName(persona) : ''
  const curated = key ? PERSONAS[key] : undefined
  if (curated) {
    return { key, shape: curated.shape, palette: curated.palette, displayName: persona as string }
  }
  // Seeded by the customer-facing name first (what the owner chose), so the draft preview and the
  // saved agent look the same; internal name next (unique per tenant), id as the last resort.
  const seed = stableHash(String(persona || src.name?.trim() || src.id || 'betsy').toLowerCase())
  const [from, to] = GENERATED[seed % GENERATED.length]
  return {
    key: `gen-${(seed % 4096).toString(16)}`,
    shape: SHAPES[(seed >>> 8) % SHAPES.length],
    palette: paletteFrom(from, to),
    displayName: persona || (src.name ?? '').trim() || 'Agente',
  }
}

/** Betsy herself (support button, home, logo-adjacent spots). */
export const BETSY_VARIANT: AvatarVariant = {
  key: 'betsy',
  shape: 'drop',
  palette: BETSY_PALETTE,
  displayName: 'Betsy',
}

/** Curated persona names, for the showcase. */
export const CURATED_PERSONAS = ['Betsy', 'Sofi', 'Vale', 'Laura', 'Andrés', 'Dani', 'Caro'] as const
