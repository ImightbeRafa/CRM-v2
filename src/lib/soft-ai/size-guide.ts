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
