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
    'brand.payment.summary': paymentSummary(facts),
    'brand.payment.sinpe.number': facts.payment?.sinpe?.number || '',
    'brand.payment.sinpe.holderName': facts.payment?.sinpe?.holderName || '',
    'brand.returnsText': facts.returnsText || '',
  }
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
    facts.payment?.shareWithCustomers
      ? `Pagos que se pueden explicar: ${paymentSummary(facts)}`
      : 'Pagos: no compartir datos de pago con el cliente; escalar.',
    facts.returnsText ? `Cambios: ${facts.returnsText}` : '',
    ...(facts.extraFacts || []).map((fact) => `${fact.label}: ${fact.value}`),
  ].filter(Boolean)
  return lines.join('\n').slice(0, 4800)
}

export function replyStyleSnippet(style: ReplyStyle): string {
  return [
    `Estilo: máximo ${style.maxLines} líneas, salvo el resumen de compra.`,
    style.askOneQuestion ? 'Una sola pregunta al final cuando falte un dato.' : '',
    'Sin listas largas. No repitas el saludo. Español de Costa Rica, natural.',
    style.emojiLevel === 'none' ? 'Sin emojis.' : 'Emojis con moderación.',
  ]
    .filter(Boolean)
    .join(' ')
}

export function maskConfiguredPaymentSecrets(text: string, facts: BrandFacts): string {
  let out = text
  const sinpe = facts.payment?.sinpe?.number?.replace(/\s/g, '')
  if (sinpe && sinpe.length >= 4) {
    const spaced = facts.payment?.sinpe?.number || sinpe
    out = out.split(spaced).join(`SINPE ****${sinpe.slice(-4)}`)
    if (spaced !== sinpe) out = out.split(sinpe).join(`SINPE ****${sinpe.slice(-4)}`)
  }
  const iban = facts.payment?.transfer?.iban
  if (iban && iban.length >= 8) {
    out = out.split(iban).join(`${iban.slice(0, 4)}****${iban.slice(-4)}`)
  }
  return out
}
