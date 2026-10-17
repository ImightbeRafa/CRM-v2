/**
 * luna-10 Stage 4 — silent trial ("sombra"), offline: for every real customer message on a channel in the last N hours,
 * rebuild the chat as it was at that moment, ask the agent what it would have answered (test-chat engine — sandbox,
 * nothing is sent; night mode when the message came outside the business hours) and put it next to what the team really
 * answered. Every agent answer is graded like the exam (code checks + reviewer) and compared with the team's reply.
 * Read-only on the live chats; never touches the live pipeline (no deploy needed). Rapid messages (≤ 90 s apart) are
 * one turn, answered after the last one — like the live debounce.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/shadow.ts --pack=<carpeta> --account=<socialAccountId> [--hours=24] [--cap=4000000]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { evaluateStep } from '@/lib/soft-ai/probar-scenarios'
import { softAiResponsesCreate, parseSoftAiResponseText } from '@/lib/soft-ai/llm/client'
import { LUNA_CHAT_AGENT_MODEL } from '@/lib/soft-ai/agent-types'
import { isWithinBusinessHours, parseBusinessHours } from '@/lib/soft-ai/business-hours'
import { isSoftAiOutboundMetadata } from '@/lib/soft-ai/agent-inbox-projection'
import { arg, loadPack } from './pack'
import { codeChecks, reviewerKnowledge } from './exam'
import { redactCustomerText } from './exam-bank'
import { withExamSession } from './test-session'

const BURST_MS = 90_000

const COMPARE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['agent', 'compare', 'category', 'reason'],
  properties: {
    agent: { type: 'string', enum: ['ok', 'minor', 'serious'] },
    compare: { type: 'string', enum: ['mejor', 'igual', 'peor', 'sin_respuesta_del_equipo'] },
    category: { type: 'string' },
    reason: { type: 'string' },
  },
}

async function compare(input: { tenantId: string; knowledge: string; history: string; customer: string; agent: string; team: string | null; night: boolean }) {
  try {
    const response = await softAiResponsesCreate({
      model: LUNA_CHAT_AGENT_MODEL,
      instructions: [
        'Sos un auditor estricto de ventas por chat. Compará la respuesta del AGENTE IA con la del EQUIPO (persona) al mismo mensaje del cliente.',
        'agent=serious si el agente: da un dato que contradice el CONOCIMIENTO, promete resultados/curas/bajar de peso, da consejo médico más allá de "consultá a tu médico", dice que no tiene un dato que sí está, inventa promoción o precio, suelta los datos (números/cuentas/links) de varios métodos de pago sin que los pidan, confirma un pago o pedido, de noche promete revisar ya, o ignora la pregunta. minor: estilo/tono/largo. ok: correcta.',
        'compare: mejor / igual / peor que la del equipo para avanzar la venta y ayudar al cliente (sin_respuesta_del_equipo si el equipo no respondió).',
        'Las frases del sitio ("apoya…", "ayuda a reducir antojos", "acompaña el ánimo") NO son promesas. Nombrar los métodos de pago para preguntar cuál prefiere es CORRECTO. De noche decir cuándo escribe el equipo es CORRECTO.',
        'Respondé solo el JSON; reason: una frase corta.',
      ].join('\n'),
      input: [{ type: 'message', role: 'user', content: [`CONOCIMIENTO:\n${input.knowledge}`, `HORARIO: ${input.night ? 'de noche' : 'de día'}`, `CHAT ANTERIOR:\n${redactCustomerText(input.history) || '(nada)'}`, `CLIENTE: ${redactCustomerText(input.customer)}`, `AGENTE IA: ${redactCustomerText(input.agent) || '(no respondió)'}`, `EQUIPO: ${input.team ? redactCustomerText(input.team) : '(no respondió)'}`].join('\n\n') }],
      reasoningEffort: 'low',
      maxOutputTokens: 300,
      timeoutMs: 30_000,
      store: false,
      textFormat: { name: 'shadow_compare', schema: COMPARE_SCHEMA, strict: true },
      usage: { tenantId: input.tenantId, feature: 'agent_test' },
    })
    return JSON.parse(parseSoftAiResponseText(response)) as { agent: 'ok' | 'minor' | 'serious'; compare: string; category: string; reason: string }
  } catch (e) {
    return { agent: 'minor' as const, compare: 'igual', category: 'otro', reason: `revisor: ${(e as Error).message.slice(0, 60)}` }
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function main() {
  const { pack, dir } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const account = arg('account')
  if (!account) throw new Error('Falta --account=<socialAccountId> (el canal a observar)')
  const hours = Number(arg('hours') || 24)
  const cap = Number(arg('cap') || 4_000_000)
  const since = new Date(Date.now() - hours * 3_600_000)
  const forbid = ((pack as unknown as { exam?: { forbid?: Array<{ re: string; why: string }> } }).exam?.forbid) ?? []
  const knowledge = reviewerKnowledge(pack)
  const schedule = parseBusinessHours((pack.salesRules as { businessHours?: unknown }).businessHours)
  const agent = await prisma.chatAgent.findFirst({ where: { tenantId, name: pack.agent.name, status: { not: 'archived' } }, select: { id: true, version: true } })
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true } })
  if (!agent || !user) throw new Error('Agente o usuario no encontrado')
  const acc = await prisma.socialAccount.findFirst({ where: { id: account, tenantId }, select: { platform: true, providerUsername: true, displayName: true } })
  if (!acc) throw new Error('Canal no encontrado en este negocio')

  const convs = await prisma.chatConversation.findMany({ where: { tenantId, socialAccountId: account, lastInboundAt: { gte: since } }, select: { id: true, peerName: true } })
  type Row = { conv: string; at: string; night: boolean; customer: string; agent: string; handoff: string | null; team: string | null; teamMinutes: number | null; findings: Array<{ cls: string; serious: boolean; why: string }>; review: Awaited<ReturnType<typeof compare>> }
  const rows: Row[] = []
  let cost = 0
  await withExamSession({ tenantId, actorEmail: pack.target.actorEmail, cap, label: 'shadow' }, async () => {
    for (const c of convs) {
      const msgs = await prisma.chatMessage.findMany({
        where: { tenantId, conversationId: c.id },
        orderBy: { sentAt: 'asc' },
        select: { direction: true, content: true, sentAt: true, messageType: true, metadata: true },
        take: 300,
      })
      // One turn per burst of customer messages (answered after the last one).
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i]
        if (m.direction !== 'inbound' || m.sentAt < since) continue
        const next = msgs[i + 1]
        if (next && next.direction === 'inbound' && next.sentAt.getTime() - m.sentAt.getTime() <= BURST_MS) continue
        const history = msgs.slice(Math.max(0, i - 24), i).map((h) => ({ direction: (h.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound', content: h.content || `[${h.messageType}]`, sentAt: h.sentAt.toISOString() }))
        const night = Boolean(schedule.enabled) && !isWithinBusinessHours(schedule, m.sentAt)
        const text = m.messageType === 'text' ? m.content || '' : `[${m.messageType}] ${m.content || ''}`.trim()
        const r = await runAgentTestTurn({ tenantId, agentId: agent.id, inboundText: text, socialAccountId: account, actorUserId: user.id, testSessionId: randomUUID(), history, customerName: c.peerName || 'Cliente', modelOverride: LUNA_CHAT_AGENT_MODEL, usageFeature: 'agent_test', simulateAfterHours: night, messageType: (m.messageType as 'text' | 'image' | 'audio' | 'document' | 'video') || 'text' })
        cost += r.estimatedCostUsd || 0
        // What the team really answered: the first person-written message after this customer message.
        const team = msgs.slice(i + 1).find((x) => x.direction === 'outbound' && !isSoftAiOutboundMetadata(x.metadata))
        const findings = codeChecks({ reply: r.text, customer: text, evaluation: evaluateStep(r, {}), handoff: r.handoff, fallbackUsed: r.fallbackUsed, night, forbid, silentExpected: false })
        const review = await compare({ tenantId, knowledge, history: history.slice(-6).map((h) => `${h.direction === 'inbound' ? 'CLIENTE' : 'TIENDA'}: ${h.content}`).join('\n'), customer: text, agent: r.text, team: team?.content ?? null, night })
        rows.push({
          conv: c.id.slice(-6),
          at: m.sentAt.toISOString(),
          night,
          customer: redactCustomerText(text, c.peerName),
          agent: r.text,
          handoff: r.handoff ? `${r.handoff.kind}:${r.handoff.reason}` : null,
          team: team?.content ? redactCustomerText(team.content, c.peerName) : null,
          teamMinutes: team ? Math.round((team.sentAt.getTime() - m.sentAt.getTime()) / 60_000) : null,
          findings,
          review,
        })
        process.stdout.write(findings.some((f) => f.serious) ? '✖' : review.agent === 'serious' ? '?' : '·')
      }
    }
  })
  process.stdout.write('\n')
  const serious = rows.filter((r) => r.findings.some((f) => f.serious))
  const count = (k: string) => rows.filter((r) => r.review.compare === k).length
  const meta = { channel: `${acc.platform} ${acc.providerUsername || acc.displayName}`, hours, turns: rows.length, serious: serious.length, reviewerSerious: rows.filter((r) => !r.findings.some((f) => f.serious) && r.review.agent === 'serious').length, better: count('mejor'), same: count('igual'), worse: count('peor'), teamDidNotAnswer: count('sin_respuesta_del_equipo'), costUsd: cost, finishedAt: new Date().toISOString() }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  writeFileSync(join(dir, `shadow-${stamp}.json`), JSON.stringify({ meta, rows }, null, 2))
  const tr = (r: Row) => `<tr class="${r.findings.some((f) => f.serious) ? 'bad' : r.review.agent === 'serious' ? 'warn' : r.review.compare === 'peor' ? 'meh' : 'ok'}"><td>${esc(new Date(r.at).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }))}${r.night ? ' 🌙' : ''}</td><td>${esc(r.customer)}</td><td>${esc(r.agent).replace(/\n/g, '<br>')}${r.handoff ? `<br><small>→ persona (${esc(r.handoff)})</small>` : ''}${r.findings.length ? `<br><b>${r.findings.map((f) => esc(f.why)).join('<br>')}</b>` : ''}</td><td>${r.team ? `${esc(r.team)}<br><small>${r.teamMinutes} min después</small>` : '<i>sin respuesta</i>'}</td><td>${esc(r.review.agent)} · <b>${esc(r.review.compare)}</b><br><small>${esc(r.review.reason)}</small></td></tr>`
  writeFileSync(
    join(dir, `shadow-${stamp}.html`),
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba en silencio ${esc(meta.channel)}</title><style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}tr.bad{background:#fde8e8}tr.warn{background:#fff6dd}tr.meh{background:#f5f5f5}.k{display:inline-block;margin:4px 12px 4px 0;padding:8px 12px;border-radius:8px;background:#f3f4f6}</style></head><body><h1>Prueba en silencio · ${esc(meta.channel)} · últimas ${hours} h</h1><div><span class="k">Turnos: <b>${rows.length}</b></span><span class="k">Errores graves: <b>${serious.length}</b></span><span class="k">Mejor que el equipo: <b>${meta.better}</b></span><span class="k">Igual: <b>${meta.same}</b></span><span class="k">Peor: <b>${meta.worse}</b></span><span class="k">El equipo no respondió: <b>${meta.teamDidNotAnswer}</b></span></div><table><tr><th>Hora</th><th>Cliente</th><th>Sofi habría dicho</th><th>El equipo dijo</th><th>Revisor</th></tr>${rows.map(tr).join('')}</table></body></html>`,
  )
  console.log(JSON.stringify(meta, null, 2))
  console.log(`Informe: ${join(dir, `shadow-${stamp}.html`)}`)
}

if (process.argv[1]?.endsWith('shadow.ts')) {
  main()
    .catch((e) => {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
