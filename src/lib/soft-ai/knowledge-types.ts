/**
 * Soft Agent Layer A2 — knowledge source contracts (client-safe; no Prisma).
 */

export const KNOWLEDGE_BODY_MAX = 12_000
export const KNOWLEDGE_NAME_MAX = 80
export const KNOWLEDGE_LAYER2_CHAR_BUDGET = 4_000
export const KNOWLEDGE_LAYER34_CHAR_BUDGET = 3_000

export const KNOWLEDGE_KINDS = [
  'brand_book',
  'policy',
  'faq',
  'channel_overlay',
] as const
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number]

export const KNOWLEDGE_STATUSES = ['draft', 'approved', 'archived'] as const
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number]

/** Wizard / checklist cards mapped to knowledge kinds. */
export const KNOWLEDGE_CHECKLIST_CARDS = [
  {
    id: 'precios',
    title: 'Precios',
    kind: 'policy' as const,
    nameHint: 'Precios',
    inventoryWins: true,
    hint: 'Notas de política de precios. El inventario en vivo manda sobre cualquier cifra del documento.',
  },
  {
    id: 'envios',
    title: 'Envíos',
    kind: 'policy' as const,
    nameHint: 'Envíos',
    inventoryWins: false,
    hint: 'Políticas y zonas de envío (texto aprobado).',
  },
  {
    id: 'ofertas',
    title: 'Ofertas',
    kind: 'faq' as const,
    nameHint: 'Ofertas',
    inventoryWins: true,
    hint: 'Promos y FAQ de ofertas. Precios citados deben venir de search_inventory.',
  },
  {
    id: 'politicas',
    title: 'Políticas',
    kind: 'policy' as const,
    nameHint: 'Políticas',
    inventoryWins: false,
    hint: 'Devoluciones, garantías y reglas de negocio.',
  },
] as const

export type KnowledgeSourceDto = {
  id: string
  tenantId: string
  socialAccountId: string | null
  kind: KnowledgeKind
  name: string
  body: string
  status: KnowledgeStatus
  version: number
  contentHash: string
  metadata: Record<string, unknown> | null
  approvedBy: string | null
  approvedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type KnowledgeVersionRef = {
  sourceId: string
  kind: KnowledgeKind
  name: string
  version: number
  contentHash: string
}

export type ApprovedKnowledgeSlice = {
  brandBook: KnowledgeSourceDto[]
  policies: KnowledgeSourceDto[]
  faqs: KnowledgeSourceDto[]
  channelOverlay: KnowledgeSourceDto[]
  versions: KnowledgeVersionRef[]
}

export function isKnowledgeKind(value: string): value is KnowledgeKind {
  return (KNOWLEDGE_KINDS as readonly string[]).includes(value)
}

export function isKnowledgeStatus(value: string): value is KnowledgeStatus {
  return (KNOWLEDGE_STATUSES as readonly string[]).includes(value)
}

/** Detect monetary figures for the Revisar step (CRC / $ / colones). */
export function findMonetaryFigures(body: string): string[] {
  const re = /[₡$]\s?\d[\d.,]*|\d[\d.,]*\s*(?:colones|crc|usd)/gi
  const found = body.match(re) || []
  return [...new Set(found.map((s) => s.trim()))]
}

export function reviewKnowledgeBody(body: string): {
  monetaryFigures: string[]
  inventoryWinsWarning: boolean
  charCount: number
  overLimit: boolean
} {
  const monetaryFigures = findMonetaryFigures(body)
  return {
    monetaryFigures,
    inventoryWinsWarning: monetaryFigures.length > 0,
    charCount: body.length,
    overLimit: body.length > KNOWLEDGE_BODY_MAX,
  }
}

/** Apply layer char budgets — trim FAQ first when over budget (plan §3.2). */
export function budgetKnowledgeSlice(slice: ApprovedKnowledgeSlice): ApprovedKnowledgeSlice {
  let layer2 = 0
  const brandBook: KnowledgeSourceDto[] = []
  const policies: KnowledgeSourceDto[] = []
  for (const s of [...slice.brandBook, ...slice.policies]) {
    if (layer2 + s.body.length > KNOWLEDGE_LAYER2_CHAR_BUDGET) continue
    layer2 += s.body.length
    if (s.kind === 'brand_book') brandBook.push(s)
    else policies.push(s)
  }

  let layer34 = 0
  const channelOverlay: KnowledgeSourceDto[] = []
  const faqs: KnowledgeSourceDto[] = []
  for (const s of slice.channelOverlay) {
    if (layer34 + s.body.length > KNOWLEDGE_LAYER34_CHAR_BUDGET) continue
    layer34 += s.body.length
    channelOverlay.push(s)
  }
  for (const s of slice.faqs) {
    if (layer34 + s.body.length > KNOWLEDGE_LAYER34_CHAR_BUDGET) continue
    layer34 += s.body.length
    faqs.push(s)
  }

  const keptIds = new Set(
    [...brandBook, ...policies, ...channelOverlay, ...faqs].map((s) => s.id),
  )
  return {
    brandBook,
    policies,
    faqs,
    channelOverlay,
    versions: slice.versions.filter((v) => keptIds.has(v.sourceId)),
  }
}
