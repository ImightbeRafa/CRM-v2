/**
 * Scorecard: plays every pack test through the real test-chat engine (runAgentTestTurn — sandbox: no message is
 * sent, no order / stock / guía) and grades each step with the test chat's own checks (evaluateStep).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/probar.ts --pack=<carpeta del pack> [--coverage] [--only=texto] [--max-share=0.6] [--out=file.md]
 *
 * --coverage: knowledge coverage instead of the pack's tests — every product (ingredientes, uso, todos los días,
 * precio) + store questions; fails on "no lo tengo / lo confirmo" or a hand-off (knowledge-coverage.ts).
 *
 * It spends real AI tokens from the business's daily TEST budget (shared with its staff's test chat): it stops
 * before using more than --max-share of what is left today (default 60 %) and reports the rest as "no corrió".
 */
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { evaluateStep, type StepExpect } from '@/lib/soft-ai/probar-scenarios'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import { coverageScenarios, knowledgeGaps } from '@/lib/soft-ai/knowledge-coverage'
import { arg, flag, loadPack } from './pack'

type Row = { title: string; step: number; customer: string; reply: string; pass: boolean; notRun: boolean; failures: string[]; why: string; images: number }

async function main() {
  const { pack } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const agent = await prisma.chatAgent.findFirst({ where: { tenantId, name: pack.agent.name, status: { not: 'archived' } }, select: { id: true, version: true } })
  if (!agent) throw new Error('El agente no existe: corré build-agent.ts --apply primero')
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true } })
  if (!user) throw new Error('Usuario del pack no encontrado')
  const member = await prisma.membership.findFirst({ where: { userId: user.id, tenantId, isActive: true }, select: { role: true } })
  if (!member || !['OWNER', 'ADMIN'].includes(String(member.role))) throw new Error('El usuario del pack debe ser OWNER o ADMIN activo del negocio')
  const socialAccountId = pack.target.socialAccountIds[0]
  if (!socialAccountId) throw new Error('El pack necesita target.socialAccountIds (el chat de prueba usa ese canal)')
  const only = (arg('only') || '').toLowerCase()
  // --coverage (Rafael 2026-10-16): instead of the pack's own tests, ask every product and store question a customer
  // asks; any "no lo tengo / lo confirmo" or hand-off fails. Prints the offline knowledge gaps first.
  const coverage = flag('coverage')
  if (coverage) {
    const knowledge = [...pack.knowledge.map((k) => k.body), ...pack.shortcuts.map((s) => s.body), JSON.stringify(pack.brandFacts)].join('\n\n')
    const gaps = knowledgeGaps({ knowledge, products: pack.inventory.names })
    console.log(gaps.length ? `Huecos en el conocimiento del pack (${gaps.length}):` : 'Conocimiento del pack: sin huecos detectados.')
    for (const g of gaps) console.log(`  - ${g.product ? `${g.product}: ` : 'Tienda: '}${g.topic}`)
  }
  const tests = (coverage ? coverageScenarios(pack.inventory.names) : pack.tests).filter((t) => !only || t.title.toLowerCase().includes(only))

  const cap = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config).testDailyTokenCap
  const startUsed = await loadDailyTestTokens(tenantId)
  const share = Math.min(1, Math.max(0.05, Number(arg('max-share') || 0.6)))
  const allowance = Math.floor((cap - startUsed) * share)
  console.log(`Agente v${agent.version} · ${tests.length} pruebas · presupuesto de pruebas: usar hasta ${allowance.toLocaleString('es-CR')} tokens`)

  const rows: Row[] = []
  let spent = 0
  let cost = 0
  for (const t of tests) {
    const history: Array<{ direction: 'inbound' | 'outbound'; content: string; sentAt: string }> = []
    const session = randomUUID()
    const sentImageIds: string[] = []
    for (const [i, step] of t.steps.entries()) {
      if (spent >= allowance) {
        rows.push({ title: t.title, step: i + 1, customer: step.text, reply: '', pass: false, notRun: true, failures: ['Sin presupuesto de pruebas hoy'], why: '', images: 0 })
        continue
      }
      try {
        const r = await runAgentTestTurn({
          tenantId,
          agentId: agent.id,
          inboundText: step.text,
          socialAccountId,
          actorUserId: user.id,
          testSessionId: session,
          messageType: step.messageType,
          history: [...history],
          customerName: 'Cliente de prueba',
          sentImageIds,
        })
        spent += r.tokens.input + r.tokens.output
        cost += r.estimatedCostUsd || 0
        const ev = evaluateStep(r, step.expect as StepExpect | undefined)
        rows.push({
          title: t.title,
          step: i + 1,
          customer: step.text,
          reply: r.text,
          pass: ev.pass,
          notRun: Boolean(ev.notRun),
          failures: ev.failures,
          why: [r.escalate || r.needsHuman ? 'pasa a persona' : '', r.shortcutKey ? `atajo ${r.shortcutKey}` : '', ...(r.why ?? [])].filter(Boolean).join(' · '),
          images: r.images?.length ?? 0,
        })
        for (const img of r.images ?? []) sentImageIds.push(img.assetId)
        const at = new Date().toISOString()
        history.push({ direction: 'inbound', content: step.text, sentAt: at })
        if (r.text) history.push({ direction: 'outbound', content: r.text, sentAt: at })
      } catch (e) {
        rows.push({ title: t.title, step: i + 1, customer: step.text, reply: '', pass: false, notRun: true, failures: [`Error: ${(e as Error).message}`], why: '', images: 0 })
      }
      process.stdout.write(rows.at(-1)!.notRun ? '·' : rows.at(-1)!.pass ? '✔' : '✘')
    }
  }
  const ran = rows.filter((r) => !r.notRun)
  const passed = ran.filter((r) => r.pass).length
  const summary = `Pasaron ${passed}/${ran.length} pasos (${ran.length ? Math.round((passed / ran.length) * 100) : 0} %) · no corrieron ${rows.length - ran.length} · tokens ${spent.toLocaleString('es-CR')} · ~US$${cost.toFixed(3)}`
  console.log(`\n${summary}`)
  const md = [
    `# Scorecard ${pack.agent.name} (v${agent.version})`,
    '',
    summary,
    '',
    ...rows.map((r) =>
      [
        `## ${r.pass ? '✔' : r.notRun ? '·' : '✘'} ${r.title} — paso ${r.step}`,
        `**Cliente:** ${r.customer}`,
        `**Agente${r.images ? ` (+${r.images} imagen)` : ''}:** ${r.reply || '(sin texto)'}`,
        r.why ? `_${r.why}_` : '',
        r.failures.length ? `Fallas: ${r.failures.join(' · ')}` : '',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n')
  const out = arg('out')
  if (out) writeFileSync(out, md)
  else for (const r of rows.filter((x) => !x.pass && !x.notRun)) console.log(`✘ ${r.title} #${r.step}: ${r.failures.join(' · ')}\n   → ${r.reply.slice(0, 300)}`)
}

main()
  .catch((e) => {
    console.error(`ERROR: ${(e as Error).message}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
