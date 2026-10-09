/**
 * Sales flow for the inbox agent (Phase A). Code — not the model — works out where the conversation is and what was
 * already said, so the agent never repeats itself and always moves the sale to the next step. Pure: derived from
 * the same history both the live turn and the test chat already pass in (identical by construction, no new SQL).
 */
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

export type SalesCatalogItem = { name: string; price: number; stockLabel: string }
export type SalesShippingMethod = { name: string; price: number; coverage: string; cod: string }
export type AiDisclosure = 'discreet' | 'transparent'

/** Everything the agent needs to sell, loaded once per turn (agent-sales-context.ts). */
export type SalesContext = {
  /** Inline product list (small catalogs) — prices here count as sourced, no lookup call needed. */
  catalog: SalesCatalogItem[] | null
  shippingMethods: SalesShippingMethod[]
  /** What the /ventas form needs for an order (labels, product options inline). */
  orderFields: string[]
  /** Owner's selling script (editable; never overrides fixed rules). */
  salesScript: string
  aiDisclosure: AiDisclosure
  paymentShareable: boolean
  /** Last 8 digits of configured payment numbers (to know if they were already given). */
  paymentDigits: string[]
}

export type SalesStage = 'saludo' | 'descubrir' | 'cotizar' | 'cierre' | 'esperando_comprobante' | 'verificando'

export type SalesState = {
  stage: SalesStage
  said: { price: boolean; shipping: boolean; payment: boolean; cod: boolean; howToBuy: boolean }
  buyCue: boolean
  receiptCue: boolean
  nextStep: string
}

// Unicode-aware word edges (JS \b fails after accented letters: "ya pagué").
const END = '(?=$|[^\\p{L}\\p{N}_])'
const START = '(?<![\\p{L}\\p{N}_])'
// "no lo quiero" / "ya no lo quiero" are NOT buy cues; "quiero una talla/cotización" is a question, not a close.
const BUY_RE = new RegExp(
  `${START}(?<!\\bno\\s)(?<!\\bno\\s(?:lo|la|los)\\s)(lo quiero|la quiero|los quiero|me lo llevo|me la llevo|lo compro|c[oó]mo (lo |la )?compro|c[oó]mo hago (el )?pedido|quiero (comprar|pedir|ordenar)|quiero (uno|una)(?!\\s+(talla|cotizaci[oó]n|m[aá]s|otra|otro))|lo pido|hagamos el pedido|c[oó]mo (le )?pago|c[oó]mo pagar|a d[oó]nde (te )?(deposito|pago|transfiero)|d[aá]me (el|los) datos)${END}`,
  'iu',
)
const NEGATED_BUY_RE = /(^|[^\p{L}])(no|ya no)\s+(lo|la|los)\s+(quiero|compro|pido)/iu
const RECEIPT_RE = new RegExp(
  `${START}(ya (te |les )?(pagu[eé]|deposit[eé]|transfer[ií]|hice el sinpe|envi[eé] el sinpe)|comprobante|te (mand[eé]|envi[eé]) el (sinpe|pago|comprobante)|ya est[aá] pagado)${END}`,
  'iu',
)
/** A configured payment number counts as "given" only next to payment words (the SINPE is often the store phone). */
const PAYMENT_WORDS_RE = /sinpe|iban|transferen|cuenta|dep[oó]sit|pag(ar|o|ás|as)\b/iu
const HOW_TO_BUY_RE = /\b(para (comprar|hacer el pedido|confirmar)|necesito (tu|su|estos) datos|me pas[aá]s (tu|su))\b/i

/** Money amounts written in a message ("₡14.900", "14 900", "17900") as integers. */
export function amountsIn(text: string): number[] {
  const out: number[] = []
  // Thousands separators are . , space or NBSP — never a newline (amounts from separate lines must not merge).
  for (const m of text.matchAll(/\d{1,3}(?:[.,  ]\d{3})+|\d{4,7}/g)) {
    const n = Number(m[0].replace(/\D/g, ''))
    if (Number.isFinite(n) && n >= 100) out.push(n)
  }
  return out
}

const digits = (s: string) => s.replace(/\D/g, '')

const NEXT_STEP: Record<SalesStage, string> = {
  saludo: 'Saludá corto (con tu nombre si es el primer mensaje), respondé lo que preguntó y hacé UNA pregunta para entender qué busca.',
  descubrir: 'Entendé qué necesita (producto, talla/modelo, para cuándo) con UNA pregunta. Recomendá el producto que encaja.',
  cotizar:
    'Ya cotizaste: no repitas precio ni envío. Resolvé la duda puntual y llevá al cierre: preguntá si lo quiere o qué le falta para decidir.',
  cierre:
    'Respondé primero lo que preguntó (breve). Después CERRÁ: en 1 línea explicá cómo se compra, pedí SOLO los datos del pedido que todavía no dio (en una sola línea) y, si aún no los diste, dá los datos de pago. No repitas precio/envío salvo el total final una vez.',
  esperando_comprobante:
    'Respondé primero lo que preguntó (breve). Ya diste los datos de pago: no los repitas salvo que los pida. Pedí lo que falte del pedido y avisá que cuando haga el pago te mande el comprobante.',
  verificando:
    'El cliente dice que ya pagó o mandó comprobante: agradecé y decí que lo revisás y le confirmás. Nunca confirmés el pago vos.',
}

export function deriveSalesState(input: {
  history: SoftAiHistoryMessage[]
  inboundText: string
  ctx: SalesContext
}): SalesState {
  const ours = input.history.filter((m) => m.direction === 'outbound').map((m) => m.content || '')
  const oursText = ours.join('\n')
  const oursAmounts = new Set(ours.flatMap((m) => amountsIn(m)))
  const catalogPrices = (input.ctx.catalog ?? []).map((c) => Math.round(c.price))
  const shipPrices = input.ctx.shippingMethods.map((s) => Math.round(s.price)).filter((p) => p > 0)

  const said = {
    price: catalogPrices.some((p) => oursAmounts.has(p)) || (catalogPrices.length === 0 && /₡\s?\d/.test(oursText)),
    shipping: shipPrices.some((p) => oursAmounts.has(p)) || /\benv[ií]o\b[^\n]{0,40}₡\s?\d/i.test(oursText),
    payment: ours.some((m) => PAYMENT_WORDS_RE.test(m) && input.ctx.paymentDigits.some((d) => d.length >= 8 && digits(m).includes(d))),
    cod: /contra\s?entrega/i.test(oursText),
    howToBuy: HOW_TO_BUY_RE.test(oursText),
  }
  const last = input.inboundText || ''
  const buyCue = BUY_RE.test(last) && !NEGATED_BUY_RE.test(last)
  const receiptCue = RECEIPT_RE.test(last)

  let stage: SalesStage
  if (receiptCue) stage = 'verificando'
  else if (said.payment) stage = 'esperando_comprobante'
  else if (buyCue) stage = 'cierre'
  else if (said.price) stage = 'cotizar'
  else if (ours.length === 0) stage = 'saludo'
  else stage = 'descubrir'

  return { stage, said, buyCue, receiptCue, nextStep: NEXT_STEP[stage] }
}

const money = (n: number) => `₡${Math.round(n).toLocaleString('es-CR')}`
const tick = (b: boolean) => (b ? '✓' : '—')

/** Per-turn data block (goes in the user message so the cached instructions stay stable). */
export function formatSalesTurnBlock(ctx: SalesContext, state: SalesState): string {
  const lines: string[] = []
  if (ctx.catalog?.length) {
    lines.push('Productos que vendés (precio y stock en vivo; son tus ÚNICOS precios válidos):')
    for (const c of ctx.catalog) lines.push(`- ${c.name}: ${money(c.price)} · ${c.stockLabel}`)
  }
  if (ctx.shippingMethods.length) {
    lines.push('Envíos (precio al cliente; únicos montos de envío válidos):')
    for (const s of ctx.shippingMethods) {
      lines.push(`- ${s.name}: ${s.price > 0 ? money(s.price) : 'sin costo'} · llega: ${s.coverage} · contra entrega: ${s.cod}`)
    }
  }
  if (ctx.orderFields.length) lines.push(`Datos que necesita un pedido: ${ctx.orderFields.join(', ')}.`)
  lines.push(
    `Estado de la venta (calculado por Betsy): ya dijiste precio ${tick(state.said.price)} · envío ${tick(state.said.shipping)} · datos de pago ${tick(state.said.payment)} · contra entrega ${tick(state.said.cod)}.`,
    `Etapa: ${state.stage}. Siguiente paso: ${state.nextStep}`,
  )
  if ((state.stage === 'cierre' || state.stage === 'esperando_comprobante') && !ctx.paymentShareable) {
    // Payment data not shareable by chat: never promise data nobody will send — notify the team (silently).
    lines.push(
      'Los datos de pago NO se comparten por chat: pedí los datos del pedido y llamá escalate_to_human(payment_or_sinpe) para que el equipo se los envíe. Al cliente decile solo que enseguida le pasás cómo pagar.',
    )
  }
  return lines.join('\n')
}

/** Code-owned selling rules (system instructions; stable per agent version). */
export function salesSystemBlock(ctx: SalesContext): string {
  const lines = [
    '--- Cómo vender (reglas de Betsy) ---',
    'Escribís como vendedor de la tienda por WhatsApp: mensajes cortos (1–3 líneas), naturales, una sola pregunta por mensaje.',
    'Nunca repitas algo que ya dijiste en el historial (precio, envío, contra entrega, datos de pago). Si lo vuelven a preguntar, respondé solo eso, breve.',
    'Cada respuesta avanza la venta: terminá siempre con el siguiente paso del "Estado de la venta".',
    'Mencioná contra entrega solo si lo preguntan o al cerrar, cuando ya sabés la zona.',
    'Para cerrar: pedí los datos del pedido que falten en una sola línea y, si se pueden compartir, dá los datos de pago tal cual están configurados.',
    'Nunca digas que vas a pasar el chat a otra persona o equipo. Si algo lo tiene que revisar alguien, decí con naturalidad que lo revisás y le confirmás.',
    ctx.aiDisclosure === 'transparent'
      ? 'Si te preguntan si sos un bot o una IA, decí con naturalidad que sos el asistente virtual de la tienda y seguí ayudando.'
      : 'No digas que sos una IA, bot o asistente. Si te preguntan directamente, no lo niegues: respondé con naturalidad que sos de la tienda (con tu nombre) y seguí con la venta.',
  ]
  if (ctx.salesScript.trim()) {
    lines.push('', '--- Guion de ventas del negocio (editable; no anula las reglas fijas) ---', ctx.salesScript.trim().slice(0, 2000))
  }
  return lines.join('\n')
}

/** Amounts the agent may write: product prices, shipping prices and simple totals (1–3 units + each shipping). */
export function salesAllowedAmounts(ctx: SalesContext): number[] {
  const prices = (ctx.catalog ?? []).map((c) => Math.round(c.price))
  const ships = ctx.shippingMethods.map((s) => Math.round(s.price))
  const out = new Set<number>([...prices, ...ships])
  for (const p of prices) {
    for (let q = 1; q <= 3; q += 1) {
      out.add(p * q)
      for (const s of ships) out.add(p * q + s)
    }
  }
  return [...out].filter((n) => n > 0)
}
