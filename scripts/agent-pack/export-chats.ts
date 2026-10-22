/**
 * READ-ONLY export of real chats on some lines, scrubbed (Ley 8968), for studying how the team sells.
 * Every message says who sent it (customer / teammate / agent), plus the orders linked to the chat
 * (ChatMessage.orderId, and orders of the chat's client created in the window).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/export-chats.ts --accounts=<id,id> --since=2026-10-21 --until=2026-10-22 \
 *     [--out=D:/Coder/betsy-agent-packs/forge/results] [--context-days=7]
 *
 * --since / --until are Costa Rica calendar days (inclusive) or ISO timestamps. A chat is exported when it has a
 * message in the window; messages up to --context-days before the window come along as context (marked).
 * Only findMany/count reads: this script never writes to the DB. Output stays out of git: the default folder
 * (test-results/chat-exports/) is gitignored; never commit an export.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prisma } from '@/lib/db'
import { arg } from './pack'
import { nameWords, scrubChatText } from './chat-scrub'

const CR_OFFSET_MS = 6 * 3_600_000

/** "2026-10-21" → that day's start in Costa Rica (UTC-6). ISO timestamps pass through. */
export function crDayStart(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(Date.parse(`${value}T00:00:00Z`) + CR_OFFSET_MS)
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${value}`)
  return d
}

/** Inclusive end: "2026-10-22" → the first instant of 2026-10-23 in Costa Rica. */
export function crDayEnd(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(crDayStart(value).getTime() + 24 * 3_600_000)
  return crDayStart(value)
}

export const crTime = (d: Date) => new Date(d.getTime() - CR_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')

export type Sender = 'customer' | 'teammate' | 'agent' | 'automation'

/** Who sent a message. Agent sends carry metadata.softAi; teammates carry a sender (Betsy inbox) or are app echoes. */
export function senderOf(direction: string, metadata: unknown, senderUserId: string | null): Sender {
  if (direction === 'inbound') return 'customer'
  const m = (metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}) as Record<string, unknown>
  if (m.softAi === true) return 'agent'
  if (senderUserId || m.senderUserId || m.senderName || m.isEcho === true) return 'teammate'
  return 'automation'
}

async function main() {
  const accounts = (arg('accounts') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const since = arg('since')
  const until = arg('until') || since
  if (!accounts.length || !since || !until) throw new Error('Uso: --accounts=<id,id> --since=YYYY-MM-DD [--until=YYYY-MM-DD] [--out=dir]')
  const from = crDayStart(since)
  const to = crDayEnd(until)
  const contextFrom = new Date(from.getTime() - Number(arg('context-days') || 7) * 86_400_000)
  const outDir = resolve(arg('out') || join(process.cwd(), 'test-results', 'chat-exports'))

  const lines = await prisma.socialAccount.findMany({
    where: { id: { in: accounts } },
    select: { id: true, tenantId: true, platform: true, displayName: true },
  })
  if (lines.length !== accounts.length) throw new Error('Alguna línea no existe.')
  const tenants = new Set(lines.map((l) => l.tenantId))
  if (tenants.size !== 1) throw new Error('Las líneas deben ser del mismo negocio.')
  const tenantId = lines[0].tenantId
  const lineName = new Map(lines.map((l) => [l.id, `${l.platform} · ${l.displayName ?? l.id}`]))

  const touched = await prisma.chatMessage.findMany({
    where: { tenantId, socialAccountId: { in: accounts }, sentAt: { gte: from, lt: to }, conversationId: { not: null } },
    select: { conversationId: true },
    distinct: ['conversationId'],
  })
  const convIds = touched.map((t) => t.conversationId!).filter(Boolean)
  const convs = await prisma.chatConversation.findMany({
    where: { tenantId, id: { in: convIds } },
    select: { id: true, socialAccountId: true, peerName: true, peerUsername: true, clientId: true, status: true, tags: true },
  })

  // Teammates become "Equipo 1", "Equipo 2" (staff names are not needed to learn from the replies).
  const teammateAlias = new Map<string, string>()
  const alias = (key: string) => {
    if (!teammateAlias.has(key)) teammateAlias.set(key, `Equipo ${teammateAlias.size + 1}`)
    return teammateAlias.get(key)!
  }

  const out = []
  for (const c of convs) {
    const msgs = await prisma.chatMessage.findMany({
      where: { tenantId, conversationId: c.id, sentAt: { gte: contextFrom, lt: to } },
      orderBy: { sentAt: 'asc' },
      select: { direction: true, content: true, metadata: true, senderUserId: true, messageType: true, sentAt: true, orderId: true, mediaMimeType: true },
      take: 600,
    })
    const orderIds = new Set(msgs.map((m) => m.orderId).filter((x): x is string => !!x))
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { id: { in: [...orderIds] } },
          ...(c.clientId ? [{ clientId: c.clientId, timestamp: { gte: contextFrom, lt: new Date(to.getTime() + 2 * 86_400_000) } }] : []),
        ],
      },
      select: {
        id: true, orderType: true, status: true, timestamp: true, customerName: true, product: true, quantity: true, size: true,
        productDetails: true, total: true, shippingCost: true, delivery: true, courier: true, province: true, funnel: true,
        salesChannel: true, contraEntrega: true, cePaymentConfirmed: true, customFields: true, comments: true,
      },
    })
    const names = nameWords(c.peerName, c.peerUsername, ...orders.map((o) => o.customerName))
    const scrub = (t: string) => scrubChatText(t, { names })
    const messages = msgs.map((m) => {
      const who = senderOf(m.direction, m.metadata, m.senderUserId)
      const meta = (m.metadata ?? {}) as Record<string, unknown>
      const type = m.messageType || 'text'
      const body = scrub(m.content || '')
      return {
        at: crTime(m.sentAt),
        context: m.sentAt < from,
        who: who === 'teammate' ? alias(String(m.senderUserId || meta.senderUserId || meta.senderName || (meta.isEcho ? 'app' : '?'))) : who,
        sender: who,
        fromPhoneApp: meta.isEcho === true || undefined,
        type,
        text: type === 'text' ? body : `[${type}${m.mediaMimeType ? ` ${m.mediaMimeType}` : ''}]${body ? ` ${body}` : ''}`,
        orderLinked: !!m.orderId || undefined,
      }
    })
    out.push({
      chat: `chat-${out.length + 1}`,
      line: lineName.get(c.socialAccountId),
      status: c.status,
      tags: c.tags,
      counts: {
        customer: messages.filter((m) => m.sender === 'customer').length,
        teammate: messages.filter((m) => m.sender === 'teammate').length,
        agent: messages.filter((m) => m.sender === 'agent').length,
      },
      messages,
      orders: orders.map((o) => {
        const cf = (o.customFields ?? {}) as Record<string, unknown>
        const payment = Object.fromEntries(Object.entries(cf).filter(([k]) => /pago|pay|metodo|método|sinpe/i.test(k)))
        return {
          type: o.orderType,
          status: o.status,
          at: crTime(o.timestamp),
          product: o.product ? scrub(o.product) : null,
          quantity: o.quantity,
          size: o.size,
          details: o.productDetails ? scrub(o.productDetails).slice(0, 300) : null,
          total: o.total,
          shippingCost: o.shippingCost,
          delivery: o.delivery,
          courier: o.courier,
          province: o.province,
          funnel: o.funnel,
          salesChannel: o.salesChannel,
          cashOnDelivery: o.contraEntrega,
          cashConfirmed: o.cePaymentConfirmed,
          payment,
          comments: o.comments ? scrub(o.comments).slice(0, 300) : null,
          linkedBy: orderIds.has(o.id) ? 'message' : 'client',
        }
      }),
    })
  }
  out.sort((a, b) => (a.messages[0]?.at ?? '').localeCompare(b.messages[0]?.at ?? ''))
  out.forEach((c, i) => (c.chat = `chat-${i + 1}`))

  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `chats-${since}${until !== since ? `_${until}` : ''}.json`)
  writeFileSync(
    file,
    JSON.stringify({ exportedAt: new Date().toISOString(), window: { since, until, from: from.toISOString(), to: to.toISOString() }, lines: [...lineName.values()], chats: out }, null, 2),
  )
  const totals = out.reduce((s, c) => ({ msgs: s.msgs + c.messages.length, orders: s.orders + c.orders.length }), { msgs: 0, orders: 0 })
  console.log(`${out.length} chats, ${totals.msgs} mensajes, ${totals.orders} pedidos → ${file}`)
}

if (process.argv[1]?.endsWith('export-chats.ts')) {
  main()
    .catch((e) => {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
