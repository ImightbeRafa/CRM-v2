/**
 * Structured brand facts for a chat agent. Nothing brand-specific lives here.
 */

import { z } from 'zod'

const urlField = z
  .string()
  .trim()
  .max(300)
  .refine((value) => value.length === 0 || /^https?:\/\/\S+$/i.test(value), 'url')

const money = z.number().finite().nonnegative()

export const BrandFactsSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    storeName: z.string().trim().max(60).optional(),
    website: urlField.optional(),
    catalogUrl: urlField.optional(),
    location: z
      .object({
        address: z.string().trim().max(200).optional(),
        mapsUrl: urlField.optional(),
        pickupInstructions: z.string().trim().max(300).optional(),
      })
      .optional(),
    hoursText: z.string().trim().max(200).optional(),
    shipping: z
      .object({
        ea: z
          .object({
            enabled: z.boolean(),
            gamCost: money.optional(),
            outsideGamCost: money.optional(),
            freeOver: money.optional(),
            etaText: z.string().trim().max(120).optional(),
            courierText: z.string().trim().max(80).optional(),
          })
          .optional(),
        ra: z
          .object({
            enabled: z.boolean(),
            text: z.string().trim().max(200).optional(),
          })
          .optional(),
        contraEntrega: z
          .object({
            enabled: z.boolean(),
            text: z.string().trim().max(200).optional(),
          })
          .optional(),
      })
      .optional(),
    payment: z
      .object({
        shareWithCustomers: z.boolean().default(false),
        methods: z
          .array(z.enum(['sinpe', 'transferencia', 'tarjeta', 'efectivo', 'contra_entrega']))
          .max(5)
          .default([]),
        sinpe: z
          .object({
            number: z.string().trim().max(32).optional(),
            holderName: z.string().trim().max(80).optional(),
          })
          .optional(),
        transfer: z
          .object({
            bank: z.string().trim().max(80).optional(),
            iban: z.string().trim().max(40).optional(),
            holderName: z.string().trim().max(80).optional(),
          })
          .optional(),
        /** Where a customer pays by card (falls back to the brand website). [[PAGO_TARJETA]] sends this link. */
        cardUrl: urlField.optional(),
        instructionsText: z.string().trim().max(300).optional(),
      })
      .optional(),
    returnsText: z.string().trim().max(300).optional(),
    extraFacts: z
      .array(
        z.object({
          label: z.string().trim().max(40),
          value: z.string().trim().max(200),
        }),
      )
      .max(10)
      .optional(),
  })
  .strict()

export type BrandFacts = z.infer<typeof BrandFactsSchema>

export const ReplyStyleSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    maxLines: z.number().int().min(1).max(6).default(4),
    askOneQuestion: z.boolean().default(true),
    emojiLevel: z.enum(['none', 'light']).default('light'),
    purchaseInfoMustBeComplete: z.boolean().default(true),
  })
  .strict()

export type ReplyStyle = z.infer<typeof ReplyStyleSchema>

export const DEFAULT_REPLY_STYLE: ReplyStyle = {
  schemaVersion: 1,
  maxLines: 4,
  askOneQuestion: true,
  emojiLevel: 'light',
  purchaseInfoMustBeComplete: true,
}

export const EMPTY_BRAND_FACTS: BrandFacts = {
  schemaVersion: 1,
}

function blankToUndef(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') return undefined
  return value
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (!value || typeof value !== 'object') return blankToUndef(value)
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = scrub(child)
    if (next !== undefined) out[key] = next
  }
  return out
}

export function parseBrandFactsSafe(raw: unknown): BrandFacts {
  try {
    return parseBrandFacts(raw ?? {})
  } catch {
    return { ...EMPTY_BRAND_FACTS }
  }
}

export function parseReplyStyleSafe(raw: unknown): ReplyStyle {
  try {
    return parseReplyStyle(raw ?? {})
  } catch {
    return { ...DEFAULT_REPLY_STYLE }
  }
}

export function parseBrandFacts(raw: unknown): BrandFacts {
  const scrubbed = scrub(raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!scrubbed.schemaVersion) scrubbed.schemaVersion = 1
  const parsed = BrandFactsSchema.safeParse(scrubbed)
  if (!parsed.success) {
    throw new Error('BRAND_FACTS_INVALID')
  }
  return parsed.data
}

export function parseReplyStyle(raw: unknown): ReplyStyle {
  const scrubbed = scrub(raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!scrubbed.schemaVersion) scrubbed.schemaVersion = 1
  const parsed = ReplyStyleSchema.safeParse(scrubbed)
  if (!parsed.success) {
    throw new Error('REPLY_STYLE_INVALID')
  }
  return parsed.data
}

export function paymentFactsComplete(facts: BrandFacts): boolean {
  const payment = facts.payment
  if (!payment) return false
  const methods = payment.methods || []
  if (methods.length === 0 && !payment.instructionsText) return false
  if (methods.includes('sinpe') && !payment.sinpe?.number) return false
  if (methods.includes('transferencia') && !payment.transfer?.iban && !payment.transfer?.bank) {
    return false
  }
  return true
}

export function canSharePaymentFacts(facts: BrandFacts): boolean {
  return Boolean(facts.payment?.shareWithCustomers) && paymentFactsComplete(facts)
}

export function purchaseSummaryRenderable(facts: BrandFacts): boolean {
  const shipping = facts.shipping
  const hasShip = Boolean(shipping?.ea?.enabled || shipping?.ra?.enabled)
  const methods = facts.payment?.methods || []
  const hasPay = methods.length > 0 || Boolean(facts.payment?.instructionsText)
  return hasShip && hasPay
}

function crc(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return `₡${Math.round(value)}`
}

export function shippingSummary(facts: BrandFacts): string {
  const parts: string[] = []
  const ea = facts.shipping?.ea
  if (ea?.enabled) {
    const costs = [
      ea.gamCost != null ? `GAM ${crc(ea.gamCost)}` : '',
      ea.outsideGamCost != null ? `fuera del GAM ${crc(ea.outsideGamCost)}` : '',
    ]
      .filter(Boolean)
      .join(', ')
    parts.push(`Envío a domicilio${costs ? `: ${costs}` : ''}${ea.etaText ? `. ${ea.etaText}` : ''}`)
  }
  const ra = facts.shipping?.ra
  if (ra?.enabled) {
    parts.push(ra.text ? `Retiro: ${ra.text}` : 'Retiro en tienda disponible')
  }
  return parts.join(' ')
}

export function paymentSummary(facts: BrandFacts): string {
  const payment = facts.payment
  if (!payment) return ''
  const parts: string[] = []
  if (payment.methods?.length) {
    parts.push(`Métodos: ${payment.methods.join(', ')}`)
  }
  if (payment.sinpe?.number) {
    parts.push(
      `SINPE ${payment.sinpe.number}${payment.sinpe.holderName ? ` a nombre de ${payment.sinpe.holderName}` : ''}`,
    )
  }
  if (payment.transfer?.bank || payment.transfer?.iban) {
    parts.push(
      `Transferencia ${[payment.transfer.bank, payment.transfer.iban, payment.transfer.holderName]
        .filter(Boolean)
        .join(' ')}`,
    )
  }
  if (payment.instructionsText) parts.push(payment.instructionsText)
  return parts.join('. ')
}

export function shippingProvenanceAmounts(facts: BrandFacts): number[] {
  const amounts: number[] = []
  const ea = facts.shipping?.ea
  if (ea?.gamCost != null) amounts.push(ea.gamCost)
  if (ea?.outsideGamCost != null) amounts.push(ea.outsideGamCost)
  if (ea?.freeOver != null) amounts.push(ea.freeOver)
  return amounts
}

export function brandFactTemplateValues(facts: BrandFacts): Record<string, string> {
  return {
    'brand.storeName': facts.storeName || '',
    'brand.website': facts.website || '',
    'brand.catalogUrl': facts.catalogUrl || '',
    'brand.hoursText': facts.hoursText || '',
    'brand.location.address': facts.location?.address || '',
    'brand.location.mapsUrl': facts.location?.mapsUrl || '',
    'brand.location.pickupInstructions': facts.location?.pickupInstructions || '',
    'brand.shipping.summary': shippingSummary(facts),
    'brand.shipping.ea.gamCost': crc(facts.shipping?.ea?.gamCost),
    'brand.shipping.ea.outsideGamCost': crc(facts.shipping?.ea?.outsideGamCost),
    // Payment details only when they may be shared (a shortcut must never print them otherwise).
    'brand.payment.summary': canSharePaymentFacts(facts) ? paymentSummary(facts) : '',
    'brand.payment.sinpe.number': canSharePaymentFacts(facts) ? facts.payment?.sinpe?.number || '' : '',
    'brand.payment.sinpe.holderName': canSharePaymentFacts(facts) ? facts.payment?.sinpe?.holderName || '' : '',
    // Method names only (never numbers): "SINPE Móvil, tarjeta (en la web) y contra entrega (solo GAM)".
    'brand.payment.methods': joinEs(paymentMethodLabels(paymentMethodsOf(facts), paymentLabelOptions(facts))),
    // The same as a vertical list ("- SINPE Móvil\n- Tarjeta (en la web)") for the "¿cómo pago?" reply.
    'brand.payment.methodsList': paymentMethodsListText(facts),
    'brand.returnsText': facts.returnsText || '',
  }
}

export const PAYMENT_TOKEN = '[[DATOS_PAGO]]'

/** Payment methods a customer can choose from (agents2-format, 2026-10-16). */
export type PaymentMethodKey = 'sinpe' | 'transferencia' | 'tarjeta' | 'efectivo' | 'contra_entrega'

/**
 * One token per method: the model asks HOW the customer wants to pay, then writes only the chosen method's token and
 * code puts that method's configured details (payment-guard fillPaymentToken). [[DATOS_PAGO]] = every method.
 */
export const PAYMENT_METHOD_TOKENS = {
  sinpe: '[[PAGO_SINPE]]',
  transferencia: '[[PAGO_TRANSFERENCIA]]',
  tarjeta: '[[PAGO_TARJETA]]',
  contra_entrega: '[[PAGO_CONTRA_ENTREGA]]',
} as const

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  sinpe: 'SINPE Móvil',
  transferencia: 'transferencia',
  tarjeta: 'tarjeta',
  efectivo: 'efectivo',
  contra_entrega: 'contra entrega',
}

/** Configured methods, plus contra entrega when the store's shipping offers it. Order as configured. */
export function paymentMethodsOf(facts: BrandFacts): PaymentMethodKey[] {
  const out = [...(facts.payment?.methods || [])] as PaymentMethodKey[]
  if (facts.shipping?.contraEntrega?.enabled && !out.includes('contra_entrega')) out.push('contra_entrega')
  return out
}

export type PaymentLabelOptions = { cardOnWeb: boolean; codGamOnly: boolean }

/** "(en la web)" when there is a card link / website; "(solo GAM)" when the store's COD text says GAM. */
export function paymentLabelOptions(facts: BrandFacts): PaymentLabelOptions {
  return {
    cardOnWeb: Boolean(facts.payment?.cardUrl || facts.website),
    codGamOnly: /\bGAM\b/i.test(facts.shipping?.contraEntrega?.text || ''),
  }
}

/** Customer-facing method names: SINPE Móvil, transferencia, tarjeta (en la web), efectivo, contra entrega (solo GAM). */
export function paymentMethodLabels(methods: readonly string[], opts: PaymentLabelOptions): string[] {
  return [...new Set(methods)].map((m) => {
    if (m === 'tarjeta' && opts.cardOnWeb) return 'tarjeta (en la web)'
    if (m === 'contra_entrega' && opts.codGamOnly) return 'contra entrega (solo GAM)'
    return PAYMENT_METHOD_LABEL[m] || m
  })
}

/** "a", "a y b", "a, b y c". */
export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** "- SINPE Móvil\n- Tarjeta (en la web)\n- Contra entrega (solo GAM)" (or the owner's payment note when no method is set). */
export function paymentMethodsListText(facts: BrandFacts): string {
  const labels = paymentMethodLabels(paymentMethodsOf(facts), paymentLabelOptions(facts))
  if (labels.length) return labels.map((l) => `- ${capitalize(l)}`).join('\n')
  return (facts.payment?.instructionsText || '').replace(/\s+/g, ' ').trim()
}

/** The method question, built only from the configured methods. */
export function paymentMethodQuestion(labels: readonly string[]): string {
  return labels.length ? `¿Cómo preferís pagar? Tenemos ${joinEs(labels)}.` : '¿Cómo preferís pagar?'
}

/** "62019914" → "6201 9914" (a +506 prefix is dropped); anything else stays as configured. */
export function formatSinpeNumber(number: string): string {
  const d = (number || '').replace(/\D/g, '')
  const local = d.length === 11 && d.startsWith('506') ? d.slice(3) : d
  if (local.length === 8) return `${local.slice(0, 4)} ${local.slice(4)}`
  return (number || '').replace(/\s+/g, ' ').trim()
}

/** "CR05015202001026284066" → "CR05 0152 0200 1026 2840 66"; anything else stays as configured. */
export function formatIban(iban: string): string {
  const compact = (iban || '').replace(/[\s.-]/g, '').toUpperCase()
  if (/^CR\d{20}$/.test(compact)) return compact.match(/.{1,4}/g)!.join(' ')
  return (iban || '').replace(/\s+/g, ' ').trim()
}

/** What the model may know about payments: methods only, never the numbers (code fills the payment tokens). */
export function paymentFactsForPrompt(facts: BrandFacts): string {
  if (!canSharePaymentFacts(facts)) return 'Pagos: los datos de pago no se comparten por chat.'
  const methods = paymentMethodsOf(facts)
  const labels = paymentMethodLabels(methods, paymentLabelOptions(facts))
  const tokens = methods
    .filter((m): m is keyof typeof PAYMENT_METHOD_TOKENS => m in PAYMENT_METHOD_TOKENS)
    .map((m) => `${PAYMENT_METHOD_LABEL[m]} → ${PAYMENT_METHOD_TOKENS[m]}`)
  return [
    `Pagos aceptados: ${labels.join(', ') || 'según configuración'}.`,
    'Primero preguntá cómo prefiere pagar; cuando elija, escribí SOLO el token de ese método (Betsy pone los datos; nunca los escribas vos)',
    tokens.length ? `: ${tokens.join(' · ')}.` : '.',
    ` ${PAYMENT_TOKEN} (todos los métodos) solo si el cliente pide explícitamente todos los datos de pago.`,
  ].join('')
}

export function formatBrandFactsForPrompt(facts: BrandFacts): string {
  const lines = [
    facts.storeName ? `Tienda: ${facts.storeName}` : '',
    facts.website ? `Sitio: ${facts.website}` : '',
    facts.catalogUrl ? `Catálogo: ${facts.catalogUrl}` : '',
    facts.hoursText ? `Horario: ${facts.hoursText}` : '',
    facts.location?.address ? `Dirección: ${facts.location.address}` : '',
    facts.location?.pickupInstructions ? `Retiro: ${facts.location.pickupInstructions}` : '',
    shippingSummary(facts),
    paymentFactsForPrompt(facts),
    facts.returnsText ? `Cambios: ${facts.returnsText}` : '',
    ...(facts.extraFacts || []).map((fact) => `${fact.label}: ${fact.value}`),
  ].filter(Boolean)
  return lines.join('\n').slice(0, 4800)
}

/**
 * Readability rule for EVERY agent message (Rafael 2026-10-16, code-owned): short WhatsApp messages, a blank line
 * between ideas (each block goes out as its own message, max 3), lists with dashes, never price + order data +
 * payment in one block.
 */
export const WHATSAPP_FORMAT_RULE =
  'Escribí como en WhatsApp: mensajes cortos. Separá ideas distintas con una línea en blanco (cada bloque se envía como un mensaje aparte, máximo 3). Cuando pidas datos o des opciones, usá una lista con guiones, un elemento por renglón. Nunca juntes precio, datos del pedido y pago en un solo bloque. No separes datos con « · » en una misma línea.'

export function replyStyleSnippet(style: ReplyStyle): string {
  return [
    WHATSAPP_FORMAT_RULE,
    `Cada mensaje: máximo ${style.maxLines} líneas (una lista cuenta como una).`,
    style.askOneQuestion ? 'Una sola pregunta al final cuando falte un dato.' : '',
    'No repitas el saludo. Español de Costa Rica, natural.',
    style.emojiLevel === 'none' ? 'Sin emojis.' : 'Emojis con moderación.',
  ]
    .filter(Boolean)
    .join(' ')
}

export function maskConfiguredPaymentSecrets(text: string, facts: BrandFacts): string {
  let out = text
  const sinpe = facts.payment?.sinpe?.number?.replace(/\s/g, '')
  if (sinpe && sinpe.length >= 4) {
    const masked = `SINPE ****${sinpe.slice(-4)}`
    // The grouped form code sends ("6201 9914") first, then the configured spellings.
    const grouped = formatSinpeNumber(facts.payment?.sinpe?.number || '')
    if (grouped && grouped.length >= 8) out = out.split(grouped).join(masked)
    const spaced = facts.payment?.sinpe?.number || sinpe
    out = out.split(spaced).join(masked)
    if (spaced !== sinpe) out = out.split(sinpe).join(masked)
  }
  const iban = facts.payment?.transfer?.iban
  if (iban && iban.length >= 8) {
    const masked = `${iban.slice(0, 4)}****${iban.slice(-4)}`
    const grouped = formatIban(iban)
    if (grouped !== iban) out = out.split(grouped).join(masked)
    out = out.split(iban).join(masked)
  }
  return out
}
