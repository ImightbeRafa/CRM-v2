/**
 * Read-only audit of the last days of agent turns for one business: every hand-off / review with the customer's
 * words, the decision steps that fired, the "¿ya pagó?" check verdict, and the model / provider errors.
 * Flags suspected FALSE payment hand-offs (a payment hand-off whose customer text the classifier calls non-payment).
 * Writes nothing to the database.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/handoff-audit.ts --tenant="Deep Sleep" [--days=3] [--out=handoff-audit.json]
 */
import { writeFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { classifyPaymentText } from '@/lib/soft-ai/payment-classifier'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

type Step = { step?: string; outcome?: string; reason?: string }
type Trace = { steps?: Step[]; outcomeMarkers?: { handoffKind?: string | null; handoffReason?: string | null } }

async function main() {
  const tenantArg = arg('tenant')
  const days = Number(arg('days') || 3)
  if (!tenantArg) throw new Error('--tenant=<id or name> is required')
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ id: tenantArg }, { name: { equals: tenantArg, mode: 'insensitive' } }] },
    select: { id: true, name: true },
  })
  if (!tenant) throw new Error(`tenant not found: ${tenantArg}`)
  const since = new Date(Date.now() - days * 24 * 60 * 60_000)

  const turns = await prisma.chatAgentTurn.findMany({
    where: { tenantId: tenant.id, createdAt: { gte: since }, testSessionId: null },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      status: true,
      skipReason: true,
      errorCode: true,
      fallbackUsed: true,
      intent: true,
      shortcutKey: true,
      outputText: true,
      decisionTrace: true,
      agent: { select: { name: true } },
      conversation: { select: { id: true, peerName: true, tags: true, aiMode: true } },
      triggerMessage: { select: { content: true, messageType: true } },
    },
  })

  const rows = turns.map((t) => {
    const trace = (t.decisionTrace ?? {}) as Trace
    const steps = trace.steps ?? []
    const customer = t.triggerMessage?.content ?? ''
    const handoffReason = trace.outcomeMarkers?.handoffReason ?? null
    const paymentHandoff = handoffReason === 'payment' || steps.some((s) => s.reason === 'payment_or_sinpe')
    return {
      at: t.createdAt.toISOString(),
      agent: t.agent.name,
      chat: t.conversation ? `${t.conversation.peerName ?? '?'} (${t.conversation.id})` : null,
      customer: customer.slice(0, 300),
      messageType: t.triggerMessage?.messageType ?? null,
      status: t.status,
      skipReason: t.skipReason,
      errorCode: t.errorCode,
      fallbackUsed: t.fallbackUsed,
      handoffKind: trace.outcomeMarkers?.handoffKind ?? null,
      handoffReason,
      steps: steps.map((s) => [s.step, s.outcome, s.reason].filter(Boolean).join(':')),
      paymentCheck: steps.find((s) => s.step === 'payment_llm_check')?.outcome ?? null,
      reply: (t.outputText ?? '').slice(0, 300),
      suspectFalsePayment: paymentHandoff && (t.triggerMessage?.messageType ?? 'text') === 'text' && classifyPaymentText(customer) !== 'payment_proof_or_risk',
    }
  })

  const count = (pick: (r: (typeof rows)[number]) => string | null) =>
    Object.entries(rows.reduce<Record<string, number>>((acc, r) => {
      const k = pick(r)
      if (k) acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})).sort((a, b) => b[1] - a[1])

  const handoffs = rows.filter((r) => r.handoffKind)
  console.log(`${tenant.name}: ${rows.length} turns in ${days} d, ${handoffs.length} hand-offs / reviews`)
  console.log('hand-off reasons:', count((r) => (r.handoffKind ? `${r.handoffKind}:${r.handoffReason}` : null)))
  console.log('errors:', count((r) => r.errorCode))
  console.log('skips:', count((r) => r.skipReason))
  console.log('"¿ya pagó?" check:', count((r) => r.paymentCheck))
  const suspects = rows.filter((r) => r.suspectFalsePayment)
  console.log(`\nSuspected false payment hand-offs: ${suspects.length}`)
  for (const r of suspects) console.log(`- ${r.at} ${r.agent} · ${r.chat}\n  cliente: ${JSON.stringify(r.customer)}\n  pasos: ${r.steps.join(' → ')}`)

  const out = arg('out')
  if (out) {
    writeFileSync(out, JSON.stringify({ tenant: tenant.name, since: since.toISOString(), rows }, null, 2))
    console.log(`\nFull rows: ${out}`)
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
