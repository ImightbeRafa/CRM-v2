/**
 * Agent Profile draft extracted from a business's own sources (F3). Every fact carries where it came from
 * (sourceId + a literal snippet ≤200 chars) so the owner can check it, and facts whose snippet is not really in
 * the source are dropped (provenance.ts). Strict JSON Schema for the model; zod-free parsing below.
 */

const S = { type: ['string', 'null'] }
const SRC = { sourceId: S, snippet: S }

const fact = { type: 'object', additionalProperties: false, properties: { value: S, ...SRC }, required: ['value', 'sourceId', 'snippet'] }

export const PROFILE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brand: {
      type: 'object',
      additionalProperties: false,
      properties: { storeName: fact, website: fact, address: fact, hours: fact, pickupText: fact, whatWeSell: fact },
      required: ['storeName', 'website', 'address', 'hours', 'pickupText', 'whatWeSell'],
    },
    paymentAccounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { kind: { type: 'string', enum: ['sinpe', 'iban', 'other'] }, number: S, holderName: S, bank: S, ...SRC },
        required: ['kind', 'number', 'holderName', 'bank', 'sourceId', 'snippet'],
      },
    },
    shipping: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          methodName: S,
          priceText: S,
          etaText: S,
          coverageText: S,
          contraEntrega: { type: ['boolean', 'null'] },
          ...SRC,
        },
        required: ['methodName', 'priceText', 'etaText', 'coverageText', 'contraEntrega', 'sourceId', 'snippet'],
      },
    },
    policies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: S, text: S, ...SRC },
        required: ['title', 'text', 'sourceId', 'snippet'],
      },
    },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { question: S, answer: S, ...SRC },
        required: ['question', 'answer', 'sourceId', 'snippet'],
      },
    },
    voice: {
      type: 'object',
      additionalProperties: false,
      properties: { description: S, examples: { type: 'array', items: { type: 'string' } } },
      required: ['description', 'examples'],
    },
    howISell: {
      type: 'object',
      additionalProperties: false,
      properties: { closing: S, upsells: S, objections: S, handoffWhen: S },
      required: ['closing', 'upsells', 'objections', 'handoffWhen'],
    },
    mustSay: { type: 'array', items: { type: 'string' } },
    neverSay: { type: 'array', items: { type: 'string' } },
    quickReplies: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { title: S, body: S }, required: ['title', 'body'] },
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { nameAsSeen: S, variantText: S, groupText: S, priceSeen: { type: ['number', 'null'] }, ...SRC },
        required: ['nameAsSeen', 'variantText', 'groupText', 'priceSeen', 'sourceId', 'snippet'],
      },
    },
  },
  required: ['brand', 'paymentAccounts', 'shipping', 'policies', 'faq', 'voice', 'howISell', 'mustSay', 'neverSay', 'quickReplies', 'products'],
} as const

export type Fact = { value: string | null; sourceId: string | null; snippet: string | null }
export type ExtractedProfile = {
  brand: { storeName: Fact; website: Fact; address: Fact; hours: Fact; pickupText: Fact; whatWeSell: Fact }
  paymentAccounts: Array<{ kind: 'sinpe' | 'iban' | 'other'; number: string | null; holderName: string | null; bank: string | null; sourceId: string | null; snippet: string | null; confirm?: boolean }>
  shipping: Array<{ methodName: string | null; priceText: string | null; etaText: string | null; coverageText: string | null; contraEntrega: boolean | null; sourceId: string | null; snippet: string | null }>
  policies: Array<{ title: string | null; text: string | null; sourceId: string | null; snippet: string | null }>
  faq: Array<{ question: string | null; answer: string | null; sourceId: string | null; snippet: string | null }>
  voice: { description: string | null; examples: string[] }
  howISell: { closing: string | null; upsells: string | null; objections: string | null; handoffWhen: string | null }
  mustSay: string[]
  neverSay: string[]
  quickReplies: Array<{ title: string | null; body: string | null }>
  products: Array<{ nameAsSeen: string | null; variantText: string | null; groupText: string | null; priceSeen: number | null; sourceId: string | null; snippet: string | null }>
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function parseFact(v: unknown, max = 600): Fact {
  const r = rec(v)
  return { value: str(r.value, max), sourceId: str(r.sourceId, 64), snippet: str(r.snippet, 200) }
}

/** Defensive parse of the model's JSON (bounded sizes; unknown fields dropped). */
export function parseExtractedProfile(raw: unknown): ExtractedProfile {
  const r = rec(raw)
  const b = rec(r.brand)
  const v = rec(r.voice)
  const h = rec(r.howISell)
  return {
    brand: {
      storeName: parseFact(b.storeName, 60),
      website: parseFact(b.website, 300),
      address: parseFact(b.address, 300),
      hours: parseFact(b.hours, 300),
      pickupText: parseFact(b.pickupText, 300),
      whatWeSell: parseFact(b.whatWeSell, 600),
    },
    paymentAccounts: arr(r.paymentAccounts, 6).map((x) => {
      const p = rec(x)
      const kind = p.kind === 'sinpe' || p.kind === 'iban' ? p.kind : 'other'
      return { kind, number: str(p.number, 40), holderName: str(p.holderName, 80), bank: str(p.bank, 60), sourceId: str(p.sourceId, 64), snippet: str(p.snippet, 200) }
    }),
    shipping: arr(r.shipping, 10).map((x) => {
      const p = rec(x)
      return {
        methodName: str(p.methodName, 80),
        priceText: str(p.priceText, 200),
        etaText: str(p.etaText, 200),
        coverageText: str(p.coverageText, 400),
        contraEntrega: typeof p.contraEntrega === 'boolean' ? p.contraEntrega : null,
        sourceId: str(p.sourceId, 64),
        snippet: str(p.snippet, 200),
      }
    }),
    policies: arr(r.policies, 12).map((x) => {
      const p = rec(x)
      return { title: str(p.title, 80), text: str(p.text, 3000), sourceId: str(p.sourceId, 64), snippet: str(p.snippet, 200) }
    }),
    faq: arr(r.faq, 40).map((x) => {
      const p = rec(x)
      return { question: str(p.question, 300), answer: str(p.answer, 1200), sourceId: str(p.sourceId, 64), snippet: str(p.snippet, 200) }
    }),
    voice: { description: str(v.description, 600), examples: arr(v.examples, 6).map((e) => str(e, 300)).filter((e): e is string => Boolean(e)) },
    howISell: { closing: str(h.closing, 800), upsells: str(h.upsells, 800), objections: str(h.objections, 1200), handoffWhen: str(h.handoffWhen, 800) },
    mustSay: arr(r.mustSay, 12).map((e) => str(e, 200)).filter((e): e is string => Boolean(e)),
    neverSay: arr(r.neverSay, 12).map((e) => str(e, 200)).filter((e): e is string => Boolean(e)),
    quickReplies: arr(r.quickReplies, 20).map((x) => {
      const p = rec(x)
      return { title: str(p.title, 60), body: str(p.body, 1000) }
    }),
    products: arr(r.products, 200).map((x) => {
      const p = rec(x)
      const price = typeof p.priceSeen === 'number' && Number.isFinite(p.priceSeen) && p.priceSeen > 0 ? p.priceSeen : null
      return { nameAsSeen: str(p.nameAsSeen, 160), variantText: str(p.variantText, 120), groupText: str(p.groupText, 120), priceSeen: price, sourceId: str(p.sourceId, 64), snippet: str(p.snippet, 200) }
    }),
  }
}
