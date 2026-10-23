/**
 * Meta App Review kit: fill a TEST business (one Rafael created himself in Betsy; this never creates accounts)
 * with demo products, customers, orders and a few demo chats, so the screencast has a realistic inbox.
 * Everything is marked "[DEMO]" / "DEMO-…" and can be removed with --cleanup. Rows: scripts/lib/meta-review-demo.ts.
 *
 * Dry run (default, prints the plan and the tenant id / name / owner to confirm with, writes nothing):
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/meta-review-demo-seed.ts --tenant=<slug>
 * Write / remove (the database is the shared production one: Rafael runs these):
 *   META_DEMO_CONFIRM_TENANT=<tenant id> node … scripts/meta-review-demo-seed.ts --tenant=<slug> --apply
 *   META_DEMO_CONFIRM_TENANT=<tenant id> node … scripts/meta-review-demo-seed.ts --tenant=<slug> --cleanup
 *
 * Refuses: a missing tenant; a confirm value that is not that tenant's id; a business whose name does not say it is
 * a test ("Meta Review Test", "Prueba …"); more than 20 real orders (archived ones count); no connected WhatsApp /
 * Instagram line (demo chats hang on the real test line); any demo id that already belongs to another business.
 * No lm_* writes, no schema change, every write and delete is scoped to the tenant. Idempotent (deterministic ids,
 * upserts). Cleanup removes every demo_<tenant>_ row in one transaction, whatever lines are connected then.
 */
import { prisma } from '../src/lib/db'
import { DEMO_PEER_PREFIX } from '../src/lib/demo-chat'
import {
  DEMO_ORDER_PREFIX,
  MAX_REAL_ORDERS_FOR_DEMO,
  buildDemoPlan,
  demoIdPrefix,
  looksLikeTestBusiness,
  type DemoLine,
  type DemoPlan,
} from './lib/meta-review-demo'

const CREATED_BY = 'meta-review-demo'

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3).trim() : null
}

/** A demo id already used by ANOTHER business stops everything: a row must never move between businesses. */
function ensureOwn(kind: string, row: { tenantId: string } | null, tenantId: string) {
  if (row && row.tenantId !== tenantId) throw new Error(`Refused: a demo ${kind} id already belongs to another business.`)
}

async function checkIds(tenantId: string, plan: DemoPlan) {
  const sel = { select: { tenantId: true } } as const
  for (const i of plan.inventory) ensureOwn('product', await prisma.inventoryItem.findUnique({ where: { id: i.id }, ...sel }), tenantId)
  for (const c of plan.clients) ensureOwn('customer', await prisma.client.findUnique({ where: { id: c.id }, ...sel }), tenantId)
  for (const o of plan.orders) ensureOwn('order', await prisma.order.findUnique({ where: { id: o.id }, ...sel }), tenantId)
  for (const c of plan.chats) {
    ensureOwn('chat', await prisma.chatConversation.findUnique({ where: { id: c.id }, ...sel }), tenantId)
    for (const m of c.messages) ensureOwn('message', await prisma.chatMessage.findUnique({ where: { id: m.id }, ...sel }), tenantId)
  }
}

async function apply(tenantId: string, plan: DemoPlan) {
  await checkIds(tenantId, plan)
  const now = Date.now()
  const at = (m: { minutesAgo: number }) => new Date(now - m.minutesAgo * 60_000)
  for (const item of plan.inventory) {
    await prisma.inventoryItem.upsert({
      where: { id: item.id },
      create: { ...item, tenantId, createdBy: CREATED_BY },
      update: { name: item.name, sellingPrice: item.sellingPrice, unitCost: item.unitCost },
    })
  }
  for (const c of plan.clients) {
    await prisma.client.upsert({
      where: { id: c.id },
      create: { ...c, tenantId, firstOrder: new Date(now), lastOrder: new Date(now), createdBy: CREATED_BY },
      update: { name: c.name, phone: c.phone },
    })
  }
  for (const o of plan.orders) {
    const client = plan.clients[o.clientIndex]!
    const data = {
      orderType: 'RA',
      customerName: client.name,
      phone: client.phone,
      product: o.product,
      total: o.total,
      clientId: client.id,
      customFields: { paymentStatus: o.paid ? 'pagado' : 'pendiente_pago', demo: true },
    }
    await prisma.order.upsert({ where: { id: o.id }, create: { id: o.id, tenantId, orderId: o.orderId, ...data }, update: data })
  }
  for (const chat of plan.chats) {
    const msgs = chat.messages
    const last = msgs[msgs.length - 1]!
    const lastInbound = [...msgs].reverse().find((m) => m.direction === 'inbound')
    const lastOutbound = [...msgs].reverse().find((m) => m.direction === 'outbound')
    const convo = {
      peerName: chat.peerName,
      lastMessageAt: at(last),
      lastMessagePreview: last.content.slice(0, 140),
      lastMessageDirection: last.direction,
      lastInboundAt: lastInbound ? at(lastInbound) : null,
      // Demo chats end with the business's reply: never counted as "waiting for a reply".
      lastOutboundAt: lastOutbound ? at(lastOutbound) : null,
    }
    await prisma.chatConversation.upsert({
      where: { id: chat.id },
      create: { id: chat.id, tenantId, socialAccountId: chat.lineId, peerId: chat.peerId, ...convo },
      update: convo,
    })
    for (const m of msgs) {
      const row = {
        direction: m.direction,
        content: m.content,
        sentAt: at(m),
        receivedAt: m.direction === 'inbound' ? at(m) : null,
        providerMessageId: m.providerMessageId,
        messageType: 'text',
        metadata: { demo: true },
      }
      await prisma.chatMessage.upsert({
        where: { id: m.id },
        create: { id: m.id, tenantId, socialAccountId: chat.lineId, conversationId: chat.id, ...row },
        update: row,
      })
    }
    if (chat.fromAd) {
      const first = msgs[0]!
      // No click id on purpose: a demo chat is never reported to Meta (only real ad chats are).
      await prisma.chatAdReferral.upsert({
        where: { id: `${chat.id}_ref` },
        create: {
          id: `${chat.id}_ref`,
          tenantId,
          socialAccountId: chat.lineId,
          conversationId: chat.id,
          messageId: first.id,
          platform: chat.platform,
          dedupeKey: `demo:${chat.id}`,
          sourceType: 'ad',
          sourceId: '000000000000000',
          headline: '[DEMO] Almohada viscoelástica · envío gratis',
          body: 'Anuncio de demostración',
          ctwaClid: null,
          occurredAt: at(first),
        },
        update: {},
      })
    }
  }
  // The paid demo order shows as "Pedido" in the first ad chat.
  const firstAdChat = plan.chats.find((c) => c.fromAd)
  if (firstAdChat) {
    await prisma.chatMessage.updateMany({
      where: { tenantId, id: firstAdChat.messages[firstAdChat.messages.length - 1]!.id },
      data: { orderId: plan.orders[0]!.id },
    })
  }
}

/** Every demo row of this business, whatever lines are connected now; one transaction. */
async function cleanup(tenantId: string) {
  const prefix = demoIdPrefix(tenantId)
  const like = `${prefix}%`
  const out = await prisma.$transaction(
    async (tx) => {
      const chats = await tx.chatConversation.findMany({
        where: { tenantId, id: { startsWith: `${prefix}chat_` }, peerId: { startsWith: DEMO_PEER_PREFIX } },
        select: { id: true },
      })
      const chatIds = chats.map((c) => c.id)
      return {
        referrals: (await tx.chatAdReferral.deleteMany({ where: { tenantId, conversationId: { in: chatIds } } })).count,
        messages: (await tx.chatMessage.deleteMany({ where: { tenantId, conversationId: { in: chatIds } } })).count,
        chats: (await tx.chatConversation.deleteMany({ where: { tenantId, id: { in: chatIds } } })).count,
        // Raw: the app's client hides archived orders, and archived demo orders must go too.
        orders: await tx.$executeRaw`
          DELETE FROM "Order" WHERE "tenantId" = ${tenantId} AND id LIKE ${like} AND "orderId" LIKE ${`${DEMO_ORDER_PREFIX}%`}`,
        clients: (await tx.client.deleteMany({ where: { tenantId, id: { startsWith: prefix } } })).count,
        items: (await tx.inventoryItem.deleteMany({ where: { tenantId, id: { startsWith: prefix } } })).count,
      }
    },
    { timeout: 30_000 },
  )
  console.log('Removed', out)
}

async function main() {
  const slug = arg('tenant')
  const doApply = process.argv.includes('--apply')
  const doCleanup = process.argv.includes('--cleanup')
  if (!slug) throw new Error('Usage: --tenant=<slug> [--apply | --cleanup]')
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!tenant) throw new Error(`No business with slug "${slug}".`)
  const owners = await prisma.membership.findMany({
    where: { tenantId: tenant.id, role: 'OWNER', isActive: true },
    select: { user: { select: { email: true } } },
  })
  console.log(`Business: ${tenant.name} · id ${tenant.id} · owner ${owners.map((o) => o.user?.email).join(', ') || '—'}`)
  if (!looksLikeTestBusiness(tenant.name)) {
    throw new Error('Refused: the business name must say it is a test (for example "Meta Review Test").')
  }
  if ((doApply || doCleanup) && (process.env.META_DEMO_CONFIRM_TENANT || '').trim() !== tenant.id) {
    throw new Error(`Refused: set META_DEMO_CONFIRM_TENANT=${tenant.id} (this business's id) to write.`)
  }
  if (doCleanup) return cleanup(tenant.id)

  // Raw count: the app's client hides archived orders; they count here too.
  const counted = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM "Order" WHERE "tenantId" = ${tenant.id} AND "orderId" NOT LIKE ${`${DEMO_ORDER_PREFIX}%`}`
  const realOrders = Number(counted[0]?.n ?? 0)
  if (realOrders > MAX_REAL_ORDERS_FOR_DEMO) {
    throw new Error(`Refused: "${tenant.name}" has ${realOrders} real orders, it is not a test business.`)
  }
  const accounts = await prisma.socialAccount.findMany({
    where: { tenantId: tenant.id, isActive: true, platform: { in: ['whatsapp', 'instagram'] } },
    select: { id: true, platform: true },
    orderBy: { linkedAt: 'asc' },
  })
  const lines: DemoLine[] = []
  for (const platform of ['whatsapp', 'instagram'] as const) {
    const hit = accounts.find((a) => a.platform === platform)
    if (hit) lines.push({ id: hit.id, platform })
  }
  if (!lines.length) throw new Error('Connect the test WhatsApp line and/or Instagram account first.')

  const plan = buildDemoPlan(tenant.id, lines)
  console.log(`Real orders ${realOrders} · lines ${lines.map((l) => l.platform).join(', ')}`)
  console.log(
    `Plan: ${plan.inventory.length} products, ${plan.clients.length} customers, ${plan.orders.length} orders, ${plan.chats.length} demo chats`,
  )
  if (!doApply) {
    for (const c of plan.chats) console.log(`  chat ${c.platform} ${c.peerName} (${c.peerId})${c.fromAd ? ' · from ad' : ''}`)
    for (const o of plan.orders) console.log(`  order ${o.orderId} ${o.product} ₡${o.total}${o.paid ? ' · paid' : ''}`)
    console.log(`Dry run: nothing written. To write: META_DEMO_CONFIRM_TENANT=${tenant.id} … --apply`)
    return
  }
  await apply(tenant.id, plan)
  console.log('Written. Remove later with --cleanup.')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
