/** Client-side shapes of the Agent Studio API (mirror of src/lib/agent-studio; no server imports). */

export type StudioSource = {
  id: string
  kind: 'text' | 'url' | 'file' | 'image' | 'instagram' | 'wa_export'
  status: 'pending' | 'fetching' | 'parsed' | 'failed' | 'removed'
  label: string
  url: string | null
  pageCount: number | null
  textChars: number
  meta: Record<string, unknown>
  errorCode: string | null
  createdAt: string
}

export type Fact = { value: string | null; sourceId: string | null; snippet: string | null }
export type Cited = { sourceId: string | null; snippet: string | null }

export type Extracted = {
  brand: { storeName: Fact; website: Fact; address: Fact; hours: Fact; pickupText: Fact; whatWeSell: Fact }
  paymentAccounts: Array<Cited & { kind: 'sinpe' | 'iban' | 'other'; number: string | null; holderName: string | null; bank: string | null; confirm?: boolean }>
  shipping: Array<Cited & { methodName: string | null; priceText: string | null; etaText: string | null; coverageText: string | null; contraEntrega: boolean | null }>
  policies: Array<Cited & { title: string | null; text: string | null }>
  faq: Array<Cited & { question: string | null; answer: string | null }>
  voice: { description: string | null; examples: string[] }
  howISell: { closing: string | null; upsells: string | null; objections: string | null; handoffWhen: string | null }
  mustSay: string[]
  neverSay: string[]
  quickReplies: Array<{ title: string | null; body: string | null }>
  products: Array<Cited & { nameAsSeen: string | null; variantText: string | null; groupText: string | null; priceSeen: number | null }>
}

export type ProductMatch = {
  index: number
  itemId: string | null
  itemName: string | null
  category: string | null
  score: number
  priceSeen: number | null
  priceInInventory: number | null
  priceDiffers: boolean
  group?: { category: string; itemIds: string[] } | null
}

export type Draft = {
  id: string
  status: 'queued' | 'extracting' | 'ready' | 'applying' | 'applied' | 'failed' | 'cost_capped' | 'canceled'
  profile: {
    extracted: Extracted
    matches: ProductMatch[]
    sources: Array<{ id: string; label: string; kind: string }>
    dropped: { facts: number; products: number }
  } | null
  applied: Record<string, unknown>
  errorCode: string | null
  createdAt: string
}

export type InventoryOption = { id: string; name: string; sku: string | null; category: string | null; sellingPrice: number; currentStock: number }
