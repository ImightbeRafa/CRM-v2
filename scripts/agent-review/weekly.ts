/**
 * DeepSleep weekly bot review — read-only Prisma metrics (no customer PII).
 *
 * Reproduces the headline numbers from the Oct 27–Nov 2 review (uploads/README.md /
 * summary.json). Outputs JSON + markdown. Never writes.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-review/weekly.ts \
 *     [--start=2026-10-27T06:00:00Z] [--end=2026-11-03T06:00:00Z] \
 *     [--split=2026-10-30T00:15:00Z] [--out=scripts/agent-review/out/weekly-YYYY-MM-DD]
 *
 * Window defaults = last completed CR week (Mon 00:00 CR = Mon 06:00 UTC → next Mon).
 * Default --out is under scripts/agent-review/out/ (gitignored). CRM161-12: aggregate metrics only
 * (no reply text samples). CRM161-13: --out must be gitignored, under /tmp, or outside the repo.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { resolveRepoOutPath } from '../lib/out-path-guard'

const TENANT_SLUG = 'deepsleepp-cr-1762740734630'
const LIVE_NAMES = ['Forge ventas', 'Sleeping ventas', 'PatchHouse ventas', 'Pura Sonrisa ventas', 'Prototipo ventas']

const STALL_RE = /dame un momento|ya lo reviso|te confirmo/i

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function defaultWindow(): { s: Date; e: Date; d: Date } {
  // Last completed CR week: Mon 06:00 UTC → next Mon 06:00 UTC.
  const now = new Date()
  const utc = now.getTime()
  const day = now.getUTCDay() // 0 Sun
  const daysSinceMon = (day + 6) % 7
  const thisMon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMon, 6, 0, 0))
  const end = thisMon
  const start = new Date(end.getTime() - 7 * 24 * 3600_000)
  const split = new Date(start.getTime() + 3 * 24 * 3600_000) // mid-week default
  void utc
  return { s: start, e: end, d: split }
}

async function main() {
  const win = defaultWindow()
  const s = new Date(arg('start') || win.s.toISOString())
  const e = new Date(arg('end') || win.e.toISOString())
  const d = new Date(arg('split') || win.d.toISOString())
  const outBase = resolveRepoOutPath(
    arg('out') || join(process.cwd(), 'scripts/agent-review/out', `weekly-${s.toISOString().slice(0, 10)}`),
    '--out',
  )

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true, name: true, slug: true } })
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found`)

  const agents = await prisma.chatAgent.findMany({
    where: { tenantId: tenant.id, name: { in: LIVE_NAMES } },
    select: { id: true, name: true },
  })
  const agentIds = agents.map((a) => a.id)
  const nameOf = Object.fromEntries(agents.map((a) => [a.id, a.name]))

  const turns = await prisma.chatAgentTurn.findMany({
    where: {
      tenantId: tenant.id,
      agentId: { in: agentIds },
      testSessionId: null,
      status: { not: 'test' },
      createdAt: { gte: s, lt: e },
    },
    select: {
      id: true,
      agentId: true,
      conversationId: true,
      status: true,
      shortcutKey: true,
      outputText: true,
      decisionTrace: true,
      createdAt: true,
      triggerMessageId: true,
      skipReason: true,
      errorCode: true,
    },
  })

  const replyStatuses = new Set(['delivered', 'partially_delivered'])
  const replies = turns.filter((t) => replyStatuses.has(t.status))
  const chats = new Set(replies.map((t) => t.conversationId).filter(Boolean) as string[])
  const skipped = turns.filter((t) => t.status === 'skipped' || t.skipReason)
  const handoffPerson = turns.filter((t) => (t.decisionTrace as { outcomeMarkers?: { handoffKind?: string } } | null)?.outcomeMarkers?.handoffKind === 'handoff')
  const review = turns.filter((t) => (t.decisionTrace as { outcomeMarkers?: { handoffKind?: string } } | null)?.outcomeMarkers?.handoffKind === 'review')
  const paymentHandoff = turns.filter(
    (t) => (t.decisionTrace as { outcomeMarkers?: { handoffReason?: string } } | null)?.outcomeMarkers?.handoffReason === 'payment',
  )
  const stalls = replies.filter((t) => STALL_RE.test(t.outputText || ''))

  // Order-linked chats: any ChatMessage of that chat has orderId.
  const orderRows = chats.size
    ? await prisma.chatMessage.findMany({
        where: { tenantId: tenant.id, conversationId: { in: [...chats] }, orderId: { not: null } },
        select: { conversationId: true },
        distinct: ['conversationId'],
      })
    : []
  const orderChats = new Set(orderRows.map((r) => r.conversationId))

  // Follow-ups: outbound with metadata.followUp
  const followUps = await prisma.$queryRaw<Array<{ id: string; conversationId: string; socialAccountId: string; content: string; sentAt: Date; meta: unknown }>>`
    SELECT m."id", m."conversationId", m."socialAccountId", m."content", m."sentAt", m."metadata" AS meta
      FROM "ChatMessage" m
     WHERE m."tenantId" = ${tenant.id}
       AND m."direction" = 'outbound'
       AND m."sentAt" >= ${s} AND m."sentAt" < ${e}
       AND m."metadata" ? 'followUp'`

  // Replied within 12 h
  let followupReplied = 0
  let followupLaterOrder = 0
  for (const fu of followUps) {
    const replied = await prisma.chatMessage.findFirst({
      where: {
        tenantId: tenant.id,
        conversationId: fu.conversationId,
        direction: 'inbound',
        sentAt: { gt: fu.sentAt, lte: new Date(fu.sentAt.getTime() + 12 * 3600_000) },
      },
      select: { id: true },
    })
    if (replied) followupReplied += 1
    const ordered = await prisma.chatMessage.findFirst({
      where: { tenantId: tenant.id, conversationId: fu.conversationId, orderId: { not: null }, sentAt: { gte: fu.sentAt } },
      select: { id: true },
    })
    if (ordered) followupLaterOrder += 1
  }

  // Per bot
  const byBot: Record<string, { replies: number; chats: Set<string>; orderChats: number; stalls: number; handoffs: number }> = {}
  for (const a of agents) byBot[a.name] = { replies: 0, chats: new Set(), orderChats: 0, stalls: 0, handoffs: 0 }
  for (const t of replies) {
    const n = nameOf[t.agentId]
    if (!n) continue
    byBot[n].replies += 1
    if (t.conversationId) byBot[n].chats.add(t.conversationId)
    if (STALL_RE.test(t.outputText || '')) byBot[n].stalls += 1
  }
  for (const t of handoffPerson) {
    const n = nameOf[t.agentId]
    if (n) byBot[n].handoffs += 1
  }
  for (const name of Object.keys(byBot)) {
    byBot[name].orderChats = [...byBot[name].chats].filter((c) => orderChats.has(c)).length
  }

  // Shortcuts
  const shortcutCounts: Record<string, number> = {}
  for (const t of replies) {
    if (!t.shortcutKey || t.shortcutKey.startsWith('sys_')) continue
    const k = `${nameOf[t.agentId] || '?'}:${t.shortcutKey}`
    shortcutCounts[k] = (shortcutCounts[k] || 0) + 1
  }

  // Prototipo pt_verlo / clips
  const ptVerlo = replies.filter((t) => t.shortcutKey === 'pt_verlo')
  const ptBlocked = ptVerlo.filter((t) => {
    const steps = (t.decisionTrace as { steps?: Array<{ step?: string; outcome?: string; reason?: string }> } | null)?.steps || []
    return steps.some((s) => s.step === 'validator' && String(s.reason || '').includes('deal_offer'))
  })

  // Forge size / price openers (masked pattern counts only)
  const forgeId = agents.find((a) => a.name === 'Forge ventas')?.id
  const forgeReplies = replies.filter((t) => t.agentId === forgeId)
  const forgeFgTallas = forgeReplies.filter((t) => t.shortcutKey === 'fg_tallas').length

  const summary = {
    week: `${s.toISOString()}..${e.toISOString()}`,
    deploy_split: d.toISOString(),
    tenant: { id: tenant.id, slug: tenant.slug },
    replies: replies.length,
    chats: chats.size,
    skipped: skipped.length,
    handoff_person: handoffPerson.length,
    review: review.length,
    payment_handoff: paymentHandoff.length,
    stalls: stalls.length,
    order_chats: orderChats.size,
    order_rate_pct: chats.size ? Math.round((orderChats.size / chats.size) * 1000) / 10 : 0,
    followups: followUps.length,
    followup_replied_12h: followupReplied,
    followup_later_order: followupLaterOrder,
    by_bot: Object.fromEntries(
      Object.entries(byBot).map(([name, b]) => [
        name,
        { replies: b.replies, chats: b.chats.size, order_chats: b.orderChats, stalls: b.stalls, handoffs: b.handoffs },
      ]),
    ),
    shortcuts_top: Object.entries(shortcutCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([k, n]) => ({ key: k, n })),
    prototipo: { pt_verlo: ptVerlo.length, blocked_deal_offer: ptBlocked.length },
    forge: { replies: forgeReplies.length, fg_tallas: forgeFgTallas },
  }

  const md = [
    `# Weekly bot review — DeepSleep`,
    ``,
    `Window (UTC): \`${summary.week}\` · split \`${summary.deploy_split}\``,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Replies | ${summary.replies} |`,
    `| Chats | ${summary.chats} |`,
    `| Order-linked chats | ${summary.order_chats} (${summary.order_rate_pct}%) |`,
    `| Skipped | ${summary.skipped} |`,
    `| Handoff (person) | ${summary.handoff_person} |`,
    `| Review | ${summary.review} |`,
    `| Payment handoff | ${summary.payment_handoff} |`,
    `| Stalls ("dame un momento"…) | ${summary.stalls} |`,
    `| Follow-ups | ${summary.followups} (replied 12h: ${summary.followup_replied_12h}, later order: ${summary.followup_later_order}) |`,
    ``,
    `## Per bot`,
    ``,
    `| Bot | Replies | Chats | Orders | Stalls | Handoffs |`,
    `|---|---|---|---|---|---|`,
    ...Object.entries(summary.by_bot).map(
      ([name, b]) => `| ${name} | ${b.replies} | ${b.chats} | ${b.order_chats} | ${b.stalls} | ${b.handoffs} |`,
    ),
    ``,
    `## Prototipo pt_verlo`,
    ``,
    `Picked: ${summary.prototipo.pt_verlo} · blocked deal_offer: ${summary.prototipo.blocked_deal_offer}`,
    ``,
    `## Notes`,
    ``,
    `- Read-only. Aggregate metrics only — no reply text samples (CRM161-12).`,
    `- Definitions match docs from the weekly review SQL pack (real turns, reply = delivered/partially_delivered, handoff from decisionTrace.outcomeMarkers).`,
    ``,
  ].join('\n')

  mkdirSync(outBase.replace(/\/[^/]+$/, '') === outBase ? '.' : outBase.replace(/\/[^/]+$/, ''), { recursive: true })
  // Ensure parent of outBase exists when outBase is a file prefix path
  const jsonPath = `${outBase}.json`
  const mdPath = `${outBase}.md`
  try {
    mkdirSync(jsonPath.replace(/\/[^/]+$/, ''), { recursive: true })
  } catch {
    /* root */
  }
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2))
  writeFileSync(mdPath, md)
  console.log(`Wrote ${jsonPath}`)
  console.log(`Wrote ${mdPath}`)
  console.log(JSON.stringify({ replies: summary.replies, chats: summary.chats, order_rate_pct: summary.order_rate_pct, payment_handoff: summary.payment_handoff, stalls: summary.stalls }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
