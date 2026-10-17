/**
 * Burst = one reply (2026-10-17): plays real-looking customer bursts (2–3 bubbles within seconds) through the real
 * test-chat engine (runAgentTestTurn — sandbox: nothing is sent, no order / stock / guía) and checks the one reply the
 * burst gets. Same guard as the exam / silent trial (withExamSession: AI terms, kill switch, owner/admin actor, audited
 * test-cap raise restored on exit).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/burst-probar.ts --pack=<carpeta> [--ig=<instagram socialAccountId>] [--cap=1500000]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { evaluateStep } from '@/lib/soft-ai/probar-scenarios'
import { LUNA_CHAT_AGENT_MODEL } from '@/lib/soft-ai/agent-types'
import { arg, loadPack } from './pack'
import { codeChecks } from './exam'
import { withExamSession } from './test-session'

type Bubble = { text: string; type?: 'text' | 'image' | 'audio' | 'document' | 'video'; ago: number }
type Case = {
  id: string
  title: string
  channel: 'wa' | 'ig'
  /** Earlier bubbles of the burst (seconds before the last one), oldest first. */
  before: Bubble[]
  last: Bubble
  expect: {
    handoff?: 'handoff' | 'review' | 'none'
    burstReview?: boolean
    notMatch?: RegExp[]
    match?: RegExp[]
    /** The burst step the trace must show (inbound-burst plan reason / model routing). */
    step?: string
  }
}

const MEDIA_ASK = /por escrito/i
const CASES: Case[] = [
  {
    id: 'ig-ad',
    title: 'Anuncio IG: post compartido + "¡Hola! Quiero más información."',
    channel: 'ig',
    before: [{ text: '[ig_post] https://www.instagram.com/p/patchhouse-glp1', ago: 1 }],
    last: { text: '¡Hola! Quiero más información.', ago: 0 },
    expect: { handoff: 'none', notMatch: [MEDIA_ASK] },
  },
  {
    id: 'top-glp1',
    title: '"Top" + "GLP1" (no preguntar cuál le interesa)',
    channel: 'ig',
    before: [{ text: 'Top', ago: 4 }],
    last: { text: 'GLP1', ago: 0 },
    expect: { handoff: 'none', notMatch: [/cu[aá]l te interesa/i, MEDIA_ASK], match: [/glp/i] },
  },
  {
    id: 'price-photo',
    title: 'User 722630: "Que costo tiene" + foto',
    channel: 'wa',
    before: [{ text: 'Que costo tiene', ago: 3 }],
    last: { text: '[image]', type: 'image', ago: 0 },
    expect: { notMatch: [MEDIA_ASK], burstReview: true, step: 'media_with_text' },
  },
  {
    id: 'photo-price',
    title: 'Foto + "¿Cuánto cuesta este?"',
    channel: 'wa',
    before: [{ text: '[image]', type: 'image', ago: 3 }],
    last: { text: '¿Cuánto cuesta este?', ago: 0 },
    expect: { notMatch: [MEDIA_ASK], burstReview: true, step: 'text_with_media' },
  },
  {
    id: 'person-please',
    title: '"Quiero hablar con una persona" + "por favor"',
    channel: 'wa',
    before: [{ text: 'Quiero hablar con una persona', ago: 2 }],
    last: { text: 'por favor', ago: 0 },
    expect: { handoff: 'handoff' },
  },
  {
    id: 'stop-hola',
    title: '"STOP" + "hola"',
    channel: 'ig',
    before: [{ text: 'STOP', ago: 2 }],
    last: { text: 'hola', ago: 0 },
    expect: { handoff: 'handoff' },
  },
  {
    id: 'order-howpay',
    title: '"Quiero 2 del GLP-1 con envío a Limón" + "¿Cómo pago?" (las dos respondidas)',
    channel: 'wa',
    before: [{ text: 'Quiero 2 del GLP-1 con envío a Limón', ago: 3 }],
    last: { text: '¿Cómo pago?', ago: 0 },
    expect: { notMatch: [MEDIA_ASK], step: 'burst_model' },
  },
  {
    id: 'hola-howpay',
    title: '"Hola" + "¿Cómo pago?" (respuesta fija de métodos)',
    channel: 'wa',
    before: [{ text: 'Hola', ago: 2 }],
    last: { text: '¿Cómo pago?', ago: 0 },
    expect: { handoff: 'none', notMatch: [MEDIA_ASK] },
  },
  {
    id: 'paid-thanks',
    title: '"Ya te hice el sinpe" + "gracias" (pago → persona)',
    channel: 'wa',
    before: [{ text: 'Ya te hice el sinpe', ago: 2 }],
    last: { text: 'gracias', ago: 0 },
    expect: { handoff: 'handoff' },
  },
  {
    id: 'audio-only',
    title: 'Solo un audio (igual que hoy: por escrito + revisión)',
    channel: 'ig',
    before: [],
    last: { text: '[audio]', type: 'audio', ago: 0 },
    expect: { match: [MEDIA_ASK], handoff: 'review' },
  },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function main() {
  const { pack, dir } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const wa = pack.target.socialAccountIds[0]
  const ig = arg('ig')
  const cap = Number(arg('cap') || 1_500_000)
  const forbid = ((pack as unknown as { exam?: { forbid?: Array<{ re: string; why: string }> } }).exam?.forbid) ?? []
  const agent = await prisma.chatAgent.findFirst({ where: { tenantId, name: pack.agent.name, status: { not: 'archived' } }, select: { id: true, version: true } })
  const user = await prisma.user.findUnique({ where: { email: pack.target.actorEmail }, select: { id: true } })
  if (!agent || !user || !wa) throw new Error('Agente, usuario o canal del pack no encontrado')
  if (ig && !(await prisma.socialAccount.findFirst({ where: { id: ig, tenantId, platform: 'instagram' }, select: { id: true } }))) {
    throw new Error('--ig no es un canal de Instagram de este negocio')
  }

  type Row = { c: Case; reply: string; handoff: string | null; burstSteps: string[]; failures: string[]; cost: number }
  const rows: Row[] = []
  await withExamSession({ tenantId, actorEmail: pack.target.actorEmail, cap, label: 'exam' }, async () => {
    for (const c of CASES) {
      const account = c.channel === 'ig' && ig ? ig : wa
      const now = Date.now()
      const history = [
        { direction: 'outbound' as const, content: '¡Hola! Soy Sofi de PatchHouse 😊 ¿En qué te ayudo?', sentAt: new Date(now - 3_600_000).toISOString(), messageType: 'text' },
        ...c.before.map((b) => ({ direction: 'inbound' as const, content: b.text, sentAt: new Date(now - b.ago * 1000).toISOString(), messageType: b.type || 'text' })),
      ]
      const r = await runAgentTestTurn({
        tenantId,
        agentId: agent.id,
        inboundText: c.last.text,
        messageType: c.last.type || 'text',
        socialAccountId: account,
        actorUserId: user.id,
        testSessionId: randomUUID(),
        history,
        customerName: 'Cliente',
        modelOverride: LUNA_CHAT_AGENT_MODEL,
        usageFeature: 'agent_test',
      })
      const steps = ((r.decisionTrace as { steps?: Array<{ step: string; outcome?: string; reason?: string }> } | null)?.steps ?? [])
      const burstSteps = steps.filter((s) => s.step === 'burst' || s.step === 'burst_model').map((s) => `${s.step}:${s.outcome ?? ''}${s.reason ? `:${s.reason}` : ''}`)
      const failures: string[] = []
      const kind = r.handoff?.kind ?? 'none'
      if (c.expect.handoff && c.expect.handoff !== kind) failures.push(`esperaba ${c.expect.handoff}, salió ${kind}`)
      if (c.expect.burstReview && !(r.handoff?.kind === 'review' || r.handoff?.kind === 'handoff')) failures.push('esperaba revisión de la foto')
      for (const re of c.expect.notMatch ?? []) if (re.test(r.text)) failures.push(`no debía decir ${re}`)
      for (const re of c.expect.match ?? []) if (!re.test(r.text)) failures.push(`debía decir ${re}`)
      if (c.expect.step && !burstSteps.some((s) => s.includes(c.expect.step!))) failures.push(`falta el paso ${c.expect.step} (${burstSteps.join(', ') || 'ninguno'})`)
      for (const f of codeChecks({ reply: r.text, customer: [...c.before.map((b) => b.text), c.last.text].join('\n'), evaluation: evaluateStep(r, {}), handoff: r.handoff, fallbackUsed: r.fallbackUsed, night: false, forbid, silentExpected: false })) {
        if (f.serious) failures.push(`grave: ${f.why}`)
      }
      if (r.blockedBy?.includes('test_budget_blocked')) failures.push('sin presupuesto de pruebas: no corrió')
      rows.push({ c, reply: r.text, handoff: r.handoff ? `${r.handoff.kind}:${r.handoff.reason}` : null, burstSteps, failures, cost: r.estimatedCostUsd || 0 })
      process.stdout.write(failures.length ? '✖' : '·')
    }
  })
  process.stdout.write('\n')
  const failed = rows.filter((r) => r.failures.length)
  const meta = { cases: rows.length, passed: rows.length - failed.length, failed: failed.length, costUsd: rows.reduce((s, r) => s + r.cost, 0), agentVersion: agent.version, finishedAt: new Date().toISOString() }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  writeFileSync(join(dir, `burst-probar-${stamp}.json`), JSON.stringify({ meta, rows: rows.map((r) => ({ ...r, c: { id: r.c.id, title: r.c.title, channel: r.c.channel, before: r.c.before, last: r.c.last } })) }, null, 2))
  const tr = (r: Row) => `<tr class="${r.failures.length ? 'bad' : 'ok'}"><td>${esc(r.c.title)}<br><small>${r.c.channel.toUpperCase()}</small></td><td>${[...r.c.before, r.c.last].map((b) => esc(b.text)).join('<br>')}</td><td>${esc(r.reply).replace(/\n/g, '<br>')}${r.handoff ? `<br><small>→ persona (${esc(r.handoff)})</small>` : ''}</td><td><small>${esc(r.burstSteps.join(' · ') || '—')}</small></td><td>${r.failures.length ? r.failures.map(esc).join('<br>') : '✓'}</td></tr>`
  writeFileSync(
    join(dir, `burst-probar-${stamp}.html`),
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ráfagas en Probar</title><style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}tr.bad{background:#fde8e8}</style></head><body><h1>Ráfagas en Probar · ${meta.passed}/${meta.cases} bien</h1><table><tr><th>Caso</th><th>Cliente (ráfaga)</th><th>Sofi respondió (una vez)</th><th>Plan de la ráfaga</th><th>Resultado</th></tr>${rows.map(tr).join('')}</table></body></html>`,
  )
  console.log(JSON.stringify(meta, null, 2))
  for (const r of rows) console.log(`${r.failures.length ? '✖' : '✓'} ${r.c.id} | ${r.handoff ?? 'sin hand-off'} | ${r.burstSteps.join(' ') || '-'}\n   ${r.reply.replace(/\n/g, ' / ').slice(0, 260)}${r.failures.length ? `\n   FALLA: ${r.failures.join('; ')}` : ''}`)
  console.log(`Informe: ${join(dir, `burst-probar-${stamp}.html`)}`)
}

if (process.argv[1]?.endsWith('burst-probar.ts')) {
  main()
    .catch((e) => {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
