/**
 * Replay real customer messages through the test-chat engine (runAgentTestTurn — sandbox: nothing is sent, no order /
 * stock / guía): for each case, rebuild the chat as it was right before the matched customer message and ask the
 * chat's agent what it would answer now. Used for before / after proof on the same real chats (run it on two
 * checkouts). Read-only on the live chats. Spends the business's normal daily TEST tokens (never raises the cap).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/replay-chat.ts --cases=cases.json --actor=<owner/admin email> [--out=replay.json]
 *
 * cases.json: [{ "conversationId": "…", "match": "text of the customer message", "note": "optional" }]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { isSoftAiOutboundMetadata } from '@/lib/soft-ai/agent-inbox-projection'
import { arg } from './pack'

type Case = { conversationId: string; match: string; note?: string }
type Trace = { steps?: Array<{ step?: string; outcome?: string; reason?: string }>; outcomeMarkers?: { handoffKind?: string | null; handoffReason?: string | null } }

async function main() {
  const cases = JSON.parse(readFileSync(arg('cases') || '', 'utf8')) as Case[]
  const actor = await prisma.user.findUnique({ where: { email: arg('actor') || '' }, select: { id: true } })
  if (!actor) throw new Error('--actor=<email> of an OWNER / ADMIN is required')
  const rows: unknown[] = []
  for (const c of cases) {
    const conv = await prisma.chatConversation.findUnique({ where: { id: c.conversationId }, select: { id: true, tenantId: true, socialAccountId: true, peerName: true } })
    if (!conv) { console.log(`- ${c.conversationId}: chat not found`); continue }
    const member = await prisma.membership.findFirst({ where: { userId: actor.id, tenantId: conv.tenantId, isActive: true }, select: { role: true } })
    if (!member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error('the actor must be an active OWNER / ADMIN of the chat\'s business')
    const turn = await prisma.chatAgentTurn.findFirst({ where: { conversationId: conv.id, testSessionId: null }, orderBy: { createdAt: 'desc' }, select: { agentId: true, agent: { select: { name: true } } } })
    if (!turn) { console.log(`- ${c.conversationId}: no agent on this chat`); continue }
    const msgs = await prisma.chatMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { sentAt: 'asc' },
      select: { direction: true, content: true, sentAt: true, messageType: true, metadata: true },
    })
    const at = msgs.findIndex((m) => m.direction === 'inbound' && (m.content || '').includes(c.match))
    if (at < 0) { console.log(`- ${c.conversationId}: message not found: ${c.match}`); continue }
    const trigger = msgs[at]
    const history = msgs.slice(Math.max(0, at - 40), at).map((m) => ({
      direction: m.direction as 'inbound' | 'outbound',
      content: m.content || '',
      sentAt: m.sentAt.toISOString(),
      messageType: m.messageType,
    }))
    const r = await runAgentTestTurn({
      tenantId: conv.tenantId,
      agentId: turn.agentId,
      inboundText: trigger.content || '',
      socialAccountId: conv.socialAccountId,
      actorUserId: actor.id,
      testSessionId: `replay-${randomUUID()}`,
      history,
      customerName: 'Cliente de prueba',
      replaySentAt: trigger.sentAt,
    })
    const trace = (r.decisionTrace ?? {}) as Trace
    const real = msgs.slice(at + 1).find((m) => m.direction === 'outbound')
    const row = {
      agent: turn.agent.name,
      chat: conv.id,
      note: c.note,
      customer: trigger.content,
      before: real ? `${isSoftAiOutboundMetadata(real.metadata) ? 'BOT' : 'PERSONA'}: ${real.content}` : null,
      now: r.parts.join(' ⏎ '),
      outcome: r.outcome,
      handoff: trace.outcomeMarkers?.handoffKind ? `${trace.outcomeMarkers.handoffKind}:${trace.outcomeMarkers.handoffReason}` : null,
      steps: (trace.steps ?? []).map((s) => [s.step, s.outcome, s.reason].filter(Boolean).join(':')).join(' → '),
    }
    rows.push(row)
    console.log(`\n# ${row.agent} · ${row.note ?? ''}\nCLIENTE: ${row.customer}\nANTES:   ${row.before}\nAHORA:   ${row.now}\n         ${row.outcome}${row.handoff ? ` · ${row.handoff}` : ''} · ${row.steps}`)
  }
  const out = arg('out')
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2))
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
