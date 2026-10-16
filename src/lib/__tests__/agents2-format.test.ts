/**
 * agents2-format (Rafael 2026-10-16): readable replies — separate short messages, data as a vertical list, payment by
 * FIRST asking the method and THEN sending only that method's details. Pure helpers + source asserts; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-format.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseBrandFacts, paymentFactsForPrompt, replyStyleSnippet, DEFAULT_REPLY_STYLE, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import {
  applyFinalOutputPolicy,
  brandFactsLinkAllowlist,
  messageLineCount,
  shortenToMaxLines,
  unjoinDotSeparated,
  validateAgentOutput,
} from '@/lib/soft-ai/llm/output-validator'
import { fillPaymentToken, paymentDetailsText, paymentMethodBlock, paymentNumberProblems } from '@/lib/soft-ai/payment-guard'
import { joinReplyParts, planReplyParts, replyPartsOf, splitReplyParts, MAX_REPLY_PARTS } from '@/lib/soft-ai/reply-parts'
import {
  awaitingPaymentMethodChoice,
  deriveSalesState,
  formatSalesTurnBlock,
  parsePaymentMethodChoice,
  salesAwaitingReceipt,
  salesCloseWithoutPaymentData,
  salesMethodQuestion,
  salesNeedsHuman,
  salesPaymentOptions,
  salesSystemBlock,
  type SalesContext,
} from '@/lib/soft-ai/sales-state'
import { decideInbound, paymentChoiceReply } from '@/lib/soft-ai/inbound-decision'
import { RESERVED_SHORTCUT_SEEDS, SALES_REPLY_TEMPLATES, upgradeLegacyShortcutBody, PAYMENT_INFO_BODY, renderShortcutTemplate } from '@/lib/soft-ai/shortcuts'
import { HANDOFF_REASON, planModelTurnDelivery } from '@/lib/soft-ai/agent-turn-outcome'
import { ownerTextProblem, checkCorrectionText } from '@/lib/soft-ai/agent-tuning-core'
import { isCueFreePaymentChoiceText } from '@/lib/soft-ai/payment-classifier'
import { IMMUTABLE_SAFETY_POLICY } from '@/lib/soft-ai/llm/prompt'
import { generateAgentSuite, AGENT_RULES_VERSION } from '@/lib/soft-ai/test-engine/generate'
import { asksPaymentMethod, checkExpect } from '@/lib/soft-ai/test-engine/grade'

const read = (p: string) => readFileSync(p, 'utf8')
const sha = (t: string) => createHash('sha256').update(t).digest('hex')

/** PatchHouse-like data (generic: no business is hardcoded in code, only here as a fixture). */
const FACTS: BrandFacts = parseBrandFacts({
  website: 'https://tienda.example.cr',
  shipping: { contraEntrega: { enabled: true, text: 'Pagás al recibir, al mensajero (SINPE o efectivo exacto). Solo dentro del GAM.' } },
  payment: {
    shareWithCustomers: true,
    methods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'],
    sinpe: { number: '62019914', holderName: 'Rafael García' },
    transfer: { bank: 'BAC', iban: 'CR05015202001026284066', holderName: 'Rafael Alberto García Montoya' },
  },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const CTX: SalesContext = {
  catalog: [{ name: 'GLP-1', price: 15900, stockLabel: 'disponible' }],
  shippingMethods: [{ name: 'Correos', price: 5000, coverage: 'todo el país', cod: 'solo GAM' }],
  orderFields: ['Nombre', 'Teléfono'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['62019914'],
  promo: null,
  bundles: [{ name: 'GLP-1 + Focus', price: 15900, shippingIncluded: false }],
  paymentMethods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'],
  cardOnWeb: true,
}
const msg = (direction: 'inbound' | 'outbound', content: string) => ({ id: `${direction}-${content.length}`, direction, content, sentAt: '' })

/** The live test's model reply, in the new format (what the prompt asks for). */
const CLOSE_REPLY = [
  'El combo GLP-1 + Focus con envío a Cartago queda en ₡20 900 🌿',
  'Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Correo\n- Dirección exacta (provincia, cantón y distrito)',
  '¿Cómo preferís pagar? Tenemos SINPE Móvil, tarjeta (en la web) y contra entrega (solo GAM).',
].join('\n\n')

describe('1. multi-message replies', () => {
  it('splits at blank lines, keeps single line breaks, caps at 3 (extra paragraphs merge into the last)', () => {
    assert.deepEqual(splitReplyParts('Hola 😊'), ['Hola 😊'])
    assert.deepEqual(splitReplyParts('a\nb\n\nc'), ['a\nb', 'c'])
    assert.deepEqual(splitReplyParts('a\r\n\r\n  \r\nb'), ['a', 'b'])
    assert.equal(MAX_REPLY_PARTS, 3)
    assert.deepEqual(splitReplyParts('1\n\n2\n\n3\n\n4\n\n5'), ['1', '2', '3\n\n4\n\n5'])
    assert.deepEqual(splitReplyParts(''), [])
  })
  it('the close goes out as 3 short messages, every check ran on the whole text first', () => {
    const p = applyFinalOutputPolicy({ text: CLOSE_REPLY, brandFacts: FACTS, skipPurchaseSummary: true, quoteAmounts: [20900], shortenLongReply: true })
    assert.equal(p.ok, true, p.reasons.join(','))
    assert.deepEqual(p.parts, CLOSE_REPLY.split('\n\n'))
    assert.equal(p.parts.join('\n\n'), p.text)
  })
  it('a payment block stays whole in one message (blocks never contain a blank line)', () => {
    const p = applyFinalOutputPolicy({ text: 'Perfecto 🙌 [[PAGO_SINPE]]\n\nCuando lo hagás, mandame el comprobante 😊', brandFacts: FACTS })
    assert.deepEqual(p.parts, ['Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García', 'Cuando lo hagás, mandame el comprobante 😊'])
    const all = applyFinalOutputPolicy({ text: 'Te paso todo:\n\n[[DATOS_PAGO]]\n\n¿Me avisás?', brandFacts: FACTS })
    assert.equal(all.parts.length, 3)
    assert.match(all.parts[1], /^SINPE Móvil: 6201 9914\nA nombre de: Rafael García\nTransferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66\n/)
    assert.doesNotMatch(paymentDetailsText(FACTS), /\n\s*\n/)
  })
  it('code-sent saved replies use the same split (sys_payment_info → method list + question)', () => {
    const d = decideInbound({ inboundText: '¿cómo puedo pagar?', brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.deepEqual(splitReplyParts(d.text), ['Podés pagar con:\n- SINPE Móvil\n- Transferencia\n- Tarjeta (en la web)\n- Contra entrega (solo GAM)', '¿Cómo preferís pagar?'])
  })
  it('send loop: part 0 keeps the turn key + hash, parts 1..n get :pN keys with their own hash', () => {
    const plan = planReplyParts({ text: 'a\n\nb\n\nc', deliveryKey: 'msg:1', contentHash: 'H0', hash: sha })
    assert.deepEqual(plan.map((p) => [p.index, p.deliveryKey, p.contentHash, p.text]), [
      [0, 'msg:1', 'H0', 'a'],
      [1, 'msg:1:p1', sha('b'), 'b'],
      [2, 'msg:1:p2', sha('c'), 'c'],
    ])
    assert.deepEqual(planReplyParts({ text: 'solo uno', deliveryKey: 'k', contentHash: 'H', hash: sha }).map((p) => p.deliveryKey), ['k'])
  })
  it('send loop (source): sequential, awaited, gap + deadline, ambiguous part stops, one ChatMessage per part', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(turn, /planReplyParts\(\{ text: input\.outputText, deliveryKey: input\.row\.deliveryKey, contentHash, hash: hashSoftAiDeliveryContent \}\)/)
    assert.match(turn, /for \(const part of partsPlan\) \{/)
    assert.match(turn, /if \(Date\.now\(\) \+ REPLY_PART_GAP_MS > partsDeadlineAt\) \{\s*partial = true\s*break/)
    assert.match(turn, /setTimeout\(resolve, REPLY_PART_GAP_MS\)/)
    assert.match(turn, /deliveryKey: part\.deliveryKey,\s*kind: 'text',\s*contentHash: part\.contentHash,/)
    assert.match(turn, /if \(part\.index === 0\) throw error[\s\S]{0,300}partial = true\s*break/)
    assert.match(turn, /content: part\.text,/)
    assert.match(turn, /\.\.\.\(part\.index === 0 \? \{ toolTrace: input\.toolTrace \} : \{\}\)/)
    assert.match(turn, /partIndex: part\.index,\s*partCount: partsPlan\.length,/)
    assert.match(turn, /errorCode: 'partial_delivery'/)
    // Images still go before the text; a re-run checks the FIRST part's claim.
    assert.ok(turn.indexOf('await sendAgentImagesOnce(') < turn.indexOf('for (const part of partsPlan)'))
    assert.match(turn, /jobId_deliveryKey: \{ jobId: input\.row\.id, deliveryKey: input\.row\.deliveryKey \}/)
    const parts = read('src/lib/soft-ai/reply-parts.ts')
    assert.match(parts, /REPLY_PART_GAP_MS = 700/)
    assert.match(parts, /AGENT_PARTS_DEADLINE_MS = 33_000/)
  })
  it('Probar returns parts and shows one bubble per part with one tune target', () => {
    assert.deepEqual(replyPartsOf({ text: 'a\n\nb', parts: ['a', 'b'] }), ['a', 'b'])
    assert.deepEqual(replyPartsOf({ text: 'a\n\nb' }), ['a', 'b'])
    assert.deepEqual(replyPartsOf({ text: 'x', parts: [1, null] }), ['x'])
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(turn, /parts: text \? splitReplyParts\(text\) : \[\],/)
    assert.match(turn, /text: '',\s*parts: \[\],/)
    const ui = read('src/app/config/agentes/AgentTestSandbox.tsx')
    assert.match(ui, /const parts = replyPartsOf\(data\)/)
    assert.match(ui, /turnText: outbound,/)
    assert.match(ui, /isLastPart\(bubble\)/)
    assert.match(ui, /agentReply=\{bubble\.turnText \?\? bubble\.text\}/)
    assert.match(ui, /images: index === 0 && images\.length \? images : undefined/)
  })
  it('Corregir in a real chat joins the parts of the same turn in partIndex order', () => {
    const meta = (partIndex: number, agentId = 'ag1') => ({ softAi: true, agentId, turnId: 't1', partIndex, partCount: 3 })
    const rows = [
      { content: 'tercero', metadata: meta(2) },
      { content: 'primero', metadata: meta(0) },
      { content: 'segundo', metadata: meta(1) },
      { content: 'primero', metadata: meta(0) },
      { content: 'otro agente', metadata: meta(1, 'ag2') },
    ]
    assert.equal(joinReplyParts(rows, 'ag1'), 'primero\n\nsegundo\n\ntercero')
    const tuning = read('src/lib/soft-ai/agent-tuning.ts')
    assert.match(tuning, /metadata: \{ path: \['turnId'\], equals: meta\.turnId \}/)
    assert.match(tuning, /where: \{ tenantId, conversationId: msg\.conversationId, direction: 'outbound'/)
    assert.match(tuning, /agentReply = joinReplyParts\(/)
  })
})

describe('2. length / style', () => {
  it('the style rule is code-owned in the prompt, the reply style and the sales block', () => {
    const rule = /Separá ideas distintas con una línea en blanco \(cada bloque se envía como un mensaje aparte, máximo 3\)\. Cuando pidas datos o des opciones, usá una lista con guiones/
    assert.match(replyStyleSnippet(DEFAULT_REPLY_STYLE), rule)
    assert.match(salesSystemBlock(CTX), rule)
    assert.match(IMMUTABLE_SAFETY_POLICY, /16\) Formato: Escribí como en WhatsApp/)
    assert.match(IMMUTABLE_SAFETY_POLICY, /Nunca juntes precio, datos del pedido y pago en un solo bloque/)
    for (const src of ['src/lib/soft-ai/sales-state.ts', 'src/lib/soft-ai/brand-facts.ts', 'src/lib/soft-ai/llm/prompt.ts']) {
      assert.doesNotMatch(read(src), /en una sola línea/, src)
    }
    assert.doesNotMatch(replyStyleSnippet(DEFAULT_REPLY_STYLE), /Sin listas largas/)
  })
  it('a dash list counts as one line; maxLines applies per message', () => {
    assert.equal(messageLineCount('Para armar tu pedido pasame:\n- a\n- b\n- c\n- d'), 2)
    assert.equal(messageLineCount('• a\n• b\ntexto\n1. x\n2. y'), 3)
    const style = { ...DEFAULT_REPLY_STYLE, maxLines: 2 }
    // 9 lines in total, but each message is short → fine.
    const ok = validateAgentOutput({ text: CLOSE_REPLY, citedToolNames: [], quoteAmounts: [20900], replyStyle: style })
    assert.equal(ok.reasons.includes('style_too_long'), false)
    const long = validateAgentOutput({ text: 'a\nb\nc\nd\ne\n\nok', citedToolNames: [], replyStyle: style })
    assert.ok(long.reasons.includes('style_too_long'))
  })
  it('a configured payment block counts as the one line its token was', () => {
    const style = { ...DEFAULT_REPLY_STYLE, maxLines: 1 }
    const p = applyFinalOutputPolicy({ text: 'Listo\n[[DATOS_PAGO]]', brandFacts: FACTS, replyStyle: style })
    assert.equal(p.reasons.includes('style_too_long'), false, p.reasons.join(','))
  })
  it('shortening works per message and never drops a list, a ₡ line or a token line', () => {
    const list = 'Hola\nUno\nDos\nTres\nCuatro\nPara el pedido pasame:\n- Nombre\n- Teléfono\n¿Me los pasás?'
    const short = shortenToMaxLines(list, 2)
    assert.match(short, /- Nombre\n- Teléfono/)
    assert.match(short, /¿Me los pasás\?/)
    assert.doesNotMatch(short, /Cuatro/)
    assert.equal(shortenToMaxLines('a\nb\nc\nd\ne\nQueda en ₡15 900', 2), 'a\nb\nc\nd\ne\nQueda en ₡15 900')
    const tok = shortenToMaxLines('a\nb\nc\nd\ne\n[[PAGO_SINPE]]', 1)
    assert.match(tok, /\[\[PAGO_SINPE\]\]/)
    // Short messages are left as they are (same string back).
    assert.equal(shortenToMaxLines(CLOSE_REPLY, 2), CLOSE_REPLY)
    // Each message is judged on its own: the long one is shortened, the others stay.
    const multi = shortenToMaxLines('x\n\na\nb\nc\nd\ne\nf\n\n¿Seguimos?', 2)
    assert.deepEqual(splitReplyParts(multi), ['x', 'a\nb', '¿Seguimos?'])
  })
  it('the " · " joined style is discouraged and unjoined by code (same words)', () => {
    assert.equal(unjoinDotSeparated('SINPE 1 · transferencia BAC · también tarjeta'), 'SINPE 1\ntransferencia BAC\ntambién tarjeta')
    assert.equal(unjoinDotSeparated('Talla M · disponible'), 'Talla M · disponible')
    const p = applyFinalOutputPolicy({ text: 'Tenemos: SINPE Móvil · tarjeta · contra entrega', brandFacts: FACTS, shortenLongReply: true })
    assert.equal(p.text, 'Tenemos: SINPE Móvil\ntarjeta\ncontra entrega')
    assert.equal(p.ok, true)
  })
})

describe('3a. per-method payment tokens', () => {
  it('formats: vertical and readable', () => {
    assert.equal(paymentMethodBlock(FACTS, 'sinpe'), 'SINPE Móvil: 6201 9914\nA nombre de: Rafael García')
    assert.equal(paymentMethodBlock(FACTS, 'transferencia'), 'Transferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66\nA nombre de: Rafael Alberto García Montoya')
    assert.equal(paymentMethodBlock(FACTS, 'tarjeta'), 'Podés pagar con tarjeta en https://tienda.example.cr')
    assert.equal(paymentMethodBlock(FACTS, 'contra_entrega'), 'Pagás al recibir, al mensajero (SINPE o efectivo exacto). Solo dentro del GAM.')
    const card = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, cardUrl: 'https://pagos.example.cr/p' } })
    assert.equal(paymentMethodBlock(card, 'tarjeta'), 'Podés pagar con tarjeta en https://pagos.example.cr/p')
    const plus506 = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, sinpe: { number: '+506 6201-9914' } } })
    assert.equal(paymentMethodBlock(plus506, 'sinpe'), 'SINPE Móvil: 6201 9914')
  })
  it('the card link is the brand\'s own link (allowlist)', () => {
    const card = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, cardUrl: 'https://pagos.example.cr/p' } })
    const allow = brandFactsLinkAllowlist(card)
    const p = applyFinalOutputPolicy({ text: '[[PAGO_TARJETA]]', brandFacts: card, linkAllowlist: allow })
    assert.equal(p.ok, true, p.reasons.join(','))
  })
  it('guards: sharing off, method not offered, data missing → token dropped and a person is needed', () => {
    const off = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, shareWithCustomers: false } })
    for (const t of ['[[PAGO_SINPE]]', '[[PAGO_TRANSFERENCIA]]', '[[PAGO_TARJETA]]', '[[PAGO_CONTRA_ENTREGA]]', '[[DATOS_PAGO]]']) {
      const r = fillPaymentToken(`Listo ${t}`, off)
      assert.equal(r.needsHuman, true, t)
      assert.equal(r.text, 'Listo')
    }
    const sinpeOnly = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '62019914' } } })
    assert.equal(fillPaymentToken('[[PAGO_TRANSFERENCIA]]', sinpeOnly).needsHuman, true)
    assert.equal(fillPaymentToken('[[PAGO_TARJETA]]', sinpeOnly).needsHuman, true)
    assert.equal(fillPaymentToken('[[PAGO_CONTRA_ENTREGA]]', sinpeOnly).needsHuman, true)
    // Contra entrega offered by a shipping method (sales flow) fills with the zone note.
    const cod = fillPaymentToken('[[PAGO_CONTRA_ENTREGA]]', sinpeOnly, { codAvailable: true, codNote: 'Solo dentro del GAM.' })
    assert.deepEqual([cod.text, cod.needsHuman, cod.methods], ['Pagás al recibir el pedido, al mensajero. Solo dentro del GAM.', false, ['contra_entrega']])
    const noWeb = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta'], sinpe: { number: '62019914' } } })
    assert.equal(fillPaymentToken('[[PAGO_TARJETA]]', noWeb).needsHuman, true)
  })
  it('near-miss spellings are filled too', () => {
    for (const t of ['[PAGO_SINPE]', '[[pago sinpe]]', '[[PAGO-SINPE]]']) assert.match(fillPaymentToken(t, FACTS).text, /6201 9914/, t)
    assert.match(fillPaymentToken('[[PAGO_CONTRAENTREGA]]', FACTS).text, /Pagás al recibir/)
  })
  it('[[DATOS_PAGO]] still works, vertical, never " · "', () => {
    const r = fillPaymentToken('[[DATOS_PAGO]]', FACTS)
    assert.equal(r.text, 'SINPE Móvil: 6201 9914\nA nombre de: Rafael García\nTransferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66\nA nombre de: Rafael Alberto García Montoya\nTambién: tarjeta (en la web) y contra entrega (solo GAM)')
    assert.doesNotMatch(r.text, / · /)
    assert.deepEqual(r.methods, ['all'])
  })
  it('the grouped numbers pass the payment-number check; planted ones still fail', () => {
    for (const m of ['sinpe', 'transferencia'] as const) {
      assert.deepEqual(paymentNumberProblems({ text: paymentMethodBlock(FACTS, m), facts: FACTS }), [], m)
    }
    assert.deepEqual(paymentNumberProblems({ text: 'SINPE Móvil: 8888 1234', facts: FACTS }), ['payment_number_unsourced'])
  })
  it('the prompt names one token per configured method; [[DATOS_PAGO]] only when all are asked for', () => {
    const p = paymentFactsForPrompt(FACTS)
    assert.match(p, /Primero preguntá cómo prefiere pagar/)
    assert.match(p, /SINPE Móvil → \[\[PAGO_SINPE\]\]/)
    assert.match(p, /contra entrega → \[\[PAGO_CONTRA_ENTREGA\]\]/)
    assert.match(p, /\[\[DATOS_PAGO\]\] \(todos los métodos\) solo si el cliente pide explícitamente/)
    assert.doesNotMatch(p, /6201|9914/)
  })
  it('owner text (Corregir) accepts the new tokens and still refuses other [[…]] and numbers', () => {
    for (const t of ['[[PAGO_SINPE]]', '[[PAGO_TRANSFERENCIA]]', '[[PAGO_TARJETA]]', '[[PAGO_CONTRA_ENTREGA]]', '[[DATOS_PAGO]]']) {
      assert.equal(ownerTextProblem(`Perfecto 🙌 ${t}`, 'La respuesta').ok, true, t)
    }
    const bad = ownerTextProblem('Hola [[ATAJO:x]]', 'La respuesta')
    assert.equal(bad.ok, false)
    assert.match(bad.ok ? '' : bad.error, /\[\[PAGO_SINPE\]\]/)
    const nums = checkCorrectionText('Pagá al 8888 1234', [], 'La respuesta')
    assert.equal(nums.ok, false)
    assert.match(nums.ok ? '' : nums.error, /\[\[PAGO_SINPE\]\]/)
  })
})

describe('3b. sales state: metodo_pago', () => {
  const askedHistory = [msg('outbound', 'Queda en ₡20 900'), msg('inbound', 'lo quiero'), msg('outbound', '¿Cómo preferís pagar? Tenemos SINPE Móvil y tarjeta.')]
  it('the close asks the method (code-built question from the configured methods)', () => {
    const s = deriveSalesState({ history: [msg('outbound', 'Queda en ₡15 900')], inboundText: 'lo quiero', ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.match(s.nextStep, /preguntá cómo prefiere pagar/)
    assert.match(s.nextStep, /pedí en lista SOLO los datos del pedido que falten/)
    assert.equal(salesMethodQuestion(CTX), '¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta (en la web) y contra entrega (solo GAM).')
    assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago \(usala tal cual, en su propio mensaje\): «¿Cómo preferís pagar\? Tenemos SINPE Móvil/)
    // "(solo GAM)" only when the COD text says GAM; no "(en la web)" without a link.
    const noGam = { ...CTX, cardOnWeb: false, shippingMethods: [{ name: 'Envío', price: 3000, coverage: 'todo el país', cod: 'sí, donde llega' }] }
    assert.equal(salesMethodQuestion(noGam), '¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta y contra entrega.')
    assert.equal(salesMethodQuestion({ ...CTX, paymentMethods: ['sinpe'], shippingMethods: [] }), '¿Cómo preferís pagar? Tenemos SINPE Móvil.')
  })
  it('"¿cómo les puedo pagar?" is a close (the method question is offered)', () => {
    assert.equal(deriveSalesState({ history: [], inboundText: '¿Cómo les puedo pagar?', ctx: CTX }).stage, 'cierre')
  })
  it('after the question: metodo_pago, waiting for the choice', () => {
    const s = deriveSalesState({ history: askedHistory, inboundText: 'mmm ¿y llega mañana?', ctx: CTX })
    assert.equal(s.stage, 'metodo_pago')
    assert.equal(s.chosenMethod, null)
    assert.match(s.nextStep, /Esperá que elija el método de pago/)
    assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago/)
    assert.equal(awaitingPaymentMethodChoice(askedHistory), true)
  })
  it('the choice is parsed from the last customer message and the next step names only that token', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['SINPE', 'sinpe', /SOLO el token \[\[PAGO_SINPE\]\][\s\S]*comprobante/],
      ['por transferencia porfa', 'transferencia', /\[\[PAGO_TRANSFERENCIA\]\]/],
      ['con tarjeta', 'tarjeta', /\[\[PAGO_TARJETA\]\]/],
      ['contra entrega', 'contra_entrega', /fuera del GAM[\s\S]*\[\[PAGO_CONTRA_ENTREGA\]\][\s\S]*enseguida le confirmamos el pedido/],
      ['pago al recibirlo', 'contra_entrega', /contra entrega/],
      ['en efectivo', 'contra_entrega', /contra entrega/],
    ]
    for (const [text, method, step] of cases) {
      const s = deriveSalesState({ history: askedHistory, inboundText: text, ctx: CTX })
      assert.equal(s.stage, 'metodo_pago', text)
      assert.equal(s.chosenMethod, method, text)
      assert.match(s.nextStep, step, text)
      assert.doesNotMatch(formatSalesTurnBlock(CTX, s), /Pregunta de pago/, text)
    }
    assert.equal(parsePaymentMethodChoice('sinpe o tarjeta?'), null)
    assert.equal(parsePaymentMethodChoice('tarjeta de crédito'), 'tarjeta')
    // Without the question, naming a method only counts when asking for its details.
    assert.equal(deriveSalesState({ history: [], inboundText: '¿aceptan sinpe?', ctx: CTX }).chosenMethod ?? null, null)
    assert.equal(deriveSalesState({ history: [], inboundText: 'Quiero pagar por SINPE, ¿me pasás el número?', ctx: CTX }).chosenMethod, 'sinpe')
  })
  it('once the details went out: esperando_comprobante (the question is not pending anymore)', () => {
    const given = [...askedHistory, msg('inbound', 'sinpe'), msg('outbound', 'Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García')]
    assert.equal(deriveSalesState({ history: given, inboundText: 'ok', ctx: CTX }).stage, 'esperando_comprobante')
    assert.equal(awaitingPaymentMethodChoice(given), false)
  })
  it('a method the store does not offer is said and asked again', () => {
    const s = deriveSalesState({ history: askedHistory, inboundText: 'transferencia', ctx: { ...CTX, paymentMethods: ['sinpe'] } })
    assert.match(s.nextStep, /la tienda no lo ofrece/)
  })
  it('metodo_pago is a closing stage for the not-shareable rules and the receipt wait', () => {
    const s = deriveSalesState({ history: askedHistory, inboundText: 'mmm', ctx: CTX })
    const hidden = { ...CTX, paymentShareable: false }
    assert.equal(salesNeedsHuman(hidden, s), true)
    assert.equal(salesCloseWithoutPaymentData(hidden, s), true)
    assert.equal(salesNeedsHuman(CTX, s), false)
    assert.equal(salesAwaitingReceipt(s), true)
    assert.match(formatSalesTurnBlock(hidden, s), /escalate_to_human\(payment_or_sinpe\)/)
  })
  it('contra entrega from the sales context fills its token (zone note from the shipping methods)', () => {
    assert.deepEqual(salesPaymentOptions(CTX), { codAvailable: true, codNote: 'Solo dentro del GAM.' })
    assert.deepEqual(salesPaymentOptions({ ...CTX, paymentMethods: [], shippingMethods: [{ name: 'x', price: 1, coverage: 'y', cod: 'no' }] }), { codAvailable: false, codNote: null })
  })
})

describe('3c. deterministic replies', () => {
  it('sys_payment_info asks which method instead of dumping every number', () => {
    const d = decideInbound({ inboundText: '¿cómo puedo pagar?', brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.equal(d.shortcutKey, 'sys_payment_info')
    assert.equal(d.text, 'Podés pagar con:\n- SINPE Móvil\n- Transferencia\n- Tarjeta (en la web)\n- Contra entrega (solo GAM)\n\n¿Cómo preferís pagar?')
    assert.doesNotMatch(d.text, /\d{4}/)
    assert.equal(PAYMENT_INFO_BODY, RESERVED_SHORTCUT_SEEDS.find((s) => s.key === 'sys_payment_info')!.body)
  })
  it('old stored defaults are upgraded when read (no DB writes); owner-edited texts stay', () => {
    assert.equal(upgradeLegacyShortcutBody('Podés pagar así: {{brand.payment.summary}}. Cuando lo hagás, mandame el comprobante; el pago queda listo cuando lo revisamos 😊'), PAYMENT_INFO_BODY)
    assert.equal(upgradeLegacyShortcutBody('Podés pagar así: {{brand.payment.summary}}. Un comprobante lo revisa una persona del equipo; por acá no se confirma el pago.'), PAYMENT_INFO_BODY)
    const summary = RESERVED_SHORTCUT_SEEDS.find((s) => s.key === 'sys_purchase_summary')!.body
    assert.equal(upgradeLegacyShortcutBody('Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Lo querés con envío a domicilio o retiro?'), summary)
    assert.equal(upgradeLegacyShortcutBody('Mi propio texto {{brand.payment.summary}}'), 'Mi propio texto {{brand.payment.summary}}')
  })
  it('sys_purchase_summary names the methods, never the numbers', () => {
    const body = RESERVED_SHORTCUT_SEEDS.find((s) => s.key === 'sys_purchase_summary')!.body
    const rendered = renderShortcutTemplate(body, { facts: FACTS })
    assert.match(rendered, /Pago: SINPE Móvil, transferencia, tarjeta \(en la web\) y contra entrega \(solo GAM\)/)
    assert.doesNotMatch(rendered, /6201|CR05/)
  })
  it('pb_como_comprar asks for the data as a list', () => {
    const body = SALES_REPLY_TEMPLATES.find((s) => s.key === 'pb_como_comprar')!.body
    assert.equal(body, 'Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Correo\n- Dirección exacta (provincia, cantón y distrito)')
  })
  it('after the method question a bare "SINPE" is a choice: that method only, then the receipt ask (no hand-off)', () => {
    const d = decideInbound({ inboundText: 'SINPE', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(d.handled, true)
    assert.equal(d.handoff, null)
    assert.equal(d.escalate, false)
    assert.equal(d.text, 'Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García\n\nCuando lo hagás, mandame el comprobante por aquí y lo revisamos 😊')
    assert.deepEqual(splitReplyParts(d.text), ['Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García', 'Cuando lo hagás, mandame el comprobante por aquí y lo revisamos 😊'])
    const t = decideInbound({ inboundText: 'por transferencia', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.match(t.text, /^Perfecto 🙌\nTransferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66/)
    assert.match(decideInbound({ inboundText: 'tarjeta', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true }).text, /Podés pagar con tarjeta en https:\/\/tienda\.example\.cr/)
    assert.equal(paymentChoiceReply('contra_entrega'), null)
  })
  it('naming a method while asking for its details also gets only that method', () => {
    const d = decideInbound({ inboundText: 'Quiero pagar por SINPE, ¿me pasás el número?', brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.match(d.text, /^Claro 🙌\nSINPE Móvil: 6201 9914/)
    assert.equal(d.handoff, null)
  })
  it('contra entrega goes to the model (zone + order details, then a person)', () => {
    const d = decideInbound({ inboundText: 'contra entrega', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(d.handled, false)
  })
  it('claims, confirm requests and opt-outs are never read as a choice (fail closed as before)', () => {
    for (const text of ['ya hice el sinpe', 'sinpe, ¿me confirmás cuando llegue?', 'te mandé el sinpe', 'sinpe hecho', 'me cobraron doble por sinpe', 'mi sinpe de ayer']) {
      assert.equal(isCueFreePaymentChoiceText(text), false, text)
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
      assert.ok(d.handoff?.kind === 'handoff', text)
    }
    const human = decideInbound({ inboundText: 'quiero hablar con una persona, sinpe', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    // Not a choice: the existing safety routing hands it to a person (as before this change).
    assert.equal(human.handoff?.kind, 'handoff')
    assert.doesNotMatch(human.text, /6201/)
  })
  it('payment details not shareable: the choice gets "Enseguida te paso cómo pagar" + team review', () => {
    const off = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, shareWithCustomers: false } })
    const d = decideInbound({ inboundText: 'SINPE', brandFacts: off, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(d.shortcutKey, 'sys_payment_soon')
    assert.deepEqual(d.handoff, { kind: 'review', reason: HANDOFF_REASON.paymentData })
  })
  it('live turn and Probar pass the pending method question to the decision', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal((turn.match(/awaitingPaymentMethod: awaitingPaymentMethodChoice\(history\),/g) || []).length, 2)
    assert.equal((turn.match(/paymentOptions: runtimeInput\.salesPaymentOptions,/g) || []).length, 2)
  })
})

describe('3b. contra entrega → order_ready hand-off', () => {
  it('a reply carrying the filled COD block is sent first, then a TRUE hand-off with reason order_ready', () => {
    const text = 'Listo 🙌 tu pedido:\n- Combo GLP-1 + Focus\n- Total ₡20 900\n\n[[PAGO_CONTRA_ENTREGA]]\n\nEnseguida te confirmamos el pedido 😊'
    const policy = applyFinalOutputPolicy({ text, brandFacts: FACTS, skipPurchaseSummary: true, quoteAmounts: [20900], paymentOptions: salesPaymentOptions(CTX) })
    assert.equal(policy.ok, true, policy.reasons.join(','))
    assert.deepEqual(policy.paymentMethods, ['contra_entrega'])
    assert.deepEqual(policy.parts, [
      'Listo 🙌 tu pedido:\n- Combo GLP-1 + Focus\n- Total ₡20 900',
      'Pagás al recibir, al mensajero (SINPE o efectivo exacto). Solo dentro del GAM.',
      'Enseguida te confirmamos el pedido 😊',
    ])
    const plan = planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: null, codOrderReady: policy.paymentMethods.includes('contra_entrega') })
    assert.equal(HANDOFF_REASON.orderReady, 'order_ready')
    assert.deepEqual(plan, { text: policy.text, handoff: { kind: 'handoff', reason: 'order_ready' } })
    // A generic model hand-off on the same turn still reports order_ready; a payment claim keeps the payment line.
    assert.equal(planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: { kind: 'handoff', reason: 'escalate' }, codOrderReady: true }).handoff?.reason, 'order_ready')
    assert.equal(planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: null, receiptCue: true, codOrderReady: true }).handoff?.reason, 'payment')
    // A reply that failed a check never goes out as written.
    assert.notEqual(planModelTurnDelivery({ text: policy.text, textOk: false, llmHandoff: null, codOrderReady: true }).handoff?.reason, 'order_ready')
  })
  it('both turn paths wire it (settleHandoff runs after the send through finishDeliveryOrSuggest)', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal((turn.match(/codOrderReady: policy\.paymentMethods\.includes\('contra_entrega'\),/g) || []).length, 2)
    assert.match(turn, /if \(input\.handoff\) await settleHandoff\(input\.row, input\.handoff\)/)
  })
})

describe('3d. quick check (test engine)', () => {
  const suite = generateAgentSuite({
    agentName: 'X',
    systemInstructions: '',
    products: [{ name: 'GLP-1', sellingPrice: 15900, currentStock: 5 }],
    payment: { shareable: true, sinpeNumber: '6201-9914' },
  })
  it('"¿cómo pago?" expects the method question; the digits are expected once SINPE is chosen', () => {
    const how = suite.cases.find((c) => c.id === 'how-to-pay')!
    assert.deepEqual(how.expect, [{ kind: 'asks_payment_method', digits: '62019914' }])
    const pick = suite.cases.find((c) => c.id === 'pay-sinpe')!
    assert.deepEqual(pick.expect, [{ kind: 'mentions_digits', digits: '62019914' }])
    assert.equal(AGENT_RULES_VERSION, 'format-r1-2026-10-16')
  })
  it('grading: asking the method passes; the old dump still passes; silence does not', () => {
    const turn = (text: string) => ({ text, escalate: false, needsHuman: false, outcome: 'send' as const })
    const how = { kind: 'asks_payment_method' as const, digits: '62019914' }
    const sysReply = decideInbound({ inboundText: '¿cómo puedo pagar?', brandFacts: FACTS, shortcuts: SHORTCUTS }).text
    assert.equal(checkExpect(how, turn(sysReply)).pass, true)
    assert.equal(checkExpect(how, turn('¿Cómo preferís pagar? Tenemos SINPE Móvil, tarjeta (en la web) y contra entrega (solo GAM).')).pass, true)
    assert.equal(checkExpect(how, turn('SINPE Móvil: 6201 9914')).pass, true)
    assert.equal(checkExpect(how, turn('Hola 😊 ¿qué producto te interesa?')).pass, false)
    assert.equal(asksPaymentMethod('Tenemos SINPE.'), false)
    const pickReply = decideInbound({ inboundText: 'Quiero pagar por SINPE, ¿me pasás el número?', brandFacts: FACTS, shortcuts: SHORTCUTS }).text
    assert.equal(checkExpect({ kind: 'mentions_digits', digits: '62019914' }, turn(pickReply)).pass, true)
  })
})
