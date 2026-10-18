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
import {
  joinReplyParts,
  planReplyParts,
  remainderPart,
  replyPartsOf,
  splitReplyParts,
  AGENT_PARTS_DEADLINE_MS,
  MAX_REPLY_PARTS,
  PART_HASH_VERSION,
} from '@/lib/soft-ai/reply-parts'
import {
  awaitingPaymentMethodChoice,
  deriveSalesState,
  formatSalesTurnBlock,
  parsePaymentMethodChoice,
  paymentDetailsIn,
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
import { isCueFreePaymentChoiceText, paymentChoiceShape } from '@/lib/soft-ai/payment-classifier'
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
const COD_BLOCK = 'Pago contra entrega:\nPagás al recibir, al mensajero (SINPE o efectivo exacto). Solo dentro del GAM.'
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
  'Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Correo (opcional)\n- Provincia\n- Cantón\n- Distrito\n- Dirección exacta con señas',
  '¿Cómo preferís pagar? Tenemos SINPE Móvil, tarjeta (en la web) y contra entrega (solo GAM).',
].join('\n\n')

/** Payment claims / disputes that name SINPE: never a method choice, always a person (Verifier 2026-10-16). */
const CLAIMS = [
  'Hecho por sinpe', 'enviado por sinpe', 'mandado por sinpe', 'Sinpe de 25 mil', 'sinpe por 15.000', 'Ahí va el sinpe',
  'Sinpe completado', 'sinpe hace un rato', 'sinpe, revisá', 'Sinpe. Pero el anterior me lo cobraron 2 veces',
  'Prefiero pagar por sinpe pero ya le había pagado al otro número', 'no me deja hacer el sinpe al número',
  'Sinpe al número 8888-8888 a nombre de Ana', 'ya hice el SINPE', 'sinpe listo', 'te mandé por sinpe', 'sinpe ✅',
  'SINPE hecho', 'pagué por sinpe', 'sinpe enviado', 'ya está el sinpe', '¿les llegó el sinpe?',
  // Integration verifier (F1 extra).
  'Sinpe pagado', 'pagado por sinpe', 'cancelado por sinpe', 'listo, sinpe', 'SINPE ya', 'sinpe hace rato',
  'sinpe pagado, ¿me pasás el número de pedido?', 'Pagado por sinpe, ¿me pasás los datos del envío?',
]

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
  it('send loop keys: part 0 = turn key + versioned whole-text hash; parts 1..n = :pN + own hash', () => {
    const plan = planReplyParts({ text: 'a\n\nb\n\nc', deliveryKey: 'msg:1', hash: sha })
    assert.deepEqual(plan.map((p) => [p.index, p.deliveryKey, p.contentHash, p.text]), [
      [0, 'msg:1', sha(`${PART_HASH_VERSION}a\n\nb\n\nc`), 'a'],
      [1, 'msg:1:p1', sha('b'), 'b'],
      [2, 'msg:1:p2', sha('c'), 'c'],
    ])
    // #6: never the old single-message hash (a claim made by the old code conflicts instead of resending).
    assert.notEqual(plan[0].contentHash, sha('a\n\nb\n\nc'))
    assert.deepEqual(planReplyParts({ text: 'solo uno', deliveryKey: 'k', hash: sha }).map((p) => p.deliveryKey), ['k'])
  })
  it('late turn (F2): everything left goes out as ONE last message, keyed on that part, hashed on the joined text', () => {
    const plan = planReplyParts({ text: 'a\n\nb\n\nc', deliveryKey: 'k', hash: sha })
    assert.deepEqual(remainderPart(plan, 1, sha), { index: 1, text: 'b\n\nc', deliveryKey: 'k:p1', contentHash: sha('b\n\nc') })
    assert.deepEqual(remainderPart(plan, 2, sha), plan[2])
    assert.equal(AGENT_PARTS_DEADLINE_MS, 38_000)
  })
  it('send loop (source): sequential, gap, late remainder, stop checks, ambiguous part stops + review alert', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    // luna-10 #5: the parts are planned from the reply after the repeat guard (outgoingText).
    assert.match(turn, /planReplyParts\(\{ text: outgoingText, deliveryKey: input\.row\.deliveryKey, hash: hashSoftAiDeliveryContent \}\)/)
    assert.match(turn, /let outgoingText = input\.outputText/)
    assert.match(turn, /for \(let i = 0; i < partsPlan\.length; i \+= 1\) \{/)
    assert.match(turn, /if \(await stopRemainingParts\(input\.row\.tenantId, input\.row\.conversationId\)\) \{\s*partial = true\s*break/)
    // agents2-pace: the gap / late rule moved into planPartWait (reply-pace.ts; 'instant' keeps 700 ms + the late rule).
    assert.match(turn, /if \(wait\.late\) \{[\s\S]{0,200}part = remainderPart\(partsPlan, i, hashSoftAiDeliveryContent\)\s*lastPart = true/)
    assert.match(turn, /setTimeout\(resolve, Math\.max\(0, waitUntil - Date\.now\(\)\)\)/)
    assert.match(turn, /deliveryKey: part\.deliveryKey,\s*kind: 'text',\s*contentHash: part\.contentHash,/)
    assert.match(turn, /if \(part\.index === 0\) throw error[\s\S]{0,300}partial = true\s*break/)
    assert.match(turn, /content: part\.text,/)
    assert.match(turn, /\.\.\.\(part\.index === 0 \? \{ toolTrace: input\.toolTrace \} : \{\}\)/)
    assert.match(turn, /partIndex: part\.index,\s*partCount: lastPart \? part\.index \+ 1 : partsPlan\.length,/)
    assert.match(turn, /if \(lastPart\) break/)
    assert.match(turn, /errorCode: 'partial_delivery'/)
    // #7: kill switch / chat taken by a person / paused → stop (fail-safe on read errors).
    assert.match(turn, /async function stopRemainingParts[\s\S]{0,400}readAgentKillState\(tenantId\)\)\.armed\) return true[\s\S]{0,300}conv\.aiMode === 'human' \|\| conv\.aiMode === 'paused'[\s\S]{0,60}catch \{\s*return true/)
    // F2: a partial reply asks a person to look (review alert; the chat stays as it is).
    assert.match(turn, /result\.status === 'delivered' && result\.partialDelivery\) \{\s*await settleHandoff\(input\.row, \{ kind: 'review', reason: HANDOFF_REASON\.review \}, input\.afterHours\)/)
    assert.ok(turn.indexOf('await sendAgentImagesOnce(') < turn.indexOf('for (let i = 0; i < partsPlan.length; i += 1)'))
    assert.match(turn, /jobId_deliveryKey: \{ jobId: input\.row\.id, deliveryKey: input\.row\.deliveryKey \}/)
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
  it('Corregir joins only the TEXT parts of the same turn, in partIndex order (#5)', () => {
    const meta = (partIndex: number | undefined, extra: Record<string, unknown> = {}, agentId = 'ag1') => ({ softAi: true, agentId, turnId: 't1', partIndex, partCount: 3, ...extra })
    const rows = [
      { content: 'tercero', metadata: meta(2) },
      { content: '[image]', metadata: meta(undefined, { agentAssetId: 'a1', agentAssetSha: 'x' }), messageType: 'image' },
      { content: '[image]', metadata: meta(0, { agentAssetSha: 'x' }) },
      { content: 'primero', metadata: meta(0) },
      { content: 'segundo', metadata: meta(1) },
      { content: 'primero', metadata: meta(0) },
      { content: 'sin índice', metadata: meta(undefined) },
      { content: 'otro agente', metadata: meta(1, {}, 'ag2') },
    ]
    assert.equal(joinReplyParts(rows, 'ag1'), 'primero\n\nsegundo\n\ntercero')
    const tuning = read('src/lib/soft-ai/agent-tuning.ts')
    assert.match(tuning, /direction: 'outbound', messageType: 'text', metadata: \{ path: \['turnId'\], equals: meta\.turnId \}/)
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
  it('a dash list counts as one line (up to 8 items); maxLines applies per message', () => {
    assert.equal(messageLineCount('Para armar tu pedido pasame:\n- a\n- b\n- c\n- d'), 2)
    assert.equal(messageLineCount('• a\n• b\ntexto\n1. x\n2. y'), 3)
    const eight = Array.from({ length: 8 }, (_, i) => `- ${i}`).join('\n')
    const nine = Array.from({ length: 9 }, (_, i) => `- ${i}`).join('\n')
    assert.equal(messageLineCount(eight), 1)
    assert.equal(messageLineCount(nine), 9)
    const style = { ...DEFAULT_REPLY_STYLE, maxLines: 2 }
    const ok = validateAgentOutput({ text: CLOSE_REPLY, citedToolNames: [], quoteAmounts: [20900], replyStyle: style })
    assert.equal(ok.reasons.includes('style_too_long'), false)
    assert.ok(validateAgentOutput({ text: 'a\nb\nc\nd\ne\n\nok', citedToolNames: [], replyStyle: style }).reasons.includes('style_too_long'))
    assert.ok(validateAgentOutput({ text: `Opciones:\n${nine}`, citedToolNames: [], replyStyle: style }).reasons.includes('style_too_long'))
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
    assert.match(shortenToMaxLines('a\nb\nc\nd\ne\n[[PAGO_SINPE]]', 1), /\[\[PAGO_SINPE\]\]/)
    assert.equal(shortenToMaxLines(CLOSE_REPLY, 2), CLOSE_REPLY)
    const multi = shortenToMaxLines('x\n\na\nb\nc\nd\ne\nf\n\n¿Seguimos?', 2)
    assert.deepEqual(splitReplyParts(multi), ['x', 'a\nb', '¿Seguimos?'])
  })
  it('the " · " joined style becomes a dash list (same words) that shortening never drops (F3)', () => {
    assert.equal(unjoinDotSeparated('SINPE 1 · transferencia BAC · también tarjeta'), '- SINPE 1\n- transferencia BAC\n- también tarjeta')
    assert.equal(unjoinDotSeparated('Talla M · disponible'), 'Talla M · disponible')
    const p = applyFinalOutputPolicy({ text: 'Tenemos: SINPE Móvil · tarjeta · contra entrega', brandFacts: FACTS, shortenLongReply: true })
    assert.equal(p.text, 'Tenemos:\n- SINPE Móvil\n- tarjeta\n- contra entrega')
    assert.equal(p.ok, true)
    const colors = applyFinalOutputPolicy({
      text: 'La camiseta viene en colores: negro · blanco · azul · rojo · verde\n¿Qué color querés?',
      brandFacts: FACTS,
      shortenLongReply: true,
      replyStyle: { ...DEFAULT_REPLY_STYLE, maxLines: 1 },
    })
    for (const c of ['negro', 'blanco', 'azul', 'rojo', 'verde']) assert.match(colors.text, new RegExp(`- ${c}`), c)
    assert.equal(colors.reasons.includes('style_too_long'), false)
    const prices = applyFinalOutputPolicy({
      text: 'Precios: A ₡1 000 · B ₡2 000 · C ₡3 000 · D ₡4 000 · E ₡5 000',
      brandFacts: FACTS,
      shortenLongReply: true,
      quoteAmounts: [1000, 2000, 3000, 4000, 5000],
      skipPurchaseSummary: true,
      replyStyle: { ...DEFAULT_REPLY_STYLE, maxLines: 1 },
    })
    assert.equal(prices.reasons.includes('style_too_long'), false, prices.reasons.join(','))
    assert.match(prices.text, /- E ₡5 000/)
  })
})

describe('3a. per-method payment tokens', () => {
  it('formats: vertical and readable', () => {
    assert.equal(paymentMethodBlock(FACTS, 'sinpe'), 'SINPE Móvil: 6201 9914\nA nombre de: Rafael García')
    assert.equal(paymentMethodBlock(FACTS, 'transferencia'), 'Transferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66\nA nombre de: Rafael Alberto García Montoya')
    assert.equal(paymentMethodBlock(FACTS, 'tarjeta'), 'Podés pagar con tarjeta en https://tienda.example.cr')
    assert.equal(paymentMethodBlock(FACTS, 'contra_entrega'), COD_BLOCK)
    const card = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, cardUrl: 'https://pagos.example.cr/p' } })
    assert.equal(paymentMethodBlock(card, 'tarjeta'), 'Podés pagar con tarjeta en https://pagos.example.cr/p')
    const plus506 = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, sinpe: { number: '+506 6201-9914' } } })
    assert.equal(paymentMethodBlock(plus506, 'sinpe'), 'SINPE Móvil: 6201 9914')
    const bankOnly = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['transferencia'], transfer: { bank: 'BAC' } } })
    assert.equal(paymentMethodBlock(bankOnly, 'transferencia'), 'Transferencia bancaria: BAC')
  })
  it('efectivo is its own method when configured ([[PAGO_EFECTIVO]])', () => {
    const cash = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe', 'efectivo'], sinpe: { number: '62019914' } } })
    assert.equal(paymentMethodBlock(cash, 'efectivo'), 'Pago en efectivo:\nPagás en efectivo al recibir o al retirar el pedido.')
    const noted = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['efectivo'], instructionsText: 'efectivo exacto al retirar en tienda' } })
    assert.equal(paymentMethodBlock(noted, 'efectivo'), 'Pago en efectivo:\nEfectivo exacto al retirar en tienda.')
    assert.equal(fillPaymentToken('[[PAGO_EFECTIVO]]', FACTS).needsHuman, true)
  })
  it('the card link needs no allowlist entry (checked before filling); a model-written payment link is still foreign', () => {
    const card = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, cardUrl: 'https://www.paypal.com/paypalme/tienda' } })
    const allow = brandFactsLinkAllowlist(card)
    assert.equal(allow.hosts.includes('www.paypal.com') || allow.hosts.includes('paypal.com'), false)
    const ok = applyFinalOutputPolicy({ text: '[[PAGO_TARJETA]]', brandFacts: card, linkAllowlist: allow })
    assert.equal(ok.ok, true, ok.reasons.join(','))
    assert.match(ok.text, /paypalme\/tienda/)
    const planted = applyFinalOutputPolicy({ text: 'Pagá aquí: https://www.paypal.com/paypalme/attacker', brandFacts: card, linkAllowlist: allow })
    assert.ok(planted.reasons.includes('foreign_link'))
  })
  it('guards: sharing off, method not offered, data missing → token dropped and a person is needed', () => {
    const off = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, shareWithCustomers: false } })
    for (const t of ['[[PAGO_SINPE]]', '[[PAGO_TRANSFERENCIA]]', '[[PAGO_TARJETA]]', '[[PAGO_CONTRA_ENTREGA]]', '[[PAGO_EFECTIVO]]', '[[DATOS_PAGO]]']) {
      const r = fillPaymentToken(`Listo ${t}`, off)
      assert.equal(r.needsHuman, true, t)
      assert.equal(r.text, 'Listo')
    }
    const sinpeOnly = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '62019914' } } })
    assert.equal(fillPaymentToken('[[PAGO_TRANSFERENCIA]]', sinpeOnly).needsHuman, true)
    assert.equal(fillPaymentToken('[[PAGO_TARJETA]]', sinpeOnly).needsHuman, true)
    assert.equal(fillPaymentToken('[[PAGO_CONTRA_ENTREGA]]', sinpeOnly).needsHuman, true)
    const cod = fillPaymentToken('[[PAGO_CONTRA_ENTREGA]]', sinpeOnly, { codAvailable: true, codNote: 'Solo dentro del GAM.', chosenMethod: 'contra_entrega' })
    assert.deepEqual([cod.text, cod.needsHuman, cod.methods], ['Pago contra entrega:\nPagás al recibir el pedido, al mensajero. Solo dentro del GAM.', false, ['contra_entrega']])
    const noWeb = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta'], sinpe: { number: '62019914' } } })
    assert.equal(fillPaymentToken('[[PAGO_TARJETA]]', noWeb).needsHuman, true)
  })
  it('near-miss spellings are filled; the same token twice gives ONE block', () => {
    for (const t of ['[PAGO_SINPE]', '[[pago sinpe]]', '[[PAGO-SINPE]]']) assert.match(fillPaymentToken(t, FACTS).text, /6201 9914/, t)
    assert.match(fillPaymentToken('[[PAGO_CONTRAENTREGA]]', FACTS).text, /Pagás al recibir/)
    const twice = fillPaymentToken('SINPE: [[PAGO_SINPE]] a nombre de [[PAGO_SINPE]]', FACTS)
    assert.equal((twice.text.match(/6201 9914/g) || []).length, 1)
  })
  it('any other [[…]] left after filling is stripped and held for a person (#4)', () => {
    const p = applyFinalOutputPolicy({ text: 'Pagá así: [[PAGO_PAYPAL]]', brandFacts: FACTS })
    assert.ok(p.reasons.includes('unknown_token'))
    assert.equal(p.needsHuman, true)
    assert.doesNotMatch(p.text, /\[\[/)
  })
  it('[[DATOS_PAGO]] still works, vertical, never " · "', () => {
    const r = fillPaymentToken('[[DATOS_PAGO]]', FACTS)
    assert.equal(r.text, 'SINPE Móvil: 6201 9914\nA nombre de: Rafael García\nTransferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66\nA nombre de: Rafael Alberto García Montoya\nTambién: tarjeta (en la web) y contra entrega (solo GAM)')
    assert.doesNotMatch(r.text, / · /)
    assert.deepEqual(r.methods, ['all'])
  })
  it('grouped numbers pass; a line break never joins a configured number with the next digits (#8); planted ones fail', () => {
    for (const m of ['sinpe', 'transferencia'] as const) {
      assert.deepEqual(paymentNumberProblems({ text: paymentMethodBlock(FACTS, m), facts: FACTS }), [], m)
    }
    assert.deepEqual(paymentNumberProblems({ text: 'SINPE Móvil: 6201 9914\n15000', facts: FACTS }), [])
    assert.deepEqual(paymentNumberProblems({ text: 'SINPE Móvil: 8888 1234', facts: FACTS }), ['payment_number_unsourced'])
    assert.deepEqual(paymentNumberProblems({ text: 'SINPE al 8888\n8888', facts: FACTS }), ['payment_number_unsourced'])
    assert.deepEqual(paymentNumberProblems({ text: 'SINPE Móvil: 6201 9914 1500', facts: FACTS }), ['payment_number_unsourced'])
  })
  it('the prompt names one token per configured method; [[DATOS_PAGO]] only when all are asked for', () => {
    const p = paymentFactsForPrompt(FACTS)
    assert.match(p, /Primero preguntá cómo prefiere pagar/)
    assert.match(p, /SINPE Móvil → \[\[PAGO_SINPE\]\]/)
    assert.match(p, /contra entrega → \[\[PAGO_CONTRA_ENTREGA\]\]/)
    assert.match(p, /\[\[DATOS_PAGO\]\] \(todos los métodos\) solo si el cliente pide explícitamente/)
    assert.doesNotMatch(p, /6201|9914/)
    assert.match(IMMUTABLE_SAFETY_POLICY, /\[\[PAGO_CONTRA_ENTREGA\]\] \/ \[\[PAGO_EFECTIVO\]\] solo cuando el cliente ya ELIGIÓ ese método/)
  })
  it('owner text (Corregir) accepts the new tokens and still refuses other [[…]] and numbers', () => {
    for (const t of ['[[PAGO_SINPE]]', '[[PAGO_TRANSFERENCIA]]', '[[PAGO_TARJETA]]', '[[PAGO_EFECTIVO]]', '[[PAGO_CONTRA_ENTREGA]]', '[[DATOS_PAGO]]']) {
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
    assert.match(s.nextStep, /pedí los datos del pedido con la lista fija de "Datos que necesita un pedido"/)
    assert.equal(salesMethodQuestion(CTX), '¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta (en la web) y contra entrega (solo GAM).')
    assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago \(usala tal cual, en su propio mensaje\): «¿Cómo preferís pagar\? Tenemos SINPE Móvil/)
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
  it('the choice is parsed (shape only) and the next step names only that token', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['SINPE', 'sinpe', /SOLO el token \[\[PAGO_SINPE\]\][\s\S]*comprobante/],
      ['por transferencia porfa', 'transferencia', /\[\[PAGO_TRANSFERENCIA\]\]/],
      ['con tarjeta', 'tarjeta', /\[\[PAGO_TARJETA\]\]/],
      ['contra entrega', 'contra_entrega', /fuera del GAM[\s\S]*\[\[PAGO_CONTRA_ENTREGA\]\][\s\S]*enseguida lo revisamos\. NUNCA digas confirmado, registrado, anotado, agendado, listo/],
      ['pago contra entrega', 'contra_entrega', /contra entrega/],
      // efectivo not configured but contra entrega is → paying the courier.
      ['en efectivo', 'contra_entrega', /contra entrega/],
    ]
    for (const [text, method, step] of cases) {
      const s = deriveSalesState({ history: askedHistory, inboundText: text, ctx: CTX })
      assert.equal(s.stage, 'metodo_pago', text)
      assert.equal(s.chosenMethod, method, text)
      assert.match(s.nextStep, step, text)
      assert.doesNotMatch(formatSalesTurnBlock(CTX, s), /Pregunta de pago/, text)
    }
    // efectivo configured → its own method and token.
    const cash = deriveSalesState({ history: askedHistory, inboundText: 'efectivo', ctx: { ...CTX, paymentMethods: ['sinpe', 'efectivo'] } })
    assert.equal(cash.chosenMethod, 'efectivo')
    assert.match(cash.nextStep, /\[\[PAGO_EFECTIVO\]\]/)
    assert.equal(parsePaymentMethodChoice('sinpe o tarjeta?'), null)
    assert.equal(parsePaymentMethodChoice('tarjeta de crédito'), 'tarjeta')
    assert.equal(deriveSalesState({ history: [], inboundText: '¿aceptan sinpe?', ctx: CTX }).chosenMethod ?? null, null)
    assert.equal(deriveSalesState({ history: [], inboundText: 'Quiero pagar por SINPE, ¿me pasás el número?', ctx: CTX }).chosenMethod, 'sinpe')
    for (const claim of CLAIMS) {
      assert.equal(deriveSalesState({ history: askedHistory, inboundText: claim, ctx: CTX }).chosenMethod ?? null, null, claim)
    }
  })
  it('once the details went out (also digit-less blocks): esperando_comprobante; same rule in both helpers (#3)', () => {
    for (const block of ['Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García', 'Perfecto 🙌\nPodés pagar con tarjeta en https://tienda.example.cr', 'Transferencia bancaria: BAC']) {
      const given = [...askedHistory, msg('inbound', 'x'), msg('outbound', block)]
      assert.equal(paymentDetailsIn(block), true, block)
      assert.equal(deriveSalesState({ history: given, inboundText: 'ok', ctx: CTX }).stage, 'esperando_comprobante', block)
      assert.equal(awaitingPaymentMethodChoice(given), false, block)
    }
  })
  it('an old question is not pending; a new buy cue after the question goes back to the close (F5)', () => {
    const later = [...askedHistory, msg('inbound', 'mmm'), msg('outbound', 'Dale 😊'), msg('inbound', '¿y la talla?'), msg('outbound', 'Es talla única'), msg('inbound', 'ok'), msg('outbound', '¿Algo más?')]
    assert.equal(awaitingPaymentMethodChoice(later), false)
    assert.equal(deriveSalesState({ history: later, inboundText: 'la quiero', ctx: CTX }).stage, 'cierre')
    assert.equal(deriveSalesState({ history: askedHistory, inboundText: 'mejor quiero comprar otro, el GLP-1 lo quiero', ctx: CTX }).stage, 'cierre')
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
    // Sleeping C6 adds dataListFirst next to chosenMethod (same object, same options from the sales context).
    assert.match(read('src/lib/soft-ai/agent-turn-inputs.ts'), /salesPaymentOptions: sales\s*\?\s*\{\s*\.\.\.salesPaymentOptions\(sales\),\s*chosenMethod: salesState\?\.chosenMethod \?\? null,\s*dataListFirst: [^}]*\}\s*: undefined,/)
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
  it('pb_como_comprar asks for the fixed shipping list (Rafael 2026-10-16; correo optional)', () => {
    const body = SALES_REPLY_TEMPLATES.find((s) => s.key === 'pb_como_comprar')!.body
    assert.equal(
      body,
      'Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Correo (opcional)\n- Provincia\n- Cantón\n- Distrito\n- Dirección exacta con señas',
    )
    assert.equal(upgradeLegacyShortcutBody('Para hacer el pedido solo necesito tu nombre completo, teléfono y dirección exacta. ¿Me los pasás?'), body)
    // The previous 3-line default upgrades too.
    assert.equal(upgradeLegacyShortcutBody('Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Dirección exacta (provincia, cantón y distrito)'), body)
  })
  it('choices SHAPED like a choice: that method only, then the receipt ask (no hand-off)', () => {
    for (const [text, method] of [['SINPE', 'sinpe'], ['sinpe porfa', 'sinpe'], ['por sinpe', 'sinpe'], ['Prefiero SINPE 🙏', 'sinpe'], ['tarjeta', 'tarjeta'], ['contra entrega', 'contra_entrega'], ['quiero pagar por sinpe, me pasás el número?', 'sinpe']] as const) {
      assert.equal(paymentChoiceShape(text, { allowAsk: true }), method, text)
    }
    const d = decideInbound({ inboundText: 'SINPE', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(d.handled, true)
    assert.equal(d.handoff, null)
    assert.equal(d.escalate, false)
    assert.equal(d.text, 'Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García\n\nCuando lo hagás, mandame el comprobante por aquí y lo revisamos 😊')
    for (const text of ['sinpe porfa', 'por sinpe', 'Prefiero SINPE 🙏']) {
      assert.match(decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true }).text, /^Perfecto 🙌\nSINPE Móvil: 6201 9914/, text)
    }
    assert.match(decideInbound({ inboundText: 'por transferencia', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true }).text, /^Perfecto 🙌\nTransferencia BAC\nIBAN: CR05 0152 0200 1026 2840 66/)
    assert.match(decideInbound({ inboundText: 'tarjeta', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true }).text, /Podés pagar con tarjeta en https:\/\/tienda\.example\.cr/)
    assert.equal(decideInbound({ inboundText: 'contra entrega', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true }).handled, false)
    assert.equal(paymentChoiceReply('contra_entrega'), null)
    assert.equal(paymentChoiceReply('efectivo'), null)
    // Without the question, a bare method word is not a choice (classifier path as before).
    assert.equal(decideInbound({ inboundText: 'SINPE', brandFacts: FACTS, shortcuts: SHORTCUTS }).handoff?.kind, 'handoff')
  })
  it('naming a method with an allowlisted detail ask also gets only that method', () => {
    const d = decideInbound({ inboundText: 'Quiero pagar por SINPE, ¿me pasás el número?', brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.match(d.text, /^Claro 🙌\nSINPE Móvil: 6201 9914/)
    assert.equal(d.handoff, null)
  })
  it('claims, confirm requests and disputes naming SINPE are never a choice: a person, no payment details', () => {
    for (const text of CLAIMS) {
      assert.equal(paymentChoiceShape(text, { allowAsk: true }), null, text)
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
      assert.equal(d.handoff?.kind, 'handoff', text)
      assert.doesNotMatch(d.text, /6201|CR05/, text)
    }
    for (const text of ['ya hice el sinpe', 'sinpe, ¿me confirmás cuando llegue?', 'Sinpe pagado', 'listo, sinpe', 'sinpe ✅']) {
      assert.equal(isCueFreePaymentChoiceText(text), false, text)
    }
    const human = decideInbound({ inboundText: 'quiero hablar con una persona, sinpe', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(human.handoff?.kind, 'handoff')
    assert.doesNotMatch(human.text, /6201/)
  })
  it('a method plus another question is not a choice: never a code payment reply (INT-114 allowlist supersedes F7)', () => {
    const d = decideInbound({ inboundText: 'sinpe, ¿cuándo me llega el pedido?', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(d.handoff?.kind, 'handoff')
    assert.doesNotMatch(d.text, /6201/)
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
    // luna-10 (verifier round 4): both call sites pass the sales payment options plus the customer's text since the
    // store last answered (for [[DATOS_PAGO]] names-only vs details).
    assert.equal((turn.match(/paymentOptions: \{ \.\.\.runtimeInput\.salesPaymentOptions, customerText: customerTextSinceLastAnswer\(/g) || []).length, 2)
  })
})

describe('3b. contra entrega → order_ready hand-off', () => {
  const codReply = 'Perfecto 🙌 tu pedido:\n- Combo GLP-1 + Focus\n- Total ₡20 900\n\n[[PAGO_CONTRA_ENTREGA]]\n\nEnseguida lo revisamos 😊'
  it('chosen contra entrega: the reply goes out first, then a TRUE hand-off with reason order_ready', () => {
    const policy = applyFinalOutputPolicy({ text: codReply, brandFacts: FACTS, skipPurchaseSummary: true, quoteAmounts: [20900], paymentOptions: { ...salesPaymentOptions(CTX), chosenMethod: 'contra_entrega' } })
    assert.equal(policy.ok, true, policy.reasons.join(','))
    assert.deepEqual(policy.paymentMethods, ['contra_entrega'])
    assert.deepEqual(policy.parts, ['Perfecto 🙌 tu pedido:\n- Combo GLP-1 + Focus\n- Total ₡20 900', COD_BLOCK, 'Enseguida lo revisamos 😊'])
    const ready = policy.paymentMethods.some((m) => m === 'contra_entrega' || m === 'efectivo')
    const plan = planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: null, codOrderReady: ready })
    assert.equal(HANDOFF_REASON.orderReady, 'order_ready')
    assert.deepEqual(plan, { text: policy.text, handoff: { kind: 'handoff', reason: 'order_ready' } })
    assert.equal(planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: { kind: 'handoff', reason: 'escalate' }, codOrderReady: true }).handoff?.reason, 'order_ready')
    assert.equal(planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: null, receiptCue: true, codOrderReady: true }).handoff?.reason, 'payment')
    // INT-117: a reply that failed a check goes out as the safe line, but the order still reaches a person.
    assert.deepEqual(planModelTurnDelivery({ text: policy.text, textOk: false, llmHandoff: null, codOrderReady: true }), { text: 'Dame un momento y te confirmo 😊', handoff: { kind: 'handoff', reason: 'order_ready' } })
  })
  it('the COD block on a mere question ("¿hacen contra entrega a Cartago?") is information: no hand-off (#9 / F6)', () => {
    const s = deriveSalesState({ history: [], inboundText: '¿hacen contra entrega a Cartago?', ctx: CTX })
    assert.equal(s.chosenMethod ?? null, null)
    const policy = applyFinalOutputPolicy({ text: 'Sí 😊\n\n[[PAGO_CONTRA_ENTREGA]]', brandFacts: FACTS, paymentOptions: { ...salesPaymentOptions(CTX), chosenMethod: s.chosenMethod ?? null } })
    assert.equal(policy.ok, true)
    assert.match(policy.text, /Pago contra entrega:/)
    assert.deepEqual(policy.paymentMethods, [])
    const plan = planModelTurnDelivery({ text: policy.text, textOk: true, llmHandoff: null, codOrderReady: policy.paymentMethods.some((m) => m === 'contra_entrega' || m === 'efectivo') })
    assert.equal(plan.handoff, null)
  })
  it('both turn paths wire it (settleHandoff runs after the send through finishDeliveryOrSuggest)', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal((turn.match(/codOrderReady: policy\.paymentMethods\.some\(\(m\) => m === 'contra_entrega' \|\| m === 'efectivo'\),/g) || []).length, 2)
    assert.match(turn, /if \(input\.handoff\) await settleHandoff\(input\.row, input\.handoff, input\.afterHours\)/)
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
    // Only when SINPE is an offered method (same rule as [[PAGO_SINPE]]).
    assert.match(read('src/lib/soft-ai/test-engine/run.ts'), /sinpeNumber: \(facts\.payment\?\.methods \?\? \[\]\)\.includes\('sinpe'\) \? facts\.payment\?\.sinpe\?\.number \?\? null : null,/)
    const noSinpe = generateAgentSuite({ agentName: 'X', systemInstructions: '', products: [], payment: { shareable: true, sinpeNumber: null } })
    assert.equal(noSinpe.cases.some((c) => c.id === 'pay-sinpe'), false)
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

describe('SecureDog INT-114..118', () => {
  const SECUREDOG_CLAIMS = [
    'sinpe ✅', 'SINPE✅', 'sinpe 👍', 'sinpe ✔️', 'SINPE ya hecho', 'sinpe ya enviado', 'sinpe ya mandado', 'sinpe ya realizado',
    'Sinpe: listo', 'SINPE - listo', 'sinpe, listo', 'listo, sinpe', 'hecho el sinpe', 'Hecho por SINPE', 'realizado el sinpe',
    'enviado el sinpe', 'sinpe echo', 'sinpe lsito', 'Pagado por SINPE', 'pagado por sinpe ✅', 'Ya pagado por sinpe', 'Sinpe pagado',
    'sinpe cancelado', 'sinpe exitoso', 'ahí va el sinpe', 'ahí les va el sinpe', 'sinpe en camino', 'ya va el sinpe',
    'SINPE ✅ 15.900', 'sinpe de 15900', 'sinpe por 15 mil', 'SINPE Ref: 12345678', 'referencia: 1234 SINPE', 'SINPE #20251016123',
    '¿chequearon el sinpe?', '¿Pueden verificar el sinpe?', '¿me avisan cuando les llegue el sinpe?', '¿cómo va el sinpe?',
    '¿qué pasó con el sinpe?', '¿pudieron ver el sinpe?', '¿y el sinpe?', 'sinpe duplicado', 'sinpe doble', 'el sinpe salió doble',
    'sinpe de más', 'reversen el sinpe', 'anulen el sinpe', 'estafa sinpe', 'he\u200Bcho por sinpe', 'he\u00ADcho por sinpe',
    'Pago por SINPE ✅', 'Sinpe a nombre de Juan Pérez por ₡15.900', 'Número de referencia del SINPE: 2025101612345',
  ]
  it('INT-114: never a choice, always a person, in BOTH states (awaiting the method question or not)', () => {
    for (const text of SECUREDOG_CLAIMS) {
      assert.equal(paymentChoiceShape(text, { allowAsk: true }), null, text)
      for (const awaiting of [true, false]) {
        const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: awaiting })
        assert.equal(d.handoff?.kind, 'handoff', `${text} (awaiting=${awaiting})`)
        assert.doesNotMatch(d.text, /6201|CR05/, text)
      }
    }
  })
  it('INT-114: the grammar accepts only plain choices and the strict detail ask', () => {
    for (const [text, method] of [['SINPE', 'sinpe'], ['Sinpe Móvil', 'sinpe'], ['por sinpe, porfa', 'sinpe'], ['mejor con tarjeta', 'tarjeta'], ['voy a pagar con transferencia 😊', 'transferencia'], ['¿cuál es el número de sinpe?', 'sinpe'], ['¿me pasás los datos para pagar por transferencia?', 'transferencia']] as const) {
      assert.equal(paymentChoiceShape(text, { allowAsk: true }), method, text)
    }
    for (const text of ['sinpe 💸', 'sinpe pls ya', 'por sinpe a Juan', 'sinpe o tarjeta', 'quiero sinpe y tarjeta']) {
      assert.equal(paymentChoiceShape(text, { allowAsk: true }), null, text)
    }
  })
  it('INT-115: completion words never read as an info question', () => {
    for (const text of ['Transferencia realizada', 'transferencia hecha', 'transferencia lista', 'transferencia enviada', 'Transferencia ✅', 'Listo, transferencia', 'pagado con tarjeta', 'tarjeta aprobada', 'SINPE MOVIL: Envio exitoso de 15,000.00 a 8888-8888']) {
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.paymentClass, 'payment_proof_or_risk', text)
      assert.equal(d.handoff?.kind, 'handoff', text)
    }
  })
  it('INT-116: payment processors are shared hosts; card link https only; paypal.me/ATTACKER fails', () => {
    assert.throws(() => parseBrandFacts({ payment: { cardUrl: 'http://pagos.example.cr' } }))
    const card = parseBrandFacts({ ...FACTS, payment: { ...FACTS.payment, cardUrl: 'https://paypal.me/tienda' } })
    const allow = brandFactsLinkAllowlist(card, ['Pagá en https://paypal.me/tienda'])
    assert.equal(allow.hosts.includes('paypal.me'), false)
    const bad = applyFinalOutputPolicy({ text: 'Pagá en https://paypal.me/ATTACKER', brandFacts: card, linkAllowlist: allow })
    assert.ok(bad.reasons.includes('foreign_link'))
    const ok = applyFinalOutputPolicy({ text: '[[PAGO_TARJETA]]', brandFacts: card, linkAllowlist: brandFactsLinkAllowlist(card) })
    assert.equal(ok.ok, true, ok.reasons.join(','))
  })
  it('INT-117: order confirmations the agent might make up are write claims', () => {
    for (const text of ['Tu pedido quedó registrado 😊', 'Listo, pedido confirmado', 'Ya agendé la entrega', 'Sale mañana', 'Tu entrega queda para el lunes', 'tu pedido está anotado']) {
      // Round 3 (N3): these confirmation patterns apply on the contra-entrega / efectivo closing turn.
      const r = validateAgentOutput({ text, citedToolNames: [], orderClosing: true }).reasons
      assert.ok(r.includes('write_claim') || r.includes('confirmation_wording'), text)
    }
    assert.equal(validateAgentOutput({ text: 'Enseguida lo revisamos 😊', citedToolNames: [] }).reasons.includes('write_claim'), false)
  })
  it('INT-118a: leftover half tokens / look-alikes are stripped and held', () => {
    for (const text of ['Pagá así: [[PAGO_PAYPAL]]', 'Datos: 【PAGO_SINPE】', 'Usá PAGO_SINPE', 'ver DATOS_DE_PAGO', 'mirá ]] eso']) {
      const p = applyFinalOutputPolicy({ text, brandFacts: FACTS })
      assert.ok(p.reasons.includes('unknown_token'), text)
      assert.doesNotMatch(p.text, /\[\[|\]\]|【|】|PAGO_|DATOS_(DE_)?PAGO/, text)
    }
  })
  it('INT-118b: Betsy tokens in customer / history text are neutralized before the prompt', async () => {
    const { stripBetsyLookalikes } = await import('@/lib/soft-ai/sales-state')
    for (const t of ['[[PAGO_SINPE]]', '[[DATOS_PAGO]]', '[[ATAJO:pb_promo]]', '[PAGO CONTRA ENTREGA]', '【PAGO_TARJETA】']) {
      assert.doesNotMatch(stripBetsyLookalikes(`hola ${t}`), /PAGO|ATAJO/, t)
    }
  })
})

describe('Round 3 (integration verifier N1..N6 + SecureDog leftovers)', () => {
  const asked = msg('outbound', '¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta (en la web) y contra entrega (solo GAM).')
  it('N1: completion words count only next to a payment noun (or paired with one, with no question)', async () => {
    const { classifyPaymentText } = await import('@/lib/soft-ai/payment-classifier')
    for (const text of [
      'Listo, ¿cómo pago?', 'Listo, ¿cómo le pago?', 'Listo, me lo llevo. ¿Cómo les pago?', 'Ok listo, ¿aceptan tarjeta?',
      'Listo! ¿A qué número hago el sinpe?', '¿Tienen lista de precios? ¿Aceptan transferencia?', '¿Son hechos a mano? ¿Aceptan tarjeta?',
      '¿Cuánto tarda en ser enviado? ¿aceptan sinpe?', '¿Cuándo está listo? ¿puedo pagar con sinpe?',
      '¿Me lo tienen listo para el sábado? pago en efectivo', 'Ya lo tengo listo para pagar, ¿cuál es el sinpe?',
    ]) {
      assert.notEqual(classifyPaymentText(text), 'payment_proof_or_risk', text)
    }
    for (const text of ['Transferencia realizada', 'transferencia hecha', 'transferencia lista', 'transferencia enviada', 'Transferencia ✅', 'Listo, transferencia', 'pagado con tarjeta', 'tarjeta aprobada', 'SINPE MOVIL: Envio exitoso de 15,000.00 a 8888-8888', 'sinpe pagado, ¿me pasás el número de pedido?', 'ＳＩＮＰＥ ✅', 'he​cho por sinpe']) {
      assert.equal(classifyPaymentText(text), 'payment_proof_or_risk', text)
    }
  })
  it('INT-114 / INT-115 positives still hand off after the round-3 changes', () => {
    for (const text of [...CLAIMS]) {
      for (const awaiting of [true, false]) {
        const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: awaiting })
        assert.equal(d.handoff?.kind, 'handoff', `${text} (${awaiting})`)
      }
    }
  })
  it('N2: a contra-entrega choice is carried to the turn with the order data → order_ready (flow A and B)', () => {
    const histA = [msg('outbound', 'El combo queda en ₡20 900'), asked, msg('inbound', 'contra entrega'), msg('outbound', 'Perfecto 🙌 pasame:\n- Nombre completo\n- Dirección exacta')]
    const sA = deriveSalesState({ history: histA, inboundText: 'Juan Pérez, Heredia centro, 100 m norte de la iglesia', ctx: CTX })
    assert.deepEqual([sA.stage, sA.chosenMethod], ['metodo_pago', 'contra_entrega'])
    const reply = 'Perfecto 🙌 tu pedido:\n- Combo GLP-1 + Focus\n- Total ₡20 900\n- Juan Pérez, Heredia centro\n\n[[PAGO_CONTRA_ENTREGA]]\n\nEnseguida lo revisamos 😊'
    const p = applyFinalOutputPolicy({ text: reply, brandFacts: FACTS, skipPurchaseSummary: true, quoteAmounts: [20900], paymentOptions: { ...salesPaymentOptions(CTX), chosenMethod: sA.chosenMethod ?? null } })
    assert.equal(p.ok, true, p.reasons.join(','))
    const plan = planModelTurnDelivery({ text: p.text, textOk: p.ok, llmHandoff: null, codOrderReady: p.paymentMethods.some((x) => x === 'contra_entrega' || x === 'efectivo') })
    assert.equal(plan.handoff?.reason, 'order_ready')
    const sB = deriveSalesState({ history: [msg('outbound', 'El combo queda en ₡20 900'), asked], inboundText: 'contra entrega, a nombre de Juan Pérez en Heredia centro', ctx: CTX })
    assert.deepEqual([sB.stage, sB.chosenMethod], ['metodo_pago', 'contra_entrega'])
    assert.match(sB.nextStep, /\[\[PAGO_CONTRA_ENTREGA\]\]/)
    // A question (no choice) is never carried: no hand-off.
    const q = deriveSalesState({ history: [msg('outbound', 'Queda en ₡15 900'), asked], inboundText: '¿hacen contra entrega a Cartago?', ctx: CTX })
    assert.equal(q.chosenMethod ?? null, null)
  })
  it('N3: delivery wording is fine outside the COD closing turn; confirmations still blocked on it', () => {
    for (const text of ['El envío sale mañana y llega en 2 días 😊', 'Si lo pedís hoy antes de las 2, sale hoy mismo por Correos.', 'Con la promo te sale hoy en ₡10 000', 'Tu pedido está listo para retirar en tienda']) {
      assert.equal(validateAgentOutput({ text, citedToolNames: [], quoteAmounts: [10000] }).reasons.includes('write_claim'), false, text)
    }
    const cod = applyFinalOutputPolicy({ text: '¡Listo! Tu pedido quedó registrado ✅\n\n[[PAGO_CONTRA_ENTREGA]]', brandFacts: FACTS, paymentOptions: { ...salesPaymentOptions(CTX), chosenMethod: 'contra_entrega' } })
    assert.ok(cod.reasons.includes('write_claim'))
    const plan = planModelTurnDelivery({ text: cod.text, textOk: cod.ok, llmHandoff: null, codOrderReady: cod.paymentMethods.includes('contra_entrega') })
    assert.deepEqual(plan, { text: 'Dame un momento y te confirmo 😊', handoff: { kind: 'handoff', reason: 'order_ready' } })
    for (const text of ['Te lo mando mañana', 'Mañana te llega 😊', 'Quedó programado', 'Te lo despachamos hoy', 'Ya va en camino', 'Anoté tu pedido', 'Tu orden quedó lista']) {
      const r = validateAgentOutput({ text, citedToolNames: [], orderClosing: true }).reasons
      assert.ok(r.includes('write_claim'), text)
    }
  })
  it('N4: wider choice grammar; one method + other content with the question pending → the model', () => {
    for (const [text, method] of [['Prefiero pagar por sinpe', 'sinpe'], ['Te pago por sinpe', 'sinpe'], ['Por SINPE está bien', 'sinpe'], ['sinpe mejor', 'sinpe'], ['Prefiero pagar con tarjeta', 'tarjeta'], ['Por transferencia está bien', 'transferencia'], ['Tarjeta, por la web', 'tarjeta']] as const) {
      assert.equal(paymentChoiceShape(text), method, text)
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
      assert.match(d.text, /^Perfecto 🙌\n/, text)
    }
    assert.equal(decideInbound({ inboundText: 'Sinpe 👍', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true }).handoff?.kind, 'handoff')
    const mixed = decideInbound({ inboundText: 'Por sinpe y retiro en tienda', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(mixed.handled, false)
    const s = deriveSalesState({ history: [msg('outbound', 'Queda en ₡15 900'), asked], inboundText: 'Por sinpe y retiro en tienda', ctx: CTX })
    assert.equal(s.chosenMethod, 'sinpe')
    // Never the method list again while the question is pending.
    const again = decideInbound({ inboundText: '¿cómo puedo pagar?', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.notEqual(again.shortcutKey, 'sys_payment_info')
  })
  it('N5: an order block is not "payment details": no receipt asked, a later photo is not a receipt because of it', async () => {
    const { mediaAwaitingReceipt } = await import('@/lib/soft-ai/sales-state')
    const hist = [msg('outbound', 'Queda en ₡15 900'), msg('inbound', 'contra entrega'), msg('outbound', COD_BLOCK)]
    assert.equal(paymentDetailsIn(COD_BLOCK), false)
    const s = deriveSalesState({ history: hist, inboundText: '¿y cuándo llega?', ctx: CTX })
    assert.equal(s.stage, 'pedido_en_revision')
    assert.doesNotMatch(s.nextStep, /mand[aá]me el comprobante/)
    assert.equal(salesAwaitingReceipt(s), false)
    assert.equal(mediaAwaitingReceipt('image', hist, null), false)
    assert.equal(awaitingPaymentMethodChoice([...hist.slice(0, 1), asked, msg('outbound', COD_BLOCK)]), false)
  })
  it('N6: a cash order is its own review reason, same order review kind / tag', async () => {
    const { reviewKindForHandoffCode, HANDOFF_REASON_LABELS } = await import('@/lib/workspace-notifications')
    assert.equal(reviewKindForHandoffCode('order_ready_cash'), 'order_review')
    assert.equal(HANDOFF_REASON_LABELS.order_ready_cash, 'Pidió pagar en efectivo — confirmá los datos')
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, codOrderReady: true, orderReadyCash: true }).handoff?.reason, 'order_ready_cash')
    assert.equal((read('src/lib/soft-ai/agent-turn.ts').match(/orderReadyCash: policy\.paymentMethods\.includes\('efectivo'\),/g) || []).length, 2)
    assert.match(read('src/lib/soft-ai/handoff-notify.ts'), /code === 'order_ready' \|\| code === 'order_ready_cash'\) return ORDER_REVIEW_TAG/)
  })
  it('leftovers: single-bracket / bare token look-alikes are stripped; internal hrefs use the shared guard', async () => {
    for (const text of ['Pagá así: [PAGO PAYPAL]', 'Usá PAGO-SINPE', 'Te paso los DATOS PAGO']) {
      const p = applyFinalOutputPolicy({ text, brandFacts: FACTS })
      assert.ok(p.reasons.includes('unknown_token'), text)
    }
    const { isSafeInternalHref } = await import('@/lib/notification-alerts')
    for (const bad of ['/\t/evil.com', '/\n/evil.com', '//evil.com', '/\\evil.com', 'https://evil.com']) assert.equal(isSafeInternalHref(bad), false, JSON.stringify(bad))
    assert.equal(isSafeInternalHref('/chats?c=abc'), true)
  })
})

describe('Round 3 follow-up: intent phrasing is never a completion claim', () => {
  it('the five phrases go to the agent (choice / model), never a hand-off', async () => {
    const { classifyPaymentText } = await import('@/lib/soft-ai/payment-classifier')
    for (const text of ['Listo, quiero pagar por sinpe', 'Lista, ¿por sinpe?', '¿El pago tiene que estar hecho antes del envío?', '¿El pedido es enviado después del pago?']) {
      assert.notEqual(classifyPaymentText(text), 'payment_proof_or_risk', text)
      for (const awaiting of [true, false]) {
        const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: awaiting })
        assert.notEqual(d.handoff?.kind, 'handoff', `${text} (${awaiting})`)
      }
    }
    // SecureDog (INT-114 reopened): "por sinpe a nombre de María" may hand off — a payee name next to a payment noun.
    const named = decideInbound({ inboundText: 'por sinpe a nombre de María', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(named.handoff?.kind, 'handoff')
  })
  it('strong markers still win over intent wording; INT-114/115 positives still hand off in both states', () => {
    for (const text of ['Quiero pagar por sinpe, ya lo hice ✅', 'Prefiero pagar por sinpe pero ya le había pagado al otro número', 'Quería pagar por sinpe, comprobante adjunto', 'Para pagar hice el sinpe de 15 mil']) {
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.handoff?.kind, 'handoff', text)
    }
    for (const text of CLAIMS) {
      for (const awaiting of [true, false]) {
        assert.equal(decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: awaiting }).handoff?.kind, 'handoff', `${text} (${awaiting})`)
      }
    }
  })
})

describe('SecureDog INT-114 reopened: safety first, then choices', () => {
  const MUST_HAND_OFF = [
    'verifiquen el sinpe porfa', 'lo pagó mi mamá por sinpe', 'mi esposo hizo el sinpe', 'mi hermana mandó el sinpe',
    'mi mamá le depositó por sinpe', 'el sinpe salió', 'el sinpe de ayer', 'sinpe se fue', 'sinpe esta mañana',
    'sinpe hoy en la mañana', 'sinpe a las tres', 'por sinpe hace un momento', 'sinpe desde la cuenta de mi esposo',
    'sinpe al número que me diste', 'sinpe a nombre de Rafael', 'sinpe efectuado', 'sinpe completo', 'sinpe OK',
    'quiero pagar, la transferencia salió bien', 'Le pago por sinpe, ahí le va', 'te pago por sinpe, ahí te va',
    'quiero pagar por sinpe, ahí va', 'le pago por sinpe, me avisa', 'quiero pagar, el sinpe salió',
    'para pagar el sinpe de ayer',
  ]
  it('status / third-person / time / payee wording hands off in BOTH states (plus every earlier list)', () => {
    for (const text of [...MUST_HAND_OFF, ...CLAIMS]) {
      for (const awaiting of [true, false]) {
        const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: awaiting })
        assert.equal(d.handoff?.kind, 'handoff', `${text} (awaiting=${awaiting})`)
        assert.doesNotMatch(d.text, /6201|CR05/, text)
      }
    }
  })
  it('choices, intent and info questions still reach the agent', async () => {
    const { classifyPaymentText } = await import('@/lib/soft-ai/payment-classifier')
    for (const text of ['Listo, ¿cómo pago?', 'Listo, ¿cómo le pago?', 'Listo, me lo llevo. ¿Cómo les pago?', 'Ok listo, ¿aceptan tarjeta?', 'Listo! ¿A qué número hago el sinpe?', '¿Tienen lista de precios? ¿Aceptan transferencia?', '¿Son hechos a mano? ¿Aceptan tarjeta?', '¿Cuánto tarda en ser enviado? ¿aceptan sinpe?', '¿Cuándo está listo? ¿puedo pagar con sinpe?', '¿Me lo tienen listo para el sábado? pago en efectivo', 'Ya lo tengo listo para pagar, ¿cuál es el sinpe?', 'Listo, quiero pagar por sinpe', 'Lista, ¿por sinpe?', '¿El pago tiene que estar hecho antes del envío?', '¿El pedido es enviado después del pago?']) {
      assert.notEqual(classifyPaymentText(text), 'payment_proof_or_risk', text)
    }
    for (const text of ['Prefiero pagar por sinpe', 'Te pago por sinpe', 'Por SINPE está bien', 'sinpe mejor']) {
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
      assert.equal(d.handoff, null, text)
      assert.match(d.text, /^Perfecto 🙌\nSINPE Móvil: 6201 9914/, text)
    }
    const logistics = decideInbound({ inboundText: 'Por sinpe y retiro en tienda', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(logistics.handled, false)
    assert.equal(logistics.handoff, null)
  })
  it('structure: the classifier / safety hand-off runs before any choice or mention route', () => {
    const src = read('src/lib/soft-ai/inbound-decision.ts')
    const safetyAt = src.indexOf('  if (safety.escalate) {')
    assert.ok(safetyAt > 0 && safetyAt < src.indexOf('const choice = textMessage'))
    assert.ok(safetyAt < src.indexOf('pendingMethodMention(input.inboundText)'))
    assert.match(src, /paymentClass !== 'payment_proof_or_risk'/)
  })
  it('a mention routes to the model only for exact choice + logistics; other extra words do not', async () => {
    const { pendingMethodMention } = await import('@/lib/soft-ai/payment-classifier')
    for (const [text, m] of [['Por sinpe y retiro en tienda', 'sinpe'], ['sinpe, con envío a Heredia', 'sinpe'], ['tarjeta a domicilio', 'tarjeta'], ['por transferencia para Cartago', 'transferencia']] as const) {
      assert.equal(pendingMethodMention(text), m, text)
    }
    for (const text of ['Sinpe. Lo hago en la noche', 'por sinpe a nombre de María', 'sinpe para el pedido de ayer', 'mejor no por sinpe', 'sinpe no']) {
      assert.equal(pendingMethodMention(text), null, text)
    }
  })
  it('negations are never choices or carried methods; the LAST named method is carried', () => {
    const asked = msg('outbound', '¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta (en la web) y contra entrega (solo GAM).')
    for (const text of ['no quiero contra entrega', 'no tengo efectivo', 'sinpe no', 'no tengo sinpe', 'mejor no por sinpe']) {
      assert.equal(paymentChoiceShape(text, { allowAsk: true }), null, text)
      assert.equal(deriveSalesState({ history: [msg('outbound', 'Queda en ₡15 900'), asked], inboundText: text, ctx: CTX }).chosenMethod ?? null, null, text)
    }
    const s = deriveSalesState({ history: [msg('outbound', 'Queda en ₡15 900'), asked], inboundText: 'antes pagaba contra entrega pero ahora prefiero sinpe', ctx: CTX })
    assert.equal(s.chosenMethod, 'sinpe')
  })
  it('N6 wording: a cash order review says efectivo (bell / toast from the dedupe key)', async () => {
    const { reviewNotificationText, orderIsCashFromDedupeKey } = await import('@/lib/workspace-notifications')
    assert.equal(orderIsCashFromDedupeKey('ai_handoff:conv:msg123456:order_ready_cash'), true)
    assert.equal(orderIsCashFromDedupeKey('ai_handoff:conv:msg123456:order_ready'), false)
    assert.equal(reviewNotificationText('order_review', 'Ana', 'receipt', true).snippet, 'Pidió pagar en efectivo — confirmá los datos')
    assert.equal(reviewNotificationText('order_review', 'Ana').snippet, 'Pidió contra entrega — confirmá los datos')
  })
})

describe('luna-10 exam round 2: the payment-info reply never dumps every account', () => {
  const DUMP = SHORTCUTS.map((s) => (s.key === 'sys_payment_info' ? { ...s, body: 'Puedes pagar así: {{brand.payment.summary}}. Cuando lo hagas, mándame el comprobante 😊' } : s))
  it('a saved reply built on {{brand.payment.summary}} is replaced by the method list + question', () => {
    const d = decideInbound({ inboundText: '¿cómo puedo pagar?', brandFacts: FACTS, shortcuts: DUMP })
    assert.equal(d.text, 'Podés pagar con:\n- SINPE Móvil\n- Transferencia\n- Tarjeta (en la web)\n- Contra entrega (solo GAM)\n\n¿Cómo preferís pagar?')
    assert.doesNotMatch(d.text, /CR05|contra_entrega|Métodos:/)
  })
  it('one method named → only that method; a link ask → the card; link + product question → the model', () => {
    const card = decideInbound({ inboundText: 'Se puede pagar con tarjeta?', brandFacts: FACTS, shortcuts: DUMP })
    assert.match(card.text, /Podés pagar con tarjeta en https:\/\/tienda\.example\.cr/)
    assert.doesNotMatch(card.text, /CR05/)
    const link = decideInbound({ inboundText: 'Quiero comprar los 2 . Me envías el link de pago', brandFacts: FACTS, shortcuts: DUMP })
    assert.match(link.text, /tienda\.example\.cr/)
    assert.doesNotMatch(link.text, /CR05/)
    const both = decideInbound({ inboundText: 'Muchas gracias \nTienes link de pago? Para la ansiedad cuáles me \nRecomiendas?', brandFacts: FACTS, shortcuts: DUMP })
    assert.equal(both.handled, false)
  })
})
