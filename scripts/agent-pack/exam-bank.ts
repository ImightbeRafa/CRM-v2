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
import { looksLikeDataBlock, scrubChatText } from './chat-scrub'

/** agoMin (C5): minutes before the step's message it was sent (real chats keep their real gaps). */
export type ExamHistoryLine = { direction: 'inbound' | 'outbound'; content: string; agoMin?: number }

/**
 * Sleeping exam C5 (2026-10-18): realistic send times for an item's history (ms), oldest first, all before stepAt.
 * The replay used to put every line 1 min apart, so old, already-answered messages fell inside the 10-min payment-claim
 * look-back of the live turn. Now: a line's own agoMin when the bank has it (real chats); otherwise the customer's
 * unanswered tail (after the store's last message) 1 min apart right before the step, the store's last message 12 min
 * before the step and everything older 3 min apart before that — outside the look-back, like a real chat. Pure.
 */
export function examHistoryTimes(lines: ReadonlyArray<ExamHistoryLine>, stepAt: number): number[] {
  const MIN = 60_000
  const lastOut = lines.map((l) => l.direction).lastIndexOf('outbound')
  const out: number[] = []
  let prev = -Infinity
  lines.forEach((l, i) => {
    let at: number
    if (typeof l.agoMin === 'number' && Number.isFinite(l.agoMin) && l.agoMin > 0) at = stepAt - l.agoMin * MIN
    else if (i > lastOut) at = stepAt - (lines.length - i) * MIN
    else at = stepAt - (12 + (lastOut - i) * 3) * MIN
    // Never out of order and never at / after the step itself.
    at = Math.min(Math.max(at, prev + 1_000), stepAt - 1_000)
    prev = at
    out.push(at)
  })
  return out
}
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
const ADDRESS_WORDS = /\b(calle|avenida|ave\.?|casa|frente|metros|esquina|barrio|residencial|condominio|apartamento|apto|del\s+(?:palo|super|parque|iglesia)|\d{2,3}\s?m(?:ts)?\b|norte|sur|este|oeste|varas|port[oó]n|contiguo|diagonal|costado)/giu

/** Removes customer data. A message that is mostly an address/data block becomes one synthetic data block. */
/** Unicode-aware word edges ("\b" is ASCII-only: "José" / "Ángela" slipped through — SecureDog). */
const L_BEFORE = String.raw`(?<![\p{L}\p{N}])`
const L_AFTER = String.raw`(?![\p{L}\p{N}])`

/** The store's own SINPE / IBAN (from the pack): kept in store / agent text so the reviewer sees the real number. */
let STORE_NUMBERS: RegExp[] = []
export function setStoreNumbers(values: Array<string | null | undefined>): void {
  STORE_NUMBERS = values
    .map((v) => String(v || '').replace(/[\s-]/g, ''))
    .filter((v) => v.length >= 8)
    .map((v) => new RegExp(v.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]?'), 'gi'))
}

export function redactCustomerText(text: string, peerName?: string | null, opts: { store?: boolean } = {}): string {
  if (opts.store && STORE_NUMBERS.length) {
    // Park the store's own numbers behind tokens the scrubbers never touch, then put them back.
    const kept: string[] = []
    let parked = text || ''
    for (const re of STORE_NUMBERS) parked = parked.replace(re, (m) => `⟦${kept.push(m) - 1}⟧`)
    if (kept.length) return redactCustomerTextInner(parked, peerName, opts).replace(/⟦(\d+)⟧/g, (_m, i: string) => kept[Number(i)])
  }
  return redactCustomerTextInner(text, peerName, opts)
}

function redactCustomerTextInner(text: string, peerName: string | null | undefined, opts: { store?: boolean }): string {
  let t = redactSensitiveForProvider(text || '')
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
  t = t.replace(/(?<![\p{L}\p{N}])@[\w.]{2,30}/gu, '[usuario]')
  // Phones, cédulas, accounts — also written with dots ("8888.8888", "1.1234.0567").
  // One line only, and never right after "₡": a price list on separate lines ("₡52 250 / - 2 combos") is not a phone.
  t = t.replace(/(?<![₡\d])\+?\d[\d \t.-]{6,}\d/g, '[número]')
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
  // DATA-65: greeted names, links and tracking numbers too (same scrubber as export-chats).
  t = scrubChatText(t, { collapseDataBlocks: false, tidy: false, keepStoreLinks: opts.store })
  // Judged on the ORIGINAL text: the '[nombre]' placeholder must never count as a data-form label.
  const original = text || ''
  const addressHits = (original.match(ADDRESS_WORDS) || []).length
  const dataLabels = (original.match(/(?<![\p{L}\p{N}])(nombre( completo)?|tel[eé]fono|celular|provincia|cant[oó]n|distrito|direcci[oó]n|señas|correo)(?![\p{L}\p{N}])/giu) || []).length
  // A store / agent message is never a customer's data block: its data list ("Nombre completo / Teléfono / Provincia…")
  // stays readable (the reviewer must see what the agent asked); names, numbers and links are still masked above.
  if (opts.store) return t
  if (dataLabels >= 2 || addressHits >= 2 || (addressHits >= 1 && /\[número\]/.test(t)) || looksLikeDataBlock(original, t)) return SYNTHETIC_DATA
  return t
}

/** The reviewer gets a neutral note instead of the synthetic address (it judged the agent against "Cartago, Oreamuno"). */
export function redactCustomerForReviewer(text: string): string {
  const t = redactCustomerText(text)
  return t === SYNTHETIC_DATA ? '[el cliente mandó sus datos de envío: nombre, teléfono, provincia, cantón, distrito y dirección]' : t
}

/**
 * Reviewer input ("CLIENTE: …" / "AGENTE: …" / "TIENDA: …" lines): redacted line by line, so one customer data block
 * becomes the synthetic block on its own line instead of wiping the whole chat, and store lines keep their data list.
 */
export function redactChatForReviewer(chat: string): string {
  // A message can span lines: lines without a "WHO:" prefix belong to the message above.
  const entries: Array<{ who: string; text: string }> = []
  for (const line of (chat || '').split('\n')) {
    const m = /^(CLIENTE|AGENTE|TIENDA|EQUIPO):\s?(.*)$/.exec(line)
    if (m) entries.push({ who: m[1], text: m[2] })
    else if (entries.length) entries[entries.length - 1].text += `\n${line}`
    else entries.push({ who: 'CLIENTE', text: line })
  }
  return entries.map((e) => `${e.who}: ${e.who === 'CLIENTE' ? redactCustomerForReviewer(e.text) : redactCustomerText(e.text, null, { store: true })}`).join('\n')
}

const ASKS_PERSON = /\b(asesor|asesora|persona|humano|alguien que me atienda|hablar con alguien|agente)\b/iu
const PAYMENT_WORDS = /\b(pagu[eé]|pag[oó]|comprobante|sinpe|transferencia|transfer[ií]|deposit)/iu
const COMPLAINT_WORDS = /\b(reclamo|devoluci|reembolso|no me lleg[oó]|estafa|queja|mal estado|roto)\b/iu
// luna-10 exam round 2: alarm symptoms, partnership / event proposals and reseller pricing are rightly handed off.
const HANDOFF_OK_WORDS =
  /(?<![\p{L}])(?:palpitaci\p{L}*|dolor\s+de\s+pecho|desmay\p{L}*|falta\s+de\s+aire|convulsi\p{L}*|alergi\p{L}*|cofundador\p{L}*|fundador\p{L}*|colaboraci\p{L}*|alianza|propuesta|patrocin\p{L}*|evento|vendedor\p{L}*|revend\p{L}*|mayoreo|al\s+por\s+mayor|distribu\p{L}*|expreso|expr[eé]s|express|urgente)(?![\p{L}])/iu
const QUESTION_HINT = /\?|^(qu[eé]|c[oó]mo|cu[aá]nto|cu[aá]l|d[oó]nde|tienen|hacen|puedo|se puede|sirve|info|precio|me regala)/iu

const ORDER_ALREADY_IN =
  /pedido fue ingresado|sinpe fue confirmado|n[uú]mero de pedido|#ORD-|gu[ií]a\s*PY|su pedido/iu
const ORDER_STATUS_ASK = /llegar[ií]a|cu[aá]ndo lleg|estado (del|de mi|de su)? ?pedido|gu[ií]a/iu

/** What a real customer message must produce (only what is certain; the rest is judged by the grader). */
export function expectForRealMessage(
  text: string,
  history: Array<{ direction: string; content: string }> = [],
): ScenarioStep['expect'] {
  if (ASKS_PERSON.test(text)) return { handoff: true }
  const prior = history.map((h) => h.content).join('\n')
  if (ORDER_ALREADY_IN.test(prior) && ORDER_STATUS_ASK.test(text)) return { handoff: true }
  if (PAYMENT_WORDS.test(text) || COMPLAINT_WORDS.test(text) || text === SYNTHETIC_DATA) return {}
  if (HANDOFF_OK_WORDS.test(text)) return {}
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
      select: { direction: true, content: true, sentAt: true },
      take: 200,
    })
    const lines = msgs
      .map((m) => ({ direction: (m.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound', content: redactCustomerText(m.content || '', c.peerName), at: m.sentAt.getTime() }))
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
        // C5: the real gaps (minutes before this message), so the replay sees the same 10-min look-back as live.
        history: lines.slice(Math.max(0, i - 6), i).map((h) => ({ direction: h.direction, content: h.content, agoMin: Math.max(0.1, Math.round((m.at - h.at) / 6_000) / 10) })),
        steps: [{ text: m.content, expect: expectForRealMessage(m.content, lines.slice(Math.max(0, i - 6), i)) }],
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
