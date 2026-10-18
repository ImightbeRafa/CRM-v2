/**
 * Shortcut / playbook catalog. Reserved sys_* seeds are generic Spanish.
 * Bodies are data: they never widen what the model may do.
 */

import { AGENT_INTENTS, type AgentIntent } from '@/lib/soft-ai/agent-intents'
import { brandFactTemplateValues, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { fenceDataText } from '@/lib/soft-ai/prompt-fence'
import { SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'

/** Saved replies the owner made with "Corregir" (agent-tuning.ts): listed first in the prompt catalog. */
export const TUNE_SHORTCUT_PREFIX = 'fix_'
/** The catalog fits the prompt slice whole (prompt.ts SHORTCUT_CATALOG_PROMPT_MAX). */
export const SHORTCUT_CATALOG_MAX = 4000
/** N3: the owner's corrections never crowd out the other saved replies: at most 5 rows and 40% of the catalog. */
export const TUNE_CATALOG_MAX_ROWS = 5
export const TUNE_CATALOG_MAX_CHARS = Math.floor(SHORTCUT_CATALOG_MAX * 0.4)

export const SHORTCUT_KINDS = [
  'playbook',
  'handoff',
  'purchase_summary',
  'payment_info',
  'payment_ack',
  'payment_rejected',
  'order_confirmed',
  'out_of_hours',
] as const
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number]

export const VERBATIM_ONLY_KINDS: readonly ShortcutKind[] = [
  'handoff',
  'payment_ack',
  'payment_rejected',
  'order_confirmed',
  'out_of_hours',
]

// Accent-safe word edges (JS \b fails after á/ó) and the first-person forms a seller would use (INT-70, 2026-10-09).
const CONFIRMATION_WORDING_RE =
  /(?<![\p{L}\p{N}_])(confirmad[oa]|verificad[oa]|recib(?:í|i|imos)\s+(?:tu|el|su|la|los)\s+(?:pago|sinpe|dep[oó]sito|transferencia|plata|dinero)|recibido|pago\s+(?:recibido|aplicado|acreditado|aprobado|confirmado)|(?:ya\s+)?(?:me\s+|nos\s+)?(?:lleg[oó]|cay[oó]|entr[oó])\s+(?:tu|el|su|la|los)\s+(?:pago|sinpe|dep[oó]sito|transferencia|plata|dinero)|(?:ya\s+)?(?:est[aá]|qued[oó])\s+(?:pagad[oa]|acreditad[oa]|aplicad[oa]|confirmad[oa])|te\s+confirmo\s+que\s+(?:el|tu|su|la)\s+(?:pago|plata|transferencia|sinpe)|todo\s+bien\s+con\s+(?:el|tu|su)\s+pago|ya\s+qued[oó]|gracias\s+por\s+(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia)|(?:ya\s+)?tenemos\s+(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia)|ya\s+(?:te\s+|le\s+)?(?:lo\s+|la\s+)?(?:preparamos|enviamos|despachamos|mandamos)(?:\s+(?:tu|su|el)\s+pedido)?|(?:tu|el|su)\s+pedido\s+ya\s+(?:est[aá]|va)\s+(?:en\s+camino|en\s+proceso\s+de\s+env[ií]o|listo))(?=$|[^\p{L}\p{N}_])/iu

export type ShortcutDraft = {
  key: string
  title: string
  kind: ShortcutKind
  intents: AgentIntent[]
  keywords: string[]
  body: string
  deliveryMode: 'verbatim' | 'guide'
  isActive?: boolean
  sortOrder?: number
}

export type RuntimeShortcut = ShortcutDraft & {
  id?: string
  isActive: boolean
  sortOrder: number
  /** ISO time the row was created (orders the owner's corrections newest first, N3). */
  createdAt?: string
}

export const RESERVED_SHORTCUT_KEYS = [
  'sys_handoff_payment',
  'sys_handoff_media',
  'sys_handoff_optout',
  'sys_handoff_unavailable',
  'sys_media_ask',
  'sys_payment_soon',
  'sys_purchase_summary',
  'sys_payment_info',
  'sys_payment_ack',
  'sys_payment_rejected',
  'sys_order_confirmed',
  'sys_out_of_hours',
] as const

export type ReservedShortcutKey = (typeof RESERVED_SHORTCUT_KEYS)[number]

export function isReservedShortcutKey(key: string): key is ReservedShortcutKey {
  return (RESERVED_SHORTCUT_KEYS as readonly string[]).includes(key)
}

/**
 * 2026-10-09 (Rafael): the client never hears "una persona del equipo" — the agent speaks as the store's seller.
 * Agents created before keep the old default texts in their own rows; when a stored text is EXACTLY an old default it
 * is upgraded when read (no database writes). Texts the owner edited are left as they are.
 */
/** "¿Cómo compro?": the fixed shipping data list (Rafael 2026-10-16), one item per line. */
export const HOW_TO_BUY_BODY = `Para armar tu pedido pasame:\n${SHIPPING_DATA_LIST}`
/** The previous default of pb_como_comprar (upgraded to HOW_TO_BUY_BODY). */
const HOW_TO_BUY_V2_BODY = 'Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Dirección exacta (provincia, cantón y distrito)'
/**
 * agents2-format (Rafael 2026-10-16): "¿cómo pago?" lists the method NAMES and asks which one; the chosen method's
 * details go out next ([[PAGO_…]] / inbound-decision). Never every number in one block.
 */
export const PAYMENT_INFO_BODY = 'Podés pagar con:\n{{brand.payment.methodsList}}\n\n¿Cómo preferís pagar?'
/** Purchase summary: shipping + method names (no numbers), each on its own line. */
export const PURCHASE_SUMMARY_BODY = 'Envío: {{brand.shipping.summary}}\nPago: {{brand.payment.methods}}\n\n¿Lo querés con envío a domicilio o retiro?'

const LEGACY_DEFAULT_BODIES = new Map<string, string>([
  ['Una persona del equipo te ayuda con el pago / SINPE. En un momento te escriben.', '¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊'],
  ['Una persona del equipo revisa lo que enviaste y te responde en breve.', '¡Gracias! Dame un momento y lo reviso 😊'],
  ['Claro — te paso con una persona del equipo. En un momento te escriben.', 'Claro 😊 en un momento te escribe alguien de la tienda.'],
  ['En un momento te atiende una persona del equipo. Gracias por la paciencia.', 'Perfecto, dame un momento y te confirmo 😊'],
  // agents2-format (2026-10-16): "¿cómo pago?" asks which method first; the old defaults dumped every number in one line.
  ['Podés pagar así: {{brand.payment.summary}}. Un comprobante lo revisa una persona del equipo; por acá no se confirma el pago.', PAYMENT_INFO_BODY],
  ['Podés pagar así: {{brand.payment.summary}}. Cuando lo hagás, mandame el comprobante; el pago queda listo cuando lo revisamos 😊', PAYMENT_INFO_BODY],
  ['Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Lo querés con envío a domicilio o retiro?', PURCHASE_SUMMARY_BODY],
  ['Para hacer el pedido solo necesito tu nombre completo, teléfono y dirección exacta. ¿Me los pasás?', HOW_TO_BUY_BODY],
  [HOW_TO_BUY_V2_BODY, HOW_TO_BUY_BODY],
  ['Recibimos tu mensaje de pago. Una persona del equipo lo revisa y te escribe.', '¡Gracias! Ya lo reviso y te confirmo 😊'],
  ['No pudimos aplicar ese pago. Una persona del equipo te explica el siguiente paso.', 'Revisé el pago y todavía no me aparece aplicado. ¿Me reenviás el comprobante? 😊'],
  ['Tu pedido {{order.orderId}} quedó registrado por el equipo. Te escribimos si falta algún dato.', 'Listo, tu pedido {{order.orderId}} quedó registrado 😊 Te aviso cualquier cosa.'],
  ['El precio sale del inventario. Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?', 'Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?'],
  // Agentes IA 2.0: previous default of the safe line (sys_handoff_unavailable).
  ['Perfecto, dame un momento y te confirmo 😊', 'Dame un momento y te confirmo 😊'],
])

export function upgradeLegacyShortcutBody(body: string): string {
  return LEGACY_DEFAULT_BODIES.get(body) ?? body
}

export const RESERVED_SHORTCUT_SEEDS: ShortcutDraft[] = [
  {
    key: 'sys_handoff_payment',
    title: 'Pago con una persona',
    kind: 'handoff',
    intents: ['payment_proof', 'human_request'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊',
  },
  {
    key: 'sys_handoff_media',
    title: 'Recibí una imagen',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! Dame un momento y lo reviso 😊',
  },
  {
    key: 'sys_handoff_optout',
    title: 'Cliente pide humano',
    kind: 'handoff',
    intents: ['human_request'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Claro 😊 en un momento te escribe alguien de la tienda.',
  },
  {
    key: 'sys_handoff_unavailable',
    title: 'Sin humano disponible',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    // Agentes IA 2.0 (Rafael 2026-10-15): the safe line for a reply that cannot go out as written; chat stays on IA.
    body: 'Dame un momento y te confirmo 😊',
  },
  {
    // Agentes IA 2.0 (B6): a photo / audio / sticker that is not a receipt: ask in writing, the chat stays on IA.
    key: 'sys_media_ask',
    title: 'Recibí un audio o imagen',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! 😊 ¿Me contás por escrito qué necesitás?',
  },
  {
    // Agentes IA 2.0 (B7): payment details are not shared by chat; the team sends them and the chat stays on IA.
    key: 'sys_payment_soon',
    title: 'Te paso cómo pagar',
    kind: 'handoff',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Enseguida te paso cómo pagar 😊',
  },
  {
    key: 'sys_purchase_summary',
    title: 'Resumen de compra',
    kind: 'purchase_summary',
    intents: ['price', 'how_to_buy'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: PURCHASE_SUMMARY_BODY,
  },
  {
    key: 'sys_payment_info',
    title: 'Formas de pago',
    kind: 'payment_info',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: PAYMENT_INFO_BODY,
  },
  {
    key: 'sys_payment_ack',
    title: 'Comprobante recibido',
    kind: 'payment_ack',
    intents: ['payment_proof'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! Ya lo reviso y te confirmo 😊',
  },
  {
    key: 'sys_payment_rejected',
    title: 'Pago rechazado',
    kind: 'payment_rejected',
    intents: ['payment_proof'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Revisé el pago y todavía no me aparece aplicado. ¿Me reenviás el comprobante? 😊',
  },
  {
    key: 'sys_order_confirmed',
    title: 'Pedido confirmado',
    kind: 'order_confirmed',
    intents: ['order_status'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Listo, tu pedido {{order.orderId}} quedó registrado 😊 Te aviso cualquier cosa.',
  },
  {
    key: 'sys_out_of_hours',
    title: 'Fuera de horario',
    kind: 'out_of_hours',
    intents: ['hours_location'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Ahora estamos fuera de horario ({{brand.hoursText}}). Te respondemos cuando abramos.',
  },
]

export const STARTER_SHORTCUT_TEMPLATES: ShortcutDraft[] = [
  {
    key: 'precio_envio_pago',
    title: 'Precio + envío + pago',
    kind: 'playbook',
    intents: ['price', 'how_to_buy'],
    keywords: ['precio', 'cuesta', 'vale'],
    deliveryMode: 'guide',
    body: 'Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?',
  },
  {
    key: 'como_comprar',
    title: 'Cómo comprar paso a paso',
    kind: 'playbook',
    intents: ['how_to_buy'],
    keywords: ['comprar', 'pedido'],
    deliveryMode: 'guide',
    body: 'Para comprar: elegís el producto, te confirmamos precio y envío, y pagás con {{brand.payment.summary}}. ¿Envío o retiro?',
  },
  {
    key: 'formas_de_pago',
    title: 'Formas de pago',
    kind: 'playbook',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Formas de pago: {{brand.payment.summary}}.',
  },
  {
    key: 'ubicacion_retiro',
    title: 'Ubicación y retiro (RA)',
    kind: 'playbook',
    intents: ['hours_location', 'shipping_info'],
    keywords: ['retiro', 'recoger', 'ubicacion'],
    deliveryMode: 'guide',
    body: 'Retiro: {{brand.location.address}}. {{brand.location.pickupInstructions}}',
  },
  {
    key: 'envio_domicilio',
    title: 'Envío a domicilio (EA) y tiempos',
    kind: 'playbook',
    intents: ['shipping_info'],
    keywords: ['envio', 'domicilio'],
    deliveryMode: 'guide',
    body: '{{brand.shipping.summary}}',
  },
  {
    key: 'horario',
    title: 'Horario',
    kind: 'playbook',
    intents: ['hours_location'],
    keywords: ['horario', 'abren', 'cierran'],
    deliveryMode: 'guide',
    body: 'Horario: {{brand.hoursText}}.',
  },
  {
    key: 'sitio_web',
    title: 'Sitio web / catálogo',
    kind: 'playbook',
    intents: ['website'],
    keywords: ['página', 'pagina', 'sitio', 'web', 'catálogo', 'catalogo'],
    deliveryMode: 'guide',
    body: 'Podés ver todo en {{brand.website}}.',
  },
  {
    key: 'seguimiento_pedido',
    title: 'Seguimiento de pedido',
    kind: 'playbook',
    intents: ['order_status'],
    keywords: ['pedido', 'guía', 'guia', 'tracking'],
    deliveryMode: 'guide',
    body: 'Para el estado del pedido usá el número que te dimos. No inventes estados.',
  },
  {
    key: 'foto_producto',
    title: 'Foto del producto',
    kind: 'playbook',
    intents: ['catalog_photo'],
    keywords: ['foto', 'imagen'],
    deliveryMode: 'guide',
    body: 'Las fotos del catálogo se envían cuando estén cargadas. Mientras tanto describí el producto.',
  },
  {
    key: 'garantia_cambios',
    title: 'Garantía y cambios',
    kind: 'playbook',
    intents: ['returns_policy'],
    keywords: ['garantía', 'garantia', 'cambio', 'devolución'],
    deliveryMode: 'guide',
    body: '{{brand.returnsText}}',
  },
]

export function reservedShortcutBody(key: ReservedShortcutKey): string {
  const seed = RESERVED_SHORTCUT_SEEDS.find((row) => row.key === key)
  return seed?.body || ''
}

export function hasConfirmationWording(text: string): boolean {
  return CONFIRMATION_WORDING_RE.test(text || '')
}

/**
 * v53 tests 2026-10-18 ("¿Qué días hacen envíos?" → safe line): "una vez confirmado el pago, sale el mismo día hábil"
 * is how a store explains the NEXT step, not a claim that it happened. ALLOW-LIST (Verifier round 2): the participle
 * is masked only when its WHOLE sentence is exactly one known next-step line —
 *   "(,) una vez / luego de / después de + confirmado / recibido / verificado + (el) pago / comprobante… (,) + a
 *    next step: (tu pedido) sale … / se envía, se despacha, se prepara … / preparamos tu pedido / te llega en N a N
 *    días hábiles / te enviamos el número de guía / te aviso por aquí"
 * — with nothing else in that sentence (no "ya", no other verb, no claim before or after). Every other sentence of the
 * reply, and any sentence that does not match exactly, is checked strictly by CONFIRMATION_WORDING_RE (unchanged,
 * INT-70 / INT-93) and by the payment-status checks. Only the participle is ever masked, never other words.
 */
const NEXT_STEP_WHEN = String.raw`(?:[ \t]+(?:ese[ \t]+mismo[ \t]+d[ií]a(?:[ \t]+h[aá]bil)?|el[ \t]+mismo[ \t]+d[ií]a(?:[ \t]+h[aá]bil)?|lo[ \t]+antes[ \t]+posible|en[ \t]+\d[ \t]*a[ \t]*\d[ \t]+d[ií]as[ \t]+h[aá]biles|hoy[ \t]+mismo|al[ \t]+d[ií]a[ \t]+siguiente(?:[ \t]+h[aá]bil)?|por[ \t]+correos(?:[ \t]+de[ \t]+costa[ \t]+rica)?|por[ \t]+mensajer[ií]a(?:[ \t]+privada)?))*`
const NEXT_STEP = String.raw`(?:(?:(?:tu|el|su)[ \t]+pedido[ \t]+)?sale${NEXT_STEP_WHEN}|(?:(?:tu|el|su)[ \t]+pedido[ \t]+)?se[ \t]+(?:env[ií]a|despacha|prepara)${NEXT_STEP_WHEN}|(?:te[ \t]+lo[ \t]+|te[ \t]+la[ \t]+)?(?:preparamos|enviamos|despachamos)(?:[ \t]+(?:tu|el|su)[ \t]+pedido)?${NEXT_STEP_WHEN}|te[ \t]+llega(?:r[aá])?[ \t]+en[ \t]+\d[ \t]*a[ \t]*\d[ \t]+d[ií]as[ \t]+h[aá]biles|te[ \t]+(?:enviamos|mandamos|pasamos)[ \t]+(?:el[ \t]+n[uú]mero[ \t]+de[ \t]+gu[ií]a|la[ \t]+gu[ií]a|el[ \t]+n[uú]mero[ \t]+de[ \t]+seguimiento)|te[ \t]+(?:aviso|escribimos)(?:[ \t]+por[ \t]+(?:aqu[ií]|ac[aá]))?)`
const PAY_THING = String.raw`(?:(?:el|tu|su|la|los)[ \t]+)?(?:pago|sinpe|comprobante|transferencia|dep[oó]sito)`
const NEXT_STEP_SENTENCE_RE = new RegExp(
  String.raw`^[ \t,]*(?:una[ \t]+vez|luego[ \t]+de|despu[eé]s[ \t]+de)[ \t]+(confirmad[oa]|recibid[oa]|verificad[oa])[ \t]+${PAY_THING}[ \t]*,?[ \t]*${NEXT_STEP}[ \t]*[\p{Extended_Pictographic}\u{FE0F}\u{200D} \t]*$`,
  'iu',
)
const SENTENCE_RE = /[^.!?¡¿\n]+/gu
/**
 * Anything in the REST of the reply that reports something already done ("Salió hoy con Correos", "ya va", "hemos
 * despachado", "ha sido enviado", "está despachado", "te confirmo…"): then nothing is masked at all (Verifier round 2).
 */
const DONE_CUE_RE =
  /(?<![\p{L}])(?:ya|fue|fueron|sido|listo|lista|listos|en[ \t]+camino|en[ \t]+proceso|te[ \t]+confirmo|todo[ \t]+est[aá]|(?:he|has|ha|hemos|han)[ \t]+\p{L}+|est[aá]n?[ \t]+\p{L}+(?:ad|id)[oa]s?|salio|quedo|llego|despacho|\p{L}{2,}ó)(?![\p{L}])/iu

export function maskConditionalConfirmation(text: string): string {
  const src = text || ''
  let masked = false
  let rest = ''
  const out = src.replace(SENTENCE_RE, (sentence: string) => {
    const m = NEXT_STEP_SENTENCE_RE.exec(sentence)
    if (!m) {
      rest += `${sentence}\n`
      return sentence
    }
    const participle = m[1]
    const at = sentence.toLowerCase().indexOf(participle.toLowerCase())
    if (at < 0) return sentence
    masked = true
    return sentence.slice(0, at) + '·'.repeat(participle.length) + sentence.slice(at + participle.length)
  })
  return masked && !DONE_CUE_RE.test(rest) ? out : src
}

/** The agent's own reply claims a payment / order happened (a conditional next-step participle excluded). */
export function hasOutboundConfirmationClaim(text: string): boolean {
  return hasConfirmationWording(maskConditionalConfirmation(text))
}

export function validateShortcutForSave(draft: {
  key: string
  title: string
  kind: string
  body: string
  deliveryMode: string
  keywords?: string[]
  intents?: string[]
}): { ok: true } | { ok: false; code: string } {
  if (!/^[a-z0-9_]{2,40}$/.test(draft.key)) return { ok: false, code: 'shortcut_key_invalid' }
  if (!draft.title.trim() || draft.title.trim().length > 60) {
    return { ok: false, code: 'shortcut_title_invalid' }
  }
  if (!(SHORTCUT_KINDS as readonly string[]).includes(draft.kind)) {
    return { ok: false, code: 'shortcut_kind_invalid' }
  }
  const body = draft.body.trim()
  if (!body || body.length > 1500) return { ok: false, code: 'shortcut_body_invalid' }
  if (draft.deliveryMode !== 'verbatim' && draft.deliveryMode !== 'guide') {
    return { ok: false, code: 'shortcut_delivery_invalid' }
  }
  if (
    (VERBATIM_ONLY_KINDS as readonly string[]).includes(draft.kind) &&
    draft.deliveryMode !== 'verbatim'
  ) {
    return { ok: false, code: 'shortcut_delivery_invalid' }
  }
  if ((draft.keywords || []).length > 20) return { ok: false, code: 'shortcut_keywords_invalid' }
  for (const intent of draft.intents || []) {
    if (!(AGENT_INTENTS as readonly string[]).includes(intent)) {
      return { ok: false, code: 'shortcut_intent_invalid' }
    }
  }
  if (hasConfirmationWording(body)) return { ok: false, code: 'confirmation_wording' }
  return { ok: true }
}

export type TemplateContext = {
  facts: BrandFacts
  inventoryPricesBySku?: Record<string, number>
  clientFirstName?: string | null
  orderId?: string | null
}

export const MISSING_FACT_CHIP_HINT = 'Completá Datos de la marca o cargá tus atajos'

const TEMPLATE_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.:]+)\s*\}\}/g

/** Customer text for a starter chip. Missing brand facts disable the chip. */
export function previewStarterChip(
  template: Pick<ShortcutDraft, 'body'>,
  facts: BrandFacts,
): { body: string; missing: string[]; disabled: boolean; hint: string | null } {
  const values = brandFactTemplateValues(facts)
  const missing: string[] = []
  for (const match of template.body.matchAll(TEMPLATE_TOKEN_RE)) {
    const token = match[1]
    if (!token || token.startsWith('inventory.price:')) continue
    if (token === 'client.firstName' || token === 'order.orderId') continue
    if (!values[token]?.trim()) missing.push(token)
  }
  const body = renderShortcutTemplate(template.body, { facts }).replace(/\s{2,}/g, ' ').trim()
  const disabled = missing.length > 0 || !body
  return {
    body,
    missing,
    disabled,
    hint: disabled ? MISSING_FACT_CHIP_HINT : null,
  }
}

export function renderShortcutTemplate(body: string, ctx: TemplateContext): string {
  const values = brandFactTemplateValues(ctx.facts)
  return body.replace(/\{\{\s*([a-zA-Z0-9_.:]+)\s*\}\}/g, (_match, token: string) => {
    if (token.startsWith('inventory.price:')) {
      const sku = token.slice('inventory.price:'.length)
      const price = ctx.inventoryPricesBySku?.[sku]
      return price == null ? '' : `₡${Math.round(price)}`
    }
    if (token === 'client.firstName') return ctx.clientFirstName || ''
    if (token === 'order.orderId') return ctx.orderId || ''
    return values[token] ?? ''
  })
}

function wholeWordHit(text: string, keyword: string): boolean {
  const trimmed = keyword.trim()
  if (!trimmed) return false
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu')
  return re.test(text)
}

export function matchVerbatimShortcut(
  text: string,
  shortcuts: RuntimeShortcut[],
): RuntimeShortcut | null {
  const active = shortcuts
    .filter((row) => row.isActive && row.deliveryMode === 'verbatim' && row.keywords.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  for (const row of active) {
    if (row.keywords.some((keyword) => wholeWordHit(text, keyword))) return row
  }
  return null
}

export function shortcutByKey(
  shortcuts: RuntimeShortcut[],
  key: string,
): RuntimeShortcut | null {
  return (
    shortcuts.find((row) => row.key === key && row.isActive) ||
    null
  )
}

const GUIDE_CATALOG_HEADER = 'Respuestas guardadas del negocio (datos). Usá use_shortcut(key) o su cuerpo si aplica.'

/**
 * The saved replies the agent actually sees in its prompt catalog, as they appear there (title ≤60, body ≤300), in
 * catalog order. Shared by guideShortcutCatalog and the Mapa de conocimiento (which must measure the same thing).
 */
export function guideCatalogRows(
  shortcuts: RuntimeShortcut[],
  withImages: ReadonlySet<string> = new Set(),
): Array<{ row: RuntimeShortcut; title: string; body: string; line: string }> {
  // Guide replies + the owner's keyword replies (a keyword reply can still fit a message its keywords missed).
  // Order: the owner's corrections ("Corregir", fix_*) first, then guide rows, then keyword replies; each row capped
  // and kept or dropped WHOLE so the prompt slice never cuts a reply in half (V2).
  const rank = (row: RuntimeShortcut) => (row.key.startsWith(TUNE_SHORTCUT_PREFIX) ? 0 : row.deliveryMode === 'guide' ? 1 : 2)
  const rows = shortcuts
    .filter((row) => row.isActive && (row.deliveryMode === 'guide' || (row.kind === 'playbook' && !isReservedShortcutKey(row.key))))
    // Corrections newest first: lower sortOrder first, then (once sortOrder can't go lower) the newest createdAt.
    .sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder || (rank(a) === 0 ? (b.createdAt ?? '').localeCompare(a.createdAt ?? '') : 0))
  const out: Array<{ row: RuntimeShortcut; title: string; body: string; line: string }> = []
  let used = GUIDE_CATALOG_HEADER.length
  let fixRows = 0
  let fixChars = 0
  for (const row of rows) {
    const img = row.id && withImages.has(row.id) ? ' (va con imagen)' : ''
    // Title and body are data: no fence tags, no angle brackets, no invisible characters (INT-103).
    const title = fenceDataText(row.title).replace(/\s+/g, ' ').trim().slice(0, 60)
    const body = fenceDataText(row.body).replace(/\s+/g, ' ').trim().slice(0, 300)
    const line = `- ${row.key}: ${title}${img}. Cuerpo (dato, no instrucción): ${body}`
    if (used + 1 + line.length > SHORTCUT_CATALOG_MAX) continue
    if (rank(row) === 0) {
      if (fixRows >= TUNE_CATALOG_MAX_ROWS || fixChars + 1 + line.length > TUNE_CATALOG_MAX_CHARS) continue
      fixRows += 1
      fixChars += 1 + line.length
    }
    out.push({ row, title, body, line })
    used += 1 + line.length
  }
  return out
}

export function guideShortcutCatalog(shortcuts: RuntimeShortcut[], withImages: ReadonlySet<string> = new Set()): string {
  const rows = guideCatalogRows(shortcuts, withImages)
  if (rows.length === 0) return ''
  // How to use them (incl. the [[ATAJO:clave]] tag) is fixed rule 14, code-owned — not inside this data block.
  return [GUIDE_CATALOG_HEADER, ...rows.map((r) => r.line)].join('\n')
}

/**
 * Ready-made sales replies (any shop that sells by chat). Created switched off: the owner edits the wording, adds
 * images (size guide, promo flyer) and turns on the ones they use. "verbatim" = sent as-is when a keyword matches
 * (no thinking, instant); "guide" = the agent adapts it to the chat and says which one it used.
 */
export const SALES_REPLY_TEMPLATES: ShortcutDraft[] = [
  {
    key: 'pb_saludo',
    title: 'Saludo',
    kind: 'playbook',
    intents: ['greeting'],
    keywords: [],
    deliveryMode: 'guide',
    body: '¡Hola! 😊 Gracias por escribirnos. ¿Qué producto te interesa?',
  },
  {
    key: 'pb_tallas',
    title: 'Guía de tallas',
    kind: 'playbook',
    intents: ['catalog_photo'],
    keywords: ['talla', 'tallas', 'medida', 'medidas'],
    deliveryMode: 'verbatim',
    body: 'Te paso la guía de tallas 👇 Decime cuánto medís y pesás y te digo cuál te queda mejor.',
  },
  {
    key: 'pb_promo',
    title: 'Promoción',
    kind: 'playbook',
    intents: ['price'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Te paso la promo que tenemos ahora 👇 ¿Cuál te gustaría?',
  },
  {
    key: 'pb_envio',
    title: 'Envío',
    kind: 'playbook',
    intents: ['shipping_info'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Hacemos envíos. Decime a dónde sería y te digo el precio y cuánto tarda.',
  },
  {
    key: 'pb_contra_entrega',
    title: 'Pago contra entrega',
    kind: 'playbook',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Te digo si en tu zona se puede pagar contra entrega: ¿a dónde sería el envío?',
  },
  {
    key: 'pb_como_comprar',
    title: 'Cómo comprar',
    kind: 'playbook',
    intents: ['how_to_buy'],
    keywords: [],
    deliveryMode: 'guide',
    // agents2-format: the data as a vertical list (one item per line), never one long sentence.
    // Rafael 2026-10-16: the fixed shipping list (order-data-list.ts), not negotiable.
    body: HOW_TO_BUY_BODY,
  },
  {
    key: 'pb_post_venta',
    title: 'Después de la compra',
    kind: 'playbook',
    intents: ['order_status'],
    keywords: [],
    deliveryMode: 'guide',
    body: '¡Gracias por tu compra! 😊 Cualquier cosa del pedido me escribís por aquí.',
  },
]
