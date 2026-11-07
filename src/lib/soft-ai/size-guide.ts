/**
 * Size-guide image fallback (bot review 2026-11-03): Rafael wants a price or size question to get the brand's
 * size-guide image, but the image only rode with the saved reply the model tagged — 94 of 771 price replies of one
 * brand in 7 days. With the flag on, a price / size question (or a reply that promises "te paso la guía") also gets
 * the guide of that agent's configured saved reply, once per chat (the usual "never twice" rule), never on a
 * hand-off, and never for an agent with no guide configured.
 *
 * Flag SIZE_GUIDE_FLAG (default off), config: { "agents": { "<agentId>": "<shortcut key>" } } — the agent's
 * "tallas" saved reply that carries the guide image.
 * The pure part (sizeGuideFallbackKey) is shared by the live turn and Probar.
 */
import { prisma } from '@/lib/db'
import type { AgentAsset } from '@/lib/soft-ai/agent-assets'
import { selectReplyImages } from '@/lib/soft-ai/reply-images'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'

export const SIZE_GUIDE_FLAG = 'agent_size_guide_v1'

/** Price question: "¿Cuánto cuesta?", "precio", "¿cuánto vale / sale?", "costo". */
const PRICE_CUE_RE =
  /(?<![\p{L}])(?:precios?|costos?|cu[aá]nto\s+(?:cuesta|cuestan|vale|valen|sale|salen|es|cobran|me\s+sale)|cuesta|cuestan|valor)(?![\p{L}])/iu
/** Size question: talla / medidas / "me queda" / weight or height given or asked. */
const SIZE_CUE_RE =
  /(?<![\p{L}])(?:tallas?|medidas?|mido|peso|pes[oó]|kilos?|\d+\s*kg|estatura|me\s+queda|gu[ií]a\s+de\s+tallas)(?![\p{L}])/iu

/** The reply itself promises the guide ("te paso la guía para que elijas la tuya") — then the image must come too. */
const GUIDE_PROMISE_RE =
  /(?<![\p{L}])(?:te\s+(?:paso|dejo|mando|env[ií]o|comparto)\s+(?:la|una|nuestra)\s+gu[ií]a|gu[ií]a\s+de\s+tallas)(?![\p{L}])/iu

export function promisesSizeGuide(replyText: string | null | undefined): boolean {
  return GUIDE_PROMISE_RE.test(replyText || '')
}

export function isPriceOrSizeQuestion(text: string | null | undefined): boolean {
  const t = text || ''
  return PRICE_CUE_RE.test(t) || SIZE_CUE_RE.test(t)
}

/** The configured guide shortcut key for this agent, or null (flag off / agent not configured / bad config). */
export function sizeGuideKeyFor(flag: { enabled: boolean; config: unknown } | null, agentId: string): string | null {
  if (!flag?.enabled) return null
  const agents = (flag.config as { agents?: unknown } | null)?.agents
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return null
  const key = (agents as Record<string, unknown>)[agentId]
  return typeof key === 'string' && /^[a-z0-9_]{2,40}$/.test(key) ? key : null
}

/**
 * The saved reply whose guide image should ride with this reply, or null. Only when: a guide is configured, the
 * customer asked price or size (or the reply promises the guide), the reply's own saved reply sends no image, and the guide still has an image this chat
 * has not received. The caller keeps the hand-off / channel rules (no images on a hand-off).
 */
export function sizeGuideFallbackKey(input: {
  guideKey: string | null
  customerText: string | null | undefined
  /** The reply that goes out: "te paso la guía…" also counts. */
  replyText?: string | null
  replyShortcutKey: string | null | undefined
  shortcuts: RuntimeShortcut[]
  assetsByShortcut: Map<string, AgentAsset[]>
  alreadySent?: Iterable<string>
}): string | null {
  if (!input.guideKey || !(isPriceOrSizeQuestion(input.customerText) || promisesSizeGuide(input.replyText))) return null
  const sent = [...(input.alreadySent ?? [])]
  const own = selectReplyImages({ shortcutKey: input.replyShortcutKey, shortcuts: input.shortcuts, assetsByShortcut: input.assetsByShortcut, alreadySent: sent })
  if (own.images.length) return null
  const guide = selectReplyImages({ shortcutKey: input.guideKey, shortcuts: input.shortcuts, assetsByShortcut: input.assetsByShortcut, alreadySent: sent })
  return guide.images.length ? guide.key : null
}

/** The flag row for this tenant (fails closed: any read error → no fallback). */
export async function loadSizeGuideKey(tenantId: string, agentId: string): Promise<string | null> {
  try {
    const row = await prisma.tenantFeatureFlag.findFirst({ where: { tenantId, scope: tenantId, key: SIZE_GUIDE_FLAG }, select: { enabled: true, config: true } })
    return sizeGuideKeyFor(row, agentId)
  } catch {
    return null
  }
}

/**
 * Rafael 2026-11-06: the guide image went out (with the price answer or earlier) and the same reply still asked
 * "¿Querés que te pase la guía de tallas?" (37 chats in two days). Where the guide stands in this chat:
 *  - 'sent'    every image of the guide already reached this chat;
 *  - 'pending' the guide has an image this chat has not received;
 *  - 'none'    no guide configured / it has no image.
 */
export type SizeGuideState = 'sent' | 'pending' | 'none'

export function sizeGuideState(input: {
  guideKey: string | null | undefined
  shortcuts: RuntimeShortcut[]
  assetsByShortcut: Map<string, AgentAsset[]>
  alreadySent?: Iterable<string>
}): SizeGuideState {
  if (!input.guideKey) return 'none'
  const all = selectReplyImages({ shortcutKey: input.guideKey, shortcuts: input.shortcuts, assetsByShortcut: input.assetsByShortcut })
  if (!all.images.length) return 'none'
  const left = selectReplyImages({ shortcutKey: input.guideKey, shortcuts: input.shortcuts, assetsByShortcut: input.assetsByShortcut, alreadySent: input.alreadySent })
  return left.images.length ? 'pending' : 'sent'
}

/**
 * Code-written prompt context (no customer text): the guide is already in this chat → never offer it again. (Nothing is
 * said before it goes out: whether this reply carries it is only known after the model — fixSizeGuideOffer covers it.)
 */
export function sizeGuidePromptLine(state: SizeGuideState): string | null {
  if (state !== 'sent') return null
  return 'Contexto interno: la imagen de la guía de tallas YA se le envió a este cliente en este chat. No le ofrezcas mandarla ni le preguntes si la quiere ver; si hace falta, decile que la tiene arriba en el chat.'
}

/** The reply mentions the size guide (cheap gate before the sent-image read). */
export const GUIDE_TEXT_RE = /gu[ií]a\s+de\s+tallas/iu

/** The question added when dropping the guide offer left the reply without one (never asks weight / height). */
export const SIZE_GUIDE_NEXT_QUESTION = '¿Cuál talla te aparto? 😊'

/** A question that OFFERS the guide ("¿Querés ver / que te pase la guía de tallas?", "¿Te paso la guía de tallas?"). */
const GUIDE_OFFER_RE =
  /(?<![\p{L}])(?:(?:quer[eé]s|quieres|quisieras|te\s+gustar[ií]a|dese[aá]s)\s+(?:(?:que\s+te\s+(?:pase|mande|env[ií]e|comparta|muestre|deje)|ver|recibir|saber\s+[^?¿]{0,40}?\s+o\s+ver)\s+)?|te\s+(?:paso|mando|env[ií]o|comparto|muestro|dejo)\s+)(?:la|una|nuestra)\s+gu[ií]a\s+de\s+tallas/iu

const EMOJI_ONLY_LINE_RE = /^[\s\p{Extended_Pictographic}‍️]+$/u

/** Question spans: "¿…?" or, without "¿", from the last sentence break ("." / "!" / "…" + space, a line break) to "?". */
function questionSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let from = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '?') continue
    const open = text.lastIndexOf('¿', i)
    let start: number
    if (open >= from) {
      start = open
    } else {
      start = from
      for (let j = i - 1; j >= from; j -= 1) {
        if (text[j] === '\n' || (/[.!…]/.test(text[j]) && /\s/.test(text[j + 1] || ''))) {
          start = j + 1
          break
        }
      }
    }
    spans.push({ start, end: i + 1 })
    from = i + 1
  }
  return spans
}

/**
 * Rafael 2026-11-06: the guide is already in the chat (sent before or with this reply) → remove only the question that
 * OFFERS it (everything else, prices included, stays exactly as written), point "la guía de tallas 👇" at the image
 * above (👆), and add a plain size question only when no question is left. Pure.
 */
export function fixSizeGuideOffer(text: string): { text: string; changed: boolean } {
  let out = text
  let removed = 0
  for (const span of questionSpans(text).reverse()) {
    const piece = text.slice(span.start, span.end)
    const m = GUIDE_OFFER_RE.exec(piece)
    if (!m) continue
    // Without "¿" the cut starts at the offer itself (Verifier r2 #4: "Cuesta ₡14 900 😊 Querés que te pase…?").
    const start = piece.trimStart().startsWith('¿') ? span.start : span.start + (m.index ?? 0)
    out = `${out.slice(0, start).replace(/[ \t]+$/, '').replace(/[,;:]$/, '')}${out.slice(span.end)}`
    removed += 1
  }
  out = out.replace(/(gu[ií]a\s+de\s+tallas[ \t]*)👇/giu, '$1👆')
  out = out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    // A line the cut left with only emoji / spaces would go out as its own bubble.
    .map((l) => (removed > 0 && EMOJI_ONLY_LINE_RE.test(l) ? '' : l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (out === text.trim()) return { text, changed: false }
  if (!/[?¿]/.test(out)) out = out ? `${out}\n\n${SIZE_GUIDE_NEXT_QUESTION}` : SIZE_GUIDE_NEXT_QUESTION
  return { text: out, changed: true }
}

