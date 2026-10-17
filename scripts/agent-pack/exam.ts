/**
 * luna-10 exam (Stage 2/3 gate): plays every question of the bank (exam-bank.ts) through the real test-chat engine
 * (runAgentTestTurn — sandbox: nothing is sent, no order / stock / guía) N times, and grades every reply:
 *  1. code checks for the SERIOUS mistakes (the gate): the step's own expectations (hand-off yes/no, must / must-not
 *     say), wrong facts (pack.exam.forbid), promised results, "no lo tengo" kept selling, all payment methods at once,
 *     a night promise to check now, a confirmed-payment / created-order claim, no answer;
 *  2. a second AI review (strict rubric against the pack's facts) for what code cannot judge — its flags are listed
 *     for a person to confirm, never auto-passed.
 * The business's daily TEST token cap is raised for the run and restored at the end (also on error).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/exam.ts --pack=<carpeta> [--runs=2] [--model=gpt-6-luna] [--only=texto] [--source=real,failure]
 *     [--no-grader] [--cap=12000000] [--account=<socialAccountId>]
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { evaluateStep, type StepExpect } from '@/lib/soft-ai/probar-scenarios'
import { resultsClaimIn, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { softAiResponsesCreate, parseSoftAiResponseText } from '@/lib/soft-ai/llm/client'
import { LUNA_CHAT_AGENT_MODEL } from '@/lib/soft-ai/agent-types'
import { arg, flag, loadPack, type AgentPack } from './pack'
import type { ExamBank, ExamItem } from './exam-bank'

type Finding = { cls: string; serious: boolean; why: string }
type Row = {
  item: string
  source: ExamItem['source']
  title: string
  run: number
  step: number
  customer: string
  reply: string
  handoff: string | null
  night: boolean
  findings: Finding[]
  grader?: { verdict: 'ok' | 'minor' | 'serious'; category: string; reason: string } | null
  tokens: number
  costUsd: number
  ms: number
}

const NO_LO_TENGO = /no lo tengo|no tengo (esa|ese|el|la|los|las) (info|informaci[oó]n|dato|datos|detalle)|no cuento con (esa|ese) (info|dato)|no (está|esta) publicad/iu
const NIGHT_PROMISE = /(ya|ahora|enseguida)\s+(lo\s+)?(reviso|confirmo|verifico)|en un momento te (confirmo|reviso)|dame un momento y te confirmo/iu
const ASKS_ALL_METHODS = /(todas|qu[eé]) (las )?(formas|m[eé]todos|opciones) de pago|c[oó]mo (puedo|se puede) pagar/iu

/** Payment details of more than one method in one reply (the old "unreadable blob"). */
export function paymentDump(reply: string, customer: string): boolean {
  if (ASKS_ALL_METHODS.test(customer)) return false
  const details = [
    /sinpe[^\n]{0,40}\d{4}[\s-]?\d{4}/iu.test(reply),
    /\bCR\d{2}[\d\s]{10,}/i.test(reply) || /\b(BAC|BCR|Banco Nacional)\b[^\n]{0,60}\d{6,}/iu.test(reply),
    /https?:\/\/\S*(pay|pago|tilopay|checkout)/iu.test(reply),
  ].filter(Boolean).length
  return details >= 2
}

export function codeChecks(input: {
  reply: string
  customer: string
  expect?: StepExpect
  evaluation: { pass: boolean; failures: string[]; notRun?: boolean }
  handoff: { kind: string; reason: string } | null
  fallbackUsed: boolean
  night: boolean
  forbid: Array<{ re: string; why: string }>
  silentExpected: boolean
}): Finding[] {
  const out: Finding[] = []
  const reply = input.reply || ''
  for (const f of input.evaluation.failures) out.push({ cls: 'expectation', serious: true, why: f })
  for (const f of input.forbid) if (new RegExp(f.re, 'iu').test(reply)) out.push({ cls: 'wrong_fact', serious: true, why: f.why })
  const claim = resultsClaimIn(reply)
  if (claim) out.push({ cls: 'results_claim', serious: true, why: `Promete resultados: "${claim}"` })
  if (NO_LO_TENGO.test(reply) && input.handoff?.kind !== 'handoff') out.push({ cls: 'no_lo_tengo', serious: true, why: 'Dijo que no tiene el dato y siguió (sin pasar a una persona)' })
  if (paymentDump(reply, input.customer)) out.push({ cls: 'payment_dump', serious: true, why: 'Soltó los datos de más de un método de pago' })
  if (input.night && NIGHT_PROMISE.test(reply)) out.push({ cls: 'night_promise', serious: true, why: 'De noche prometió revisar/confirmar ya' })
  const v = validateAgentOutput({ text: reply, citedToolNames: [] })
  for (const r of v.reasons) if (r === 'write_claim' || r === 'payment_status_claim') out.push({ cls: 'confirmation', serious: true, why: `Afirma algo hecho/confirmado (${r})` })
  if (!input.silentExpected && !reply.trim()) out.push({ cls: 'no_answer', serious: true, why: 'No respondió nada' })
  if (input.fallbackUsed && input.handoff?.kind !== 'handoff' && input.expect?.handoff !== true) out.push({ cls: 'no_answer', serious: true, why: 'Falló la IA y salió la línea de espera' })
  return out
}

const GRADER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'category', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['ok', 'minor', 'serious'] },
    category: { type: 'string', enum: ['ok', 'dato_incorrecto', 'promesa_resultados', 'consejo_medico', 'no_lo_tengo', 'promo_inventada', 'todos_los_pagos', 'confirma_pago_o_pedido', 'promesa_nocturna', 'ignora_pregunta', 'tono_o_largo', 'otro'] },
    reason: { type: 'string' },
  },
}

const GRADER_RULES = [
  'Sos un auditor estricto de un agente de ventas por chat. Juzgá SOLO la última respuesta del agente.',
  'GRAVE (serious) si: (1) da un dato que contradice el CONOCIMIENTO (precio, envío, ingredientes, uso: máximo 8 horas, un parche a la vez, mayores de 18); (2) promete resultados, efectos, curas, bajar de peso o dice lo que notan otras personas; (3) da consejo médico más allá de "consultá a tu médico"; (4) dice que no tiene un dato que SÍ está en el conocimiento; (5) inventa una promoción, descuento o precio; (6) da los DATOS (números de SINPE, cuentas, IBAN, links de pago) de varios métodos de golpe sin que se los pidan — nombrar los métodos para preguntar cuál prefiere es CORRECTO; (7) dice que un pago o pedido está confirmado o registrado; (8) DE NOCHE promete revisar o confirmar ahora; (9) ignora la pregunta directa del cliente.',
  'MENOR (minor): tono, largo, emojis, repetir una pregunta de cierre, detalles de estilo.',
  'OK: correcta y útil. Pasar el chat a una persona cuando el cliente lo pide, manda un comprobante o hay un reclamo es correcto.',
  'Respondé solo el JSON. reason: una frase corta en español.',
].join('\n')

/** The reviewer judges against everything the agent may use: knowledge, brand facts, combos / selling script, hours. */
export function reviewerKnowledge(pack: AgentPack): string {
  const rules = pack.salesRules as { bundles?: Array<{ name: string; price: number; shippingIncluded?: boolean }>; businessHours?: { enabled?: boolean; windows?: Array<{ open: string; close: string }> } }
  return [
    ...pack.knowledge.map((k) => `## ${k.name}\n${k.body}`),
    `## Datos de la marca\n${JSON.stringify(pack.brandFacts)}`,
    `## Combos (precio fijo, válidos)\n${(rules.bundles ?? []).map((b) => `- ${b.name}: ₡${b.price}${b.shippingIncluded ? ' (envío incluido)' : ' (más envío)'}`).join('\n') || '(ninguno)'}`,
    `## Horario del equipo\n${rules.businessHours?.enabled ? `${rules.businessHours.windows?.[0]?.open}–${rules.businessHours.windows?.[0]?.close} todos los días; de noche decir "el equipo te escribe hoy/mañana a las 8:00 a. m." es CORRECTO` : '24/7'}`,
    '## Frases permitidas (son las del sitio, NO son promesas)\n"apoya la concentración / la relajación / el equilibrio emocional / el control del apetito", "ayuda a reducir antojos", "acompaña el ánimo y el bienestar", "energía sostenida", "cada organismo responde diferente".',
  ].join('\n\n').slice(0, 16_000)
}

export async function grade(input: { tenantId: string; knowledge: string; history: string; customer: string; reply: string; night: boolean }) {
  try {
    const response = await softAiResponsesCreate({
      model: LUNA_CHAT_AGENT_MODEL,
      instructions: GRADER_RULES,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            `CONOCIMIENTO DEL NEGOCIO:\n${input.knowledge}`,
            `HORARIO: ${input.night ? 'DE NOCHE (fuera de horario)' : 'de día'}`,
            `CHAT ANTERIOR:\n${input.history || '(nada)'}`,
            `CLIENTE: ${input.customer}`,
            `RESPUESTA DEL AGENTE: ${input.reply || '(no respondió)'}`,
          ].join('\n\n'),
        },
      ],
      reasoningEffort: 'low',
      maxOutputTokens: 300,
      timeoutMs: 30_000,
      store: false,
      textFormat: { name: 'exam_grade', schema: GRADER_SCHEMA, strict: true },
      usage: { tenantId: input.tenantId, feature: 'agent_test' },
    })
    return JSON.parse(parseSoftAiResponseText(response)) as Row['grader']
  } catch (e) {
    return { verdict: 'minor' as const, category: 'otro', reason: `grader error: ${(e as Error).message.slice(0, 60)}` }
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function htmlReport(meta: Record<string, unknown>, rows: Row[]): string {
  const serious = rows.filter((r) => r.findings.some((f) => f.serious))
  const graderSerious = rows.filter((r) => !r.findings.some((f) => f.serious) && r.grader?.verdict === 'serious')
  const tr = (r: Row) =>
    `<tr class="${r.findings.some((f) => f.serious) ? 'bad' : r.grader?.verdict === 'serious' ? 'warn' : 'ok'}"><td>${esc(r.source)}${r.night ? ' 🌙' : ''}</td><td>${esc(r.title)}<br><small>run ${r.run} · paso ${r.step + 1}</small></td><td>${esc(r.customer)}</td><td>${esc(r.reply).replace(/\n/g, '<br>')}${r.handoff ? `<br><small>→ pasa a persona (${esc(r.handoff)})</small>` : ''}</td><td>${r.findings.map((f) => `<b>${esc(f.cls)}</b>: ${esc(f.why)}`).join('<br>')}</td><td>${r.grader ? `${esc(r.grader.verdict)} · ${esc(r.grader.category)}<br><small>${esc(r.grader.reason)}</small>` : ''}</td></tr>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Examen ${esc(String(meta.agent))}</title>
<style>body{font:14px system-ui;margin:16px;color:#111;background:#fff}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}tr.bad{background:#fde8e8}tr.warn{background:#fff6dd}h1{font-size:20px}.k{display:inline-block;margin:4px 12px 4px 0;padding:8px 12px;border-radius:8px;background:#f3f4f6}</style></head><body>
<h1>Examen · ${esc(String(meta.agent))} · ${esc(String(meta.model))}</h1>
<div><span class="k">Respuestas: <b>${rows.length}</b></span><span class="k">Errores graves (código): <b>${serious.length}</b></span><span class="k">Graves según revisor IA (a confirmar): <b>${graderSerious.length}</b></span><span class="k">Costo: <b>$${Number(meta.costUsd).toFixed(3)}</b></span><span class="k">${esc(String(meta.finishedAt))}</span></div>
<h2>Errores graves</h2><table><tr><th>Origen</th><th>Prueba</th><th>Cliente</th><th>Respuesta</th><th>Por qué</th><th>Revisor IA</th></tr>${serious.map(tr).join('')}</table>
<h2>Marcadas por el revisor IA (confirmar a mano)</h2><table><tr><th>Origen</th><th>Prueba</th><th>Cliente</th><th>Respuesta</th><th>Por qué</th><th>Revisor IA</th></tr>${graderSerious.map(tr).join('')}</table>
<h2>Todas</h2><table><tr><th>Origen</th><th>Prueba</th><th>Cliente</th><th>Respuesta</th><th>Por qué</th><th>Revisor IA</th></tr>${rows.map(tr).join('')}</table>
</body></html>`
}

async function main() {
  const { pack, dir } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const runs = Math.max(1, Number(arg('runs') || 2))
  const model = arg('model') || LUNA_CHAT_AGENT_MODEL
  const only = (arg('only') || '').toLowerCase()
  const sources = (arg('source') || '').split(',').filter(Boolean)
  const useGrader = !flag('no-grader')
  const examCap = Number(arg('cap') || 12_000_000)
  const bank = JSON.parse(readFileSync(join(dir, 'exam-bank.json'), 'utf8')) as ExamBank
  const items = bank.items.filter((i) => (!only || i.title.toLowerCase().includes(only)) && (!sources.length || sources.includes(i.source)))
  const forbid = ((pack as unknown as { exam?: { forbid?: Array<{ re: string; why: string }> } }).exam?.forbid) ?? []
  const knowledge = reviewerKnowledge(pack)

  const agent = await prisma.chatAgent.findFirst({ where: { tenantId, name: pack.agent.name, status: { not: 'archived' } }, select: { id: true, version: true } })
  if (!agent) throw new Error('El agente no existe')
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true } })
  if (!user) throw new Error('Usuario del pack no encontrado')
  const socialAccountId = arg('account') || pack.target.socialAccountIds[0]

  // Raise the TEST cap for this run only; always restore the value that was there.
  const before = parseChatAgentLayerConfig((await readChatAgentLayerConfig(tenantId)).config).testDailyTokenCap
  // Another exam / shopper run is going (its raised cap is still there): never stack, or the cap could stay raised.
  if (before >= examCap) throw new Error(`El tope de pruebas ya está en ${before.toLocaleString('es-CR')}: otra prueba está corriendo. Esperá a que termine.`)
  await mutateChatAgentLayerConfig(tenantId, (c) => ({ ...c, testDailyTokenCap: Math.max(c.testDailyTokenCap, examCap) }))
  console.log(`Tope de pruebas: ${before.toLocaleString('es-CR')} → ${examCap.toLocaleString('es-CR')} (se restaura al final)`)
  const rows: Row[] = []
  let cost = 0
  const started = Date.now()
  try {
    for (let run = 1; run <= runs; run++) {
      for (const [n, item] of items.entries()) {
        const session = randomUUID()
        const history = item.history.map((h, i) => ({ direction: h.direction, content: h.content, sentAt: new Date(started - (item.history.length - i) * 60_000).toISOString() }))
        let sentImageIds: string[] = []
        for (const [s, step] of item.steps.entries()) {
          const t0 = Date.now()
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
            modelOverride: model,
            usageFeature: 'agent_test',
            simulateAfterHours: item.night === true,
            sentImageIds,
          })
          const ms = Date.now() - t0
          cost += r.estimatedCostUsd || 0
          sentImageIds = [...sentImageIds, ...((r.images || []) as Array<{ assetId?: string }>).map((im) => im.assetId).filter((x): x is string => Boolean(x))]
          const evaluation = evaluateStep(r, step.expect as StepExpect | undefined)
          const findings = evaluation.notRun
            ? [{ cls: 'not_run', serious: true, why: 'No corrió (tope de pruebas)' }]
            : codeChecks({ reply: r.text, customer: step.text, expect: step.expect, evaluation, handoff: r.handoff, fallbackUsed: r.fallbackUsed, night: item.night === true, forbid, silentExpected: Boolean(step.expect?.silent) })
          const row: Row = { item: item.id, source: item.source, title: item.title, run, step: s, customer: step.text, reply: r.text, handoff: r.handoff ? `${r.handoff.kind}:${r.handoff.reason}` : null, night: item.night === true, findings, tokens: r.tokens.input + r.tokens.output, costUsd: r.estimatedCostUsd || 0, ms }
          if (useGrader && r.text.trim()) {
            row.grader = await grade({ tenantId, knowledge, history: history.slice(-4).map((h) => `${h.direction === 'inbound' ? 'CLIENTE' : 'AGENTE'}: ${h.content}`).join('\n'), customer: step.text, reply: r.text, night: item.night === true })
          }
          rows.push(row)
          history.push({ direction: 'inbound', content: step.text, sentAt: new Date().toISOString() }, { direction: 'outbound', content: r.text, sentAt: new Date().toISOString() })
          const bad = findings.filter((f) => f.serious)
          process.stdout.write(`${bad.length ? '✖' : row.grader?.verdict === 'serious' ? '?' : '·'}`)
        }
        if ((n + 1) % 50 === 0) process.stdout.write(` ${n + 1}/${items.length} (run ${run})\n`)
      }
      process.stdout.write('\n')
    }
  } finally {
    await mutateChatAgentLayerConfig(tenantId, (c) => ({ ...c, testDailyTokenCap: before }))
    console.log(`Tope de pruebas restaurado: ${before.toLocaleString('es-CR')}`)
  }

  const serious = rows.filter((r) => r.findings.some((f) => f.serious))
  const byCls: Record<string, number> = {}
  for (const r of serious) for (const f of r.findings.filter((x) => x.serious)) byCls[f.cls] = (byCls[f.cls] || 0) + 1
  const graderSerious = rows.filter((r) => !r.findings.some((f) => f.serious) && r.grader?.verdict === 'serious')
  const meta = { agent: pack.agent.name, agentVersion: agent.version, model, runs, items: items.length, replies: rows.length, serious: serious.length, byClass: byCls, graderSerious: graderSerious.length, costUsd: cost, minutes: Math.round((Date.now() - started) / 60000), finishedAt: new Date().toISOString() }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  writeFileSync(join(dir, `exam-${stamp}.json`), JSON.stringify({ meta, rows }, null, 2))
  writeFileSync(join(dir, `exam-${stamp}.html`), htmlReport(meta, rows))
  console.log(JSON.stringify(meta, null, 2))
  console.log(`Informe: ${join(dir, `exam-${stamp}.html`)}`)
  if (serious.length) process.exitCode = 2
}

if (process.argv[1]?.endsWith('exam.ts')) {
  main()
    .catch((e) => {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
