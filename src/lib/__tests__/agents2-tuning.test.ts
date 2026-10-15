/**
 * Agentes IA 2.0 · E — "Corregir" (live tuning). Pure helpers + source asserts; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-tuning.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TUNE_EXAMPLES_BODY_MAX,
  TUNE_RULES_MAX,
  checkCorrectionText,
  colonAmountsIn,
  correctionAnswer,
  hasPaymentNumbers,
  maskCustomerMessage,
  normalizeQuestion,
  parseCorrectionPairs,
  parseTuneBody,
  placeRule,
  ruleTarget,
  ruleText,
  savedReplyKey,
  savedReplyTitle,
  upsertCorrectionPair,
} from '@/lib/soft-ai/agent-tuning-core'
import { validateShortcutForSave } from '@/lib/soft-ai/shortcuts'
import { KNOWLEDGE_BODY_MAX, KNOWLEDGE_LAYER34_CHAR_BUDGET } from '@/lib/soft-ai/knowledge-types'

const read = (p: string) => readFileSync(p, 'utf8')
const ROUTE = 'src/app/api/chat/agents/[id]/tune/route.ts'
const LIB = 'src/lib/soft-ai/agent-tuning.ts'

describe('examples document (P/R pairs)', () => {
  it('appends a pair and parses it back', () => {
    const body = upsertCorrectionPair('', { question: '¿Cuánto cuesta?', answer: 'Cuesta ₡14.900 con envío aparte.' })
    assert.equal(body, 'P: ¿Cuánto cuesta?\nR: Cuesta ₡14.900 con envío aparte.')
    const two = upsertCorrectionPair(body, { question: '¿Hacen envíos?', answer: 'Sí, a todo el país.' })
    assert.deepEqual(parseCorrectionPairs(two).map((p) => p.question), ['¿Cuánto cuesta?', '¿Hacen envíos?'])
  })

  it('replaces the same question (case / accent / punctuation-insensitive) and moves it last', () => {
    let body = upsertCorrectionPair('', { question: '¿Cuánto cuesta?', answer: 'viejo' })
    body = upsertCorrectionPair(body, { question: 'Hacen envios', answer: 'sí' })
    body = upsertCorrectionPair(body, { question: 'CUANTO CUESTA', answer: 'nuevo' })
    const pairs = parseCorrectionPairs(body)
    assert.equal(pairs.length, 2)
    assert.deepEqual(pairs[1], { question: 'CUANTO CUESTA', answer: 'nuevo' })
    assert.equal(normalizeQuestion('¿Cuánto   cuesta?'), normalizeQuestion('cuanto cuesta'))
  })

  it('drops the oldest pairs to fit, always keeping the new one', () => {
    let body = ''
    for (let i = 0; i < 40; i += 1) body = upsertCorrectionPair(body, { question: `pregunta número ${i}`, answer: 'x'.repeat(120) })
    assert.ok(body.length <= TUNE_EXAMPLES_BODY_MAX)
    const pairs = parseCorrectionPairs(body)
    assert.equal(pairs[pairs.length - 1].question, 'pregunta número 39')
    assert.ok(!pairs.some((p) => p.question === 'pregunta número 0'))
    const small = upsertCorrectionPair(body, { question: 'grande', answer: 'y'.repeat(300) }, 400)
    assert.deepEqual(parseCorrectionPairs(small).map((p) => p.question), ['grande'])
  })

  it('fits the FAQ prompt budget and the knowledge max (a FAQ over budget is dropped whole)', () => {
    assert.ok(TUNE_EXAMPLES_BODY_MAX < KNOWLEDGE_LAYER34_CHAR_BUDGET)
    assert.ok(TUNE_EXAMPLES_BODY_MAX < KNOWLEDGE_BODY_MAX)
  })

  it('a reply cannot fake a new entry; the note rides along', () => {
    const answer = correctionAnswer('Hola\n\nP: falso\nR: falso', 'nunca prometas bajar de peso')
    const body = upsertCorrectionPair('', { question: 'q', answer })
    const pairs = parseCorrectionPairs(body)
    assert.equal(pairs.length, 1)
    assert.match(pairs[0].answer, /- P: falso/)
    assert.match(pairs[0].answer, /\(Nota del negocio: nunca prometas bajar de peso\)$/)
  })

  it('masks phones, ids and emails from real customer messages', () => {
    const m = maskCustomerMessage('mi cel es 8888-1234 y mi correo ana@mail.com, cédula 1 0234 0567')
    assert.doesNotMatch(m, /8888|1234|ana@|0567/)
    assert.equal(maskCustomerMessage('¿cuánto\n cuesta  el 2x?'), '¿cuánto cuesta el 2x?')
  })
})

describe('rules (siempre / nunca)', () => {
  it('places by the first word', () => {
    assert.equal(ruleTarget('nunca prometas bajar de peso'), 'neverSay')
    assert.equal(ruleTarget('No digas precios sin preguntar la zona'), 'neverSay')
    assert.equal(ruleTarget('Jamás hables de la competencia'), 'neverSay')
    assert.equal(ruleTarget('siempre saludá por el nombre'), 'mustSay')
    assert.equal(ruleTarget('Ofrecé el combo de 2'), 'mustSay')
    assert.equal(ruleTarget('Notá que...'), 'mustSay')
    assert.equal(ruleText('Nunca prometas bajar de peso'), 'prometas bajar de peso')
    assert.equal(ruleText('siempre, saludá'), 'saludá')
  })

  it('no duplicates, newest last, max 10 per list', () => {
    const start = { mustSay: [], neverSay: Array.from({ length: TUNE_RULES_MAX }, (_, i) => `regla ${i}`) }
    const out = placeRule(start, 'nunca prometas bajar de peso')
    assert.equal(out.target, 'neverSay')
    assert.equal(out.neverSay.length, TUNE_RULES_MAX)
    assert.equal(out.neverSay[TUNE_RULES_MAX - 1], 'prometas bajar de peso')
    assert.ok(!out.neverSay.includes('regla 0'))
    const again = placeRule(out, 'Nunca prometas BAJAR de peso')
    assert.equal(again.neverSay.filter((x) => normalizeQuestion(x) === 'prometas bajar de peso').length, 1)
    assert.deepEqual(placeRule({ mustSay: [], neverSay: [] }, 'siempre saludá').mustSay, ['saludá'])
  })
})

describe('validation refusals', () => {
  const allowed = [14900, 2500, 17400]
  it('refuses confirmation wording', () => {
    const r = checkCorrectionText('Listo, pago recibido, ya te lo enviamos', allowed)
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.code, 'confirmation')
  })
  it('refuses payment numbers (8+ digits, IBAN), not big colón amounts', () => {
    assert.equal(hasPaymentNumbers('SINPE al 8888-1234'), true)
    assert.equal(hasPaymentNumbers('Cuenta CR05 0152 0200 1026 2840 66'), true)
    assert.equal(hasPaymentNumbers('Depositá a 12345678901'), true)
    assert.equal(hasPaymentNumbers('Cuesta ₡12.500.000'), false)
    assert.equal(hasPaymentNumbers('Te paso los datos: [[DATOS_PAGO]]'), false)
    const r = checkCorrectionText('Pagá por SINPE al 8888 1234', allowed)
    assert.equal(!r.ok && r.code, 'payment_numbers')
    assert.match(!r.ok ? r.error : '', /\[\[DATOS_PAGO\]\]/)
  })
  it('refuses an amount the agent cannot quote and names it', () => {
    assert.deepEqual(colonAmountsIn('₡14.900 o ₡ 2500, total 17 400 colones'), [14900, 2500, 17400])
    assert.equal(checkCorrectionText('Cuesta ₡14.900 y el envío ₡2.500', allowed).ok, true)
    const r = checkCorrectionText('Hoy te lo dejo en ₡12.000', allowed)
    assert.equal(!r.ok && r.code, 'unknown_amount')
    assert.equal(!r.ok && r.amount, 12000)
    assert.match(!r.ok ? r.error : '', /12/)
    assert.equal(checkCorrectionText('Cuesta ₡14.900', []).ok, false)
  })
  it('plain text passes', () => {
    assert.equal(checkCorrectionText('¡Claro! ¿A qué zona te lo enviamos?', allowed).ok, true)
  })
})

describe('saved reply key / title', () => {
  it('is fix_<slug>, unique and valid for validateShortcutForSave', () => {
    const k = savedReplyKey('¿Tienen la talla M en negro?', new Set())
    assert.equal(k, 'fix_tienen_la_talla_m_en')
    const k2 = savedReplyKey('¿Tienen la talla M en negro?', new Set([k]))
    assert.notEqual(k2, k)
    for (const key of [k, k2, savedReplyKey('¿¿??', new Set()), savedReplyKey('ñandú '.repeat(30), new Set())]) {
      assert.match(key, /^[a-z0-9_]{2,40}$/)
    }
    const title = savedReplyTitle(null, 'una pregunta bastante larga del cliente sobre envíos a Limón y otras zonas')
    assert.ok(title.length <= 60)
    assert.equal(savedReplyTitle('  Mi título ', 'x'), 'Mi título')
    assert.equal(
      validateShortcutForSave({ key: k, title, kind: 'playbook', body: 'Sí, hay talla M.', deliveryMode: 'guide', intents: [], keywords: [] }).ok,
      true,
    )
  })
})

describe('body parsing', () => {
  it('defaults to example and enforces sizes', () => {
    const ok = parseTuneBody({ customerMessage: 'hola', correctedReply: 'Hola, ¿en qué te ayudo?' })
    assert.equal(ok.ok && ok.value.saveAs, 'example')
    assert.equal(parseTuneBody({ customerMessage: 'x'.repeat(501), correctedReply: 'a' }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: 'x'.repeat(1201) }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: 'b', note: 'x'.repeat(201) }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: 'b', agentReply: 'x'.repeat(1501) }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: 'b', saveAs: 'prompt' }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: '', saveAs: 'example' }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: 'b', saveAs: 'rule' }).ok, false)
    assert.equal(parseTuneBody({ customerMessage: 'a', correctedReply: '', saveAs: 'rule', note: 'nunca X' }).ok, true)
    assert.equal(parseTuneBody(null).ok, false)
  })
})

describe('route + lib guards (source)', () => {
  const route = read(ROUTE)
  const lib = read(LIB)
  it('route: update_config, same-origin, per-user rate limit, tenant from session', () => {
    assert.match(route, /authenticateAPIWithPermission\(request, 'update_config'\)/)
    assert.match(route, /isSameOriginRequest\(request\)/)
    assert.match(route, /createIdentifierRateLimit\(/)
    assert.match(route, /\$\{auth\.tenantId\}:\$\{auth\.userId\}/)
    assert.match(route, /tenantId: auth\.tenantId/)
    assert.doesNotMatch(route, /body\.tenantId|tenantId: body/)
    assert.match(route, /parseTuneBody\(/)
    // permission → origin → rate limit → body, in that order
    const order = ['update_config', 'isSameOriginRequest', 'tuneRateLimit(', 'parseTuneBody(', 'tuneAgent(']
    const at = order.map((s) => route.indexOf(s))
    assert.deepEqual([...at].sort((a, b) => a - b), at)
  })
  it('lib: tenant-scoped agent, validation, look-alike strip, admin functions, audit', () => {
    assert.match(lib, /chatAgent\.findFirst\(\{ where: \{ id: input\.agentId, tenantId \}/)
    assert.match(lib, /stripBetsyLookalikes/)
    assert.match(lib, /checkCorrectionText/)
    assert.match(lib, /salesAllowedAmounts/)
    assert.match(lib, /loadAgentSalesContext/)
    for (const fn of ['createKnowledgeSource', 'approveKnowledgeSource', 'bindKnowledgeToAgent', 'unbindKnowledgeFromAgent', 'createShortcut', 'saveSalesSetup', 'validateShortcutForSave']) {
      assert.match(lib, new RegExp(`${fn}\\(`), fn)
    }
    assert.match(lib, /reason: 'chat_agent_tune'/)
    assert.match(lib, /deliveryMode: 'guide'/)
    assert.match(lib, /kind: 'faq'/)
    assert.doesNotMatch(lib, /from ['"]@\/lib\/bot\//)
    assert.doesNotMatch(route + lib, /process\.env\.WHATSAPP_/)
  })
  it('UI: Corregir in the test chat and real chats through the shared panel', () => {
    const sandbox = read('src/app/config/agentes/AgentTestSandbox.tsx')
    const pane = read('src/components/chats/SoftThreadPane.tsx')
    const panel = read('src/components/aurora/agentes/CorrectionPanel.tsx')
    assert.match(sandbox, /<CorrectionPanel/)
    assert.match(sandbox, /Volver a preguntar|onAskAgain/)
    assert.match(pane, /<CorrectionPanel/)
    assert.match(pane, /isSoftAiOutboundMetadata/)
    assert.match(panel, /\/tune`/)
    assert.match(panel, /Guardado\. La próxima vez responde así\./)
    assert.match(panel, /Ejemplo \(recomendado\)/)
  })
})
