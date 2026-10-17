/**
 * "Crear pedido" from a chat (Rafael 2026-10-17): the order form opens already filled from what the customer wrote —
 * name, phone, email, address, delivery / pickup, contra entrega and the products they asked for. A person reviews and
 * submits; nothing is created on its own. Pure helpers (no I/O) so live and tests share them.
 */

export type PrefillProduct = { id: string; name: string; type: string; baseCost: number; cantidad: number }

export type OrderPrefillChoices = {
  orderType: 'EA' | 'RA' | null
  paymentChoice: 'contra_entrega' | null
}

const PLACEHOLDER_RE = /^\s*\[[a-z_ ]+\]\s*$/i
/** Words that never identify a product on their own ("GLP-1 Patch" → key "glp1"). */
const GENERIC_WORDS = new Set(['patch', 'parche', 'parches', 'de', 'del', 'la', 'el', 'los', 'las', 'paquete', 'kit', 'combo', 'y', 'con'])
const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Customer text worth reading: their own messages, without "[image]" / "[ig_post]" placeholders. */
export function customerTextsForPrefill(messages: Array<{ direction: string; content?: string | null }>): string[] {
  return messages
    .filter((m) => m.direction === 'inbound')
    .map((m) => String(m.content || '').trim())
    .filter((t) => t && !PLACEHOLDER_RE.test(t))
}

/** The product's identifying key: its name without generic words, letters and digits only ("GLP-1 Patch" → "glp1"). */
export function productKey(name: string): string {
  const words = fold(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC_WORDS.has(w))
  return words.join('')
}

/**
 * Products the CUSTOMER named (the store's own catalog list is never read, so "- Focus - Energy …" does not add all five).
 * Quantity from "2 de GLP", "dos GLP-1", "GLP x2"; otherwise 1. A key shorter than 3 characters never matches alone.
 */
export function matchPrefillProducts(
  items: Array<{ id: string; name: string; category: string; sellingPrice: number }>,
  customerTexts: string[],
): PrefillProduct[] {
  const joined = customerTexts.map(fold).join(' \n ')
  const squashed = joined.replace(/[^a-z0-9\n]+/g, '')
  const out: PrefillProduct[] = []
  for (const item of items) {
    const key = productKey(item.name)
    if (key.length < 3 || !squashed.includes(key)) continue
    out.push({ id: item.id, name: item.name, type: item.name.trim(), baseCost: Number(item.sellingPrice) || 0, cantidad: quantityFor(joined, key) })
  }
  return out
}

function quantityFor(foldedText: string, key: string): number {
  // Find the product mention with separators kept, then look right before / after it.
  const loose = key.split('').join('[^a-z0-9\\n]{0,2}')
  const before = new RegExp(`(\\d+|${Object.keys(NUMBER_WORDS).join('|')})\\s*(?:x\\s*)?(?:paquetes?\\s+|unidades?\\s+)?(?:de\\s+(?:el\\s+|la\\s+)?)?${loose}`, 'i')
  const after = new RegExp(`${loose}[^a-z0-9\\n]*(?:x\\s*(\\d+)|por\\s+(\\d+))`, 'i')
  const b = foldedText.match(before)
  const a = foldedText.match(after)
  const raw = b?.[1] ?? a?.[1] ?? a?.[2]
  if (!raw) return 1
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? 1
  return n >= 1 && n <= 20 ? n : 1
}

/** Pickup vs delivery and contra entrega, from what the customer chose (latest mention wins). */
export function detectOrderChoices(customerTexts: string[]): OrderPrefillChoices {
  let orderType: OrderPrefillChoices['orderType'] = null
  let paymentChoice: OrderPrefillChoices['paymentChoice'] = null
  for (const raw of customerTexts) {
    const t = fold(raw)
    if (/\bretiro\b|\bretirar(lo|la)?\b|\brecoger(lo|la)?\b|\bpaso\s+a\s+(recoger|retirar)/.test(t)) orderType = 'RA'
    if (/\benvio\b|\ba\s+domicilio\b|\bme\s+lo\s+(envian|mandan)\b|\bcontra\s*entrega\b/.test(t)) orderType = 'EA'
    if (/\bcontra\s*entrega\b|\bpago\s+al\s+(recibir|mensajero)\b/.test(t)) paymentChoice = 'contra_entrega'
  }
  return { orderType, paymentChoice }
}
