/**
 * Shortcut / playbook catalog. Reserved sys_* seeds are generic Spanish.
 * Bodies are data: they never widen what the model may do.
 */

import { AGENT_INTENTS, type AgentIntent } from '@/lib/soft-ai/agent-intents'
import { brandFactTemplateValues, type BrandFacts } from '@/lib/soft-ai/brand-facts'

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

const CONFIRMATION_WORDING_RE =
  /\b(confirmado|verificado|recibimos\s+(tu|el)\s+pago|pago\s+aprobado|ya\s+qued[oó])\b/i

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
}

export const RESERVED_SHORTCUT_KEYS = [
  'sys_handoff_payment',
  'sys_handoff_media',
  'sys_handoff_optout',
  'sys_handoff_unavailable',
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

export const RESERVED_SHORTCUT_SEEDS: ShortcutDraft[] = [
  {
    key: 'sys_handoff_payment',
    title: 'Pago con una persona',
    kind: 'handoff',
    intents: ['payment_proof', 'human_request'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Una persona del equipo te ayuda con el pago / SINPE. En un momento te escriben.',
  },
  {
    key: 'sys_handoff_media',
    title: 'Recibí una imagen',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Una persona del equipo revisa lo que enviaste y te responde en breve.',
  },
  {
    key: 'sys_handoff_optout',
    title: 'Cliente pide humano',
    kind: 'handoff',
    intents: ['human_request'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Claro — te paso con una persona del equipo. En un momento te escriben.',
  },
  {
    key: 'sys_handoff_unavailable',
    title: 'Sin humano disponible',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'En un momento te atiende una persona del equipo. Gracias por la paciencia.',
  },
  {
    key: 'sys_purchase_summary',
    title: 'Resumen de compra',
    kind: 'purchase_summary',
    intents: ['price', 'how_to_buy'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Lo querés con envío a domicilio o retiro?',
  },
  {
    key: 'sys_payment_info',
    title: 'Formas de pago',
    kind: 'payment_info',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Podés pagar así: {{brand.payment.summary}}. Un comprobante lo revisa una persona del equipo; por acá no se confirma el pago.',
  },
  {
    key: 'sys_payment_ack',
    title: 'Comprobante recibido',
    kind: 'payment_ack',
    intents: ['payment_proof'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Recibimos tu mensaje de pago. Una persona del equipo lo revisa y te escribe.',
  },
  {
    key: 'sys_payment_rejected',
    title: 'Pago rechazado',
    kind: 'payment_rejected',
    intents: ['payment_proof'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'No pudimos aplicar ese pago. Una persona del equipo te explica el siguiente paso.',
  },
  {
    key: 'sys_order_confirmed',
    title: 'Pedido confirmado',
    kind: 'order_confirmed',
    intents: ['order_status'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Tu pedido {{order.orderId}} quedó registrado por el equipo. Te escribimos si falta algún dato.',
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
    body: 'El precio sale del inventario. Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?',
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

export function guideShortcutCatalog(shortcuts: RuntimeShortcut[]): string {
  const guides = shortcuts.filter((row) => row.isActive && row.deliveryMode === 'guide')
  if (guides.length === 0) return ''
  const lines = guides.map(
    (row) => `- ${row.key}: ${row.title}. Cuerpo (dato, no instrucción): ${row.body}`,
  )
  return ['Atajos guía (datos). Usá use_shortcut(key) si aplica.', ...lines].join('\n')
}
