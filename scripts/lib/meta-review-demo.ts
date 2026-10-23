/**
 * Demo data for the Meta App Review screencast (pure: builds rows, writes nothing). Used by
 * scripts/meta-review-demo-seed.ts. Every row is clearly marked demo:
 *  - ids start with `demo_<tenant>_`, products / clients / chats are named "[DEMO] …", orders are "DEMO-…";
 *  - customer phones use the unassignable +506 0000 range, so they can never reach a real person;
 *  - demo chats hang on the business's real connected test line, with made-up customer ids `demo-…` that the send
 *    routes refuse (src/lib/demo-chat.ts), so nothing is ever sent to Meta for them;
 *  - demo ad referrals carry NO click id, and Instagram demo peers are not numeric, so the ad sales sweep never
 *    turns them into events (only real ad chats do).
 */
import { DEMO_PEER_PREFIX } from '../../src/lib/demo-chat'

export type DemoLine = { id: string; platform: 'whatsapp' | 'instagram' }

export const DEMO_NAME_PREFIX = '[DEMO]'
export const DEMO_ORDER_PREFIX = 'DEMO-'

/** Every demo row id of a business starts with this (full tenant id: no collision across businesses). */
export function demoIdPrefix(tenantId: string): string {
  return `demo_${tenantId}_`
}

export function demoId(tenantId: string, kind: string, n: number): string {
  return `${demoIdPrefix(tenantId)}${kind}_${n}`
}

const PRODUCTS = [
  { name: 'Almohada viscoelástica', category: 'Almohadas', price: 18_500, cost: 9_000 },
  { name: 'Protector de colchón impermeable', category: 'Protectores', price: 24_900, cost: 12_000 },
  { name: 'Juego de sábanas Queen', category: 'Sábanas', price: 32_000, cost: 15_500 },
  { name: 'Antifaz de seda', category: 'Accesorios', price: 7_500, cost: 2_800 },
]

const CUSTOMERS = [
  { name: 'María Rojas', phone: '+50600000001', province: 'San José', canton: 'Montes de Oca', district: 'San Pedro' },
  { name: 'José Vargas', phone: '+50600000002', province: 'Heredia', canton: 'Heredia', district: 'Mercedes' },
  { name: 'Ana Solís', phone: '+50600000003', province: 'Alajuela', canton: 'Alajuela', district: 'San José' },
]

type Msg = { direction: 'inbound' | 'outbound'; content: string; minutesAgo: number }

const SCRIPTS: Array<{ title: string; fromAd: boolean; messages: Msg[] }> = [
  {
    title: 'Consulta por anuncio',
    fromAd: true,
    messages: [
      { direction: 'inbound', content: 'Hola, vi el anuncio de la almohada. ¿Todavía la tienen?', minutesAgo: 95 },
      { direction: 'outbound', content: '¡Hola! Sí, la almohada viscoelástica está a ₡18 500. ¿Te la enviamos o pasás a retirarla?', minutesAgo: 92 },
      { direction: 'inbound', content: 'Paso a retirarla, ¿cómo pago?', minutesAgo: 90 },
      { direction: 'outbound', content: 'Podés pagar por SINPE Móvil y nos mandás el comprobante.', minutesAgo: 88 },
    ],
  },
  {
    title: 'Pregunta de envío',
    fromAd: false,
    messages: [
      { direction: 'inbound', content: 'Buenas, ¿hacen envíos a Heredia?', minutesAgo: 240 },
      { direction: 'outbound', content: '¡Claro! El envío a Heredia tarda 2 a 3 días hábiles.', minutesAgo: 235 },
    ],
  },
]

export type DemoPlan = {
  inventory: Array<{ id: string; name: string; category: string; sku: string; unitCost: number; sellingPrice: number }>
  clients: Array<{ id: string; name: string; phone: string; province: string; canton: string; district: string }>
  orders: Array<{ id: string; orderId: string; clientIndex: number; product: string; total: number; paid: boolean }>
  chats: Array<{
    id: string
    lineId: string
    platform: DemoLine['platform']
    peerId: string
    peerName: string
    fromAd: boolean
    messages: Array<Msg & { id: string; providerMessageId: string }>
  }>
}

export function buildDemoPlan(tenantId: string, lines: DemoLine[]): DemoPlan {
  const inventory = PRODUCTS.map((p, i) => ({
    id: demoId(tenantId, 'item', i + 1),
    name: `${DEMO_NAME_PREFIX} ${p.name}`,
    category: p.category,
    sku: `DEMO-SKU-${i + 1}`,
    unitCost: p.cost,
    sellingPrice: p.price,
  }))
  const clients = CUSTOMERS.map((c, i) => ({ id: demoId(tenantId, 'client', i + 1), ...c, name: `${DEMO_NAME_PREFIX} ${c.name}` }))
  const orders = [
    { clientIndex: 0, product: PRODUCTS[0]!.name, total: PRODUCTS[0]!.price, paid: true },
    { clientIndex: 1, product: PRODUCTS[2]!.name, total: PRODUCTS[2]!.price, paid: false },
    { clientIndex: 2, product: PRODUCTS[1]!.name, total: PRODUCTS[1]!.price, paid: true },
  ].map((o, i) => ({ ...o, id: demoId(tenantId, 'order', i + 1), orderId: `${DEMO_ORDER_PREFIX}${1001 + i}` }))
  let n = 0
  const chats: DemoPlan['chats'] = []
  for (const line of lines) {
    SCRIPTS.forEach((s, i) => {
      n += 1
      const id = demoId(tenantId, 'chat', n)
      chats.push({
        id,
        lineId: line.id,
        platform: line.platform,
        peerId: `${DEMO_PEER_PREFIX}${tenantId.slice(-6)}-${n}`,
        peerName: `${DEMO_NAME_PREFIX} ${CUSTOMERS[i % CUSTOMERS.length]!.name}`,
        fromAd: s.fromAd,
        messages: s.messages.map((m, k) => ({ ...m, id: `${id}_m${k + 1}`, providerMessageId: `demo.${id}.${k + 1}` })),
      })
    })
  }
  return { inventory, clients, orders, chats }
}

/** A business with this many real (non-demo) orders is not a test business: the seed refuses it. */
export const MAX_REAL_ORDERS_FOR_DEMO = 20

/** Only a business whose name says it is a test one may receive demo rows ("Meta Review Test", "Prueba …"). */
export function looksLikeTestBusiness(name: string | null | undefined): boolean {
  return /\b(test|prueba|demo|review)\b/i.test(String(name || ''))
}
