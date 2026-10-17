/**
 * luna-10 exam (Stage 2): builds the question bank for a business from its REAL chats + the pack's own tests +
 * knowledge coverage + the live failures written in the pack (pack.exam.failures). Read-only on the database.
 * Customer data is removed before anything is written (names, phones, emails, addresses → placeholders; Ley 8968).
 * The bank is written next to the pack (outside the repo).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/exam-bank.ts --pack=<carpeta del pack> [--accounts=id1,id2] [--max-real=160]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { coverageScenarios } from '@/lib/soft-ai/knowledge-coverage'
import type { ScenarioStep } from '@/lib/soft-ai/probar-scenarios'
import { normalizeForRepeat } from '@/lib/soft-ai/repeat-guard'
import { redactSensitiveForProvider } from '@/lib/soft-ai/llm/redact'
import { arg, loadPack } from './pack'

export type ExamHistoryLine = { direction: 'inbound' | 'outbound'; content: string }
export type ExamItem = {
  id: string
  source: 'real' | 'pack' | 'coverage' | 'failure' | 'night'
  title: string
  history: ExamHistoryLine[]
  steps: ScenarioStep[]
  /** Run with "Simular fuera de horario" (night mode). */
  night?: boolean
}
export type ExamBank = { builtAt: string; pack: string; items: ExamItem[] }

const SYNTHETIC_DATA = 'María Pérez Solís\n8888-0000\nCartago, Oreamuno, San Rafael\n200 m norte de la iglesia, casa blanca'
const ADDRESS_WORDS = /\b(calle|avenida|ave\.?|casa|frente|metros|esquina|barrio|residencial|condominio|apartamento|apto|del\s+(?:palo|super|parque|iglesia)|\d{2,3}\s?m(?:ts)?\b)/giu

/** Removes customer data. A message that is mostly an address/data block becomes one synthetic data block. */
/** Unicode-aware word edges ("\b" is ASCII-only: "José" / "Ángela" slipped through — SecureDog). */
const L_BEFORE = String.raw`(?<![\p{L}\p{N}])`
const L_AFTER = String.raw`(?![\p{L}\p{N}])`

export function redactCustomerText(text: string, peerName?: string | null): string {
  let t = redactSensitiveForProvider(text || '')
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
  t = t.replace(/(?<![\p{L}\p{N}])@[\w.]{2,30}/gu, '[usuario]')
  // Phones, cédulas, accounts — also written with dots ("8888.8888", "1.1234.0567").
  t = t.replace(/\+?\d[\d\s.-]{6,}\d/g, '[número]')
  t = t.replace(/\bCR\d{2}[\d\s]{10,}\b/gi, '[cuenta]')
  for (const w of String(peerName || '').split(/\s+/).filter((x) => x.length >= 3)) {
    t = t.replace(new RegExp(`${L_BEFORE}${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${L_AFTER}`, 'giu'), '[nombre]')
  }
  // "Soy Ana", "me llamo maria fernanda rodriguez", "mi nombre es …": up to 4 words after it are a name (any case).
  t = t.replace(/(?<![\p{L}\p{N}])(soy|me llamo|mi nombre es|a nombre de)\s+((?:[\p{L}'-]+\s?){1,4})/giu, (_m, intro: string, words: string) => {
    // "soy de Cartago", "soy cliente": the next word is not a name.
    if (/^(de|del|la|el|una?|cliente|nuev[oa]|mayor|menor|estudiante|al[eé]rgic[oa])\b/iu.test(words)) return `${intro} ${words}`
    return `${intro} [nombre] `
  })
  // Judged on the ORIGINAL text: the '[nombre]' placeholder must never count as a data-form label.
  const original = text || ''
  const addressHits = (original.match(ADDRESS_WORDS) || []).length
  const dataLabels = (original.match(/(?<![\p{L}\p{N}])(nombre( completo)?|tel[eé]fono|celular|provincia|cant[oó]n|distrito|direcci[oó]n|señas|correo)(?![\p{L}\p{N}])/giu) || []).length
  if (dataLabels >= 2 || addressHits >= 2 || (addressHits >= 1 && /\[número\]/.test(t))) return SYNTHETIC_DATA
  return t
}

const ASKS_PERSON = /\b(asesor|asesora|persona|humano|alguien que me atienda|hablar con alguien|agente)\b/iu
const PAYMENT_WORDS = /\b(pagu[eé]|pag[oó]|comprobante|sinpe|transferencia|transfer[ií]|deposit)/iu
const COMPLAINT_WORDS = /\b(reclamo|devoluci|reembolso|no me lleg[oó]|estafa|queja|mal estado|roto)\b/iu
const QUESTION_HINT = /\?|^(qu[eé]|c[oó]mo|cu[aá]nto|cu[aá]l|d[oó]nde|tienen|hacen|puedo|se puede|sirve|info|precio|me regala)/iu

/** What a real customer message must produce (only what is certain; the rest is judged by the grader). */
export function expectForRealMessage(text: string): ScenarioStep['expect'] {
  if (ASKS_PERSON.test(text)) return { handoff: true }
  if (PAYMENT_WORDS.test(text) || COMPLAINT_WORDS.test(text) || text === SYNTHETIC_DATA) return {}
  if (QUESTION_HINT.test(text.trim())) return { handoff: false }
  return {}
}

async function main() {
  const { pack, dir } = loadPack(arg('pack') || '')
  const tenantId = pack.target.tenantId
  const maxReal = Number(arg('max-real') || 160)
  let accounts = (arg('accounts') || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!accounts.length) accounts = pack.target.socialAccountIds
  const items: ExamItem[] = []
  const seen = new Set<string>()

  // ---- Real chats: every customer text message, with the 6 messages before it as history.
  const convs = await prisma.chatConversation.findMany({
    where: { tenantId, socialAccountId: { in: accounts } },
    select: { id: true, peerName: true },
    orderBy: { lastInboundAt: 'desc' },
    take: 400,
  })
  for (const c of convs) {
    const msgs = await prisma.chatMessage.findMany({
      where: { tenantId, conversationId: c.id, messageType: 'text' },
      orderBy: { sentAt: 'asc' },
      select: { direction: true, content: true },
      take: 200,
    })
    const lines = msgs
      .map((m) => ({ direction: (m.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound', content: redactCustomerText(m.content || '', c.peerName) }))
      .filter((m) => m.content.trim())
    lines.forEach((m, i) => {
      if (m.direction !== 'inbound' || items.filter((x) => x.source === 'real').length >= maxReal) return
      const key = normalizeForRepeat(m.content)
      if (key.length < 2 || seen.has(key)) return
      seen.add(key)
      items.push({
        id: `real-${items.length + 1}`,
        source: 'real',
        title: `Chat real: ${m.content.slice(0, 60).replace(/\n/g, ' ')}`,
        history: lines.slice(Math.max(0, i - 6), i),
        steps: [{ text: m.content, expect: expectForRealMessage(m.content) }],
      })
    })
  }

  // ---- The pack's own tests, knowledge coverage, live failures, night variants.
  for (const t of pack.tests) items.push({ id: `pack-${items.length + 1}`, source: 'pack', title: t.title, history: [], steps: t.steps })
  for (const t of coverageScenarios(pack.inventory.names)) items.push({ id: `cov-${items.length + 1}`, source: 'coverage', title: t.title, history: [], steps: t.steps })
  const examCfg = (pack as unknown as { exam?: { failures?: Array<{ title: string; history?: ExamHistoryLine[]; steps: ScenarioStep[] }>; night?: Array<{ title: string; steps: ScenarioStep[] }> } }).exam
  for (const f of examCfg?.failures ?? []) items.push({ id: `fail-${items.length + 1}`, source: 'failure', title: f.title, history: f.history ?? [], steps: f.steps })
  for (const n of examCfg?.night ?? []) items.push({ id: `night-${items.length + 1}`, source: 'night', title: n.title, history: [], steps: n.steps, night: true })

  const bank: ExamBank = { builtAt: new Date().toISOString(), pack: pack.agent.name, items }
  const out = join(dir, 'exam-bank.json')
  writeFileSync(out, JSON.stringify(bank, null, 2))
  const by = (s: ExamItem['source']) => items.filter((i) => i.source === s).length
  console.log(`Banco: ${items.length} preguntas (reales ${by('real')}, pack ${by('pack')}, cobertura ${by('coverage')}, fallas ${by('failure')}, noche ${by('night')}) → ${out}`)
}

if (process.argv[1]?.endsWith('exam-bank.ts')) {
  main()
    .catch((e) => {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
