import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  customerTextsForPrefill,
  detectOrderChoices,
  finalizeCustomer,
  labelledCustomerFields,
  matchPrefillProducts,
  normalizeLocation,
  productWords,
} from '../chat-order-prefill-core'

const INVENTORY = [
  { id: 'glp', name: 'GLP Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'focus', name: 'Focus Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'energy', name: 'Energy Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'stress', name: 'Stress Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'dopa', name: 'Dopamine Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'sleep', name: 'SleepingPatches', category: 'Parche', sellingPrice: 9900 },
  { id: 'bucal', name: 'Bucal DeepSleep', category: 'Bucal', sellingPrice: 9900 },
  { id: 'deep', name: 'DeepSleep', category: 'Parche', sellingPrice: 9900 },
  { id: 'fresa', name: 'Pura Sonrisa  Fresa ', category: 'Blanqueamiento Dental', sellingPrice: 10450 },
  { id: 'arnml', name: 'ARNESS FORGE M/L', category: 'ARNESS', sellingPrice: 14900 },
  { id: 'arnxl', name: 'ARNESS FORGE  XL', category: 'ARNESS', sellingPrice: 14900 },
]
const ids = (ps: Array<{ id: string; cantidad: number }>) => ps.map((p) => [p.id, p.cantidad]).sort()

describe('chat → order prefill: customer data (verifier round 1)', () => {
  it('reads only the customer, without placeholders', () => {
    const texts = customerTextsForPrefill([
      { direction: 'inbound', content: '[ig_post]' },
      { direction: 'inbound', content: 'Hola GLP-1' },
      { direction: 'outbound', content: '- Focus - Energy - Stress Relief - Dopamine - GLP-1' },
    ])
    assert.deepEqual(texts, ['Hola GLP-1'])
  })

  it('free chat lines never become the name / address / phone (no first-line or any-digits guessing)', () => {
    const a = labelledCustomerFields(['Hola GLP-1', 'Me interesa'])
    assert.equal(a.name, '')
    const b = labelledCustomerFields(['Buenas', 'Quiero 2 de energía y uno de dopamina'])
    assert.deepEqual([b.name, b.address], ['', ''])
    const c = labelledCustomerFields(['cedula 1 1234 0567'])
    assert.equal(c.phone, '')
  })

  it('labelled lines, a valid email, a phone alone on its line and a real location run are used', () => {
    const f = labelledCustomerFields([
      'Nombre: Daniela Araya Rodriguez',
      'Telefono :60517646',
      'Provincia: Heredia\nCanton:Barva\nDistrito: San Pedro',
      'Dirección: De la iglesia Católica de puente Salas, 125 Norte',
    ])
    assert.equal(f.name, 'Daniela Araya Rodriguez')
    assert.equal(f.phone, '60517646')
    assert.equal(f.address, 'De la iglesia Católica de puente Salas, 125 Norte')
    const g = labelledCustomerFields(['Esteban García Román\n84475680\nEsteban.g1988@icloud.com\nSan José\nMoravia\nSan Vicente\nUniversidad católica'])
    assert.deepEqual([g.name, g.phone, g.email], ['', '84475680', 'Esteban.g1988@icloud.com'])
    assert.deepEqual([g.province, g.canton, g.district], ['San José', 'Moravia', 'San Vicente'])
  })

  it('locations must exist in Costa Rica; an unknown level is dropped with everything below it', () => {
    assert.deepEqual(normalizeLocation({ province: 'heredia', canton: 'barva', district: 'san pedro' }), { province: 'Heredia', canton: 'Barva', district: 'San Pedro' })
    assert.deepEqual(normalizeLocation({ province: 'vivo en Heredia, San Pablo', canton: 'x' }), { province: '', canton: '', district: '' })
    assert.deepEqual(normalizeLocation({ province: 'Heredia', canton: 'Narnia', district: 'x' }), { province: 'Heredia', canton: '', district: '' })
    // A canton that exists in only one province fills it.
    assert.equal(normalizeLocation({ canton: 'Moravia' }).province, 'San José')
    const fin = finalizeCustomer({ name: ' Ana ', phone: '+506 8447-5680', email: 'no es correo', province: 'Limón?', canton: '', district: '', address: '' })
    assert.deepEqual([fin.name, fin.phone, fin.email, fin.province], ['Ana', '84475680', '', ''])
  })
})

describe('chat → order prefill: products and choices (verifier round 1)', () => {
  it("whole words, Spanish names, the store's list never read", () => {
    assert.deepEqual(productWords('GLP Patch'), ['glp'])
    assert.deepEqual(ids(matchPrefillProducts(INVENTORY, ['Me interesa para probar el GLp1'])), [['glp', 1]])
    assert.deepEqual(ids(matchPrefillProducts(INVENTORY, ['Quiero 2 de energía y uno de dopamina'])), [['dopa', 1], ['energy', 2]])
    assert.deepEqual(ids(matchPrefillProducts(INVENTORY, ['pura sonrisa de fresa'])), [['fresa', 1]])
    assert.deepEqual(ids(matchPrefillProducts(INVENTORY, ['arnés forge m/l'])), [['arnml', 1]])
    assert.deepEqual(ids(matchPrefillProducts(INVENTORY, ['sleeping patches porfa'])), [['sleep', 1]])
    assert.deepEqual(matchPrefillProducts(INVENTORY, ['hola, precio?']), [])
  })

  it('the longest name wins inside a message', () => {
    assert.deepEqual(ids(matchPrefillProducts(INVENTORY, ['quiero el bucal deepsleep'])), [['bucal', 1]])
  })

  it('quantity: word-bounded numbers, "del", "x2" after GLP-1, the latest mention wins', () => {
    assert.equal(matchPrefillProducts(INVENTORY, ['quiero todos glp'])[0].cantidad, 1)
    assert.equal(matchPrefillProducts(INVENTORY, ['dos del stress relief'])[0].cantidad, 2)
    assert.equal(matchPrefillProducts(INVENTORY, ['GLP-1 x2'])[0].cantidad, 2)
    assert.equal(matchPrefillProducts(INVENTORY, ['3 de glp', 'mejor solo 1 de glp'])[0].cantidad, 1)
    assert.equal(matchPrefillProducts(INVENTORY, ['Entonces mejor 2 de Glp-1'])[0].cantidad, 2)
  })

  it('pickup vs delivery: "te envío el comprobante" is not a delivery choice', () => {
    assert.deepEqual(detectOrderChoices(['paso a recoger', 'listo, te envío el comprobante']), { orderType: 'RA', paymentChoice: null })
    assert.deepEqual(detectOrderChoices(['Contra entrega']), { orderType: 'EA', paymentChoice: 'contra_entrega' })
    assert.deepEqual(detectOrderChoices(['con envío porfa']), { orderType: 'EA', paymentChoice: null })
    assert.deepEqual(detectOrderChoices(['hola']), { orderType: null, paymentChoice: null })
  })
})

describe('chat → order prefill: verifier round 2', () => {
  it('a labelled canton / district without a province line is kept and fills its province', () => {
    const f = labelledCustomerFields(['Cantón: Moravia', 'Distrito: San Vicente'])
    assert.deepEqual([f.province, f.canton, f.district], ['San José', 'Moravia', 'San Vicente'])
  })

  it('"N parches / cajas de X" sets the quantity', () => {
    assert.equal(matchPrefillProducts(INVENTORY, ['3 parches de glp'])[0].cantidad, 3)
    assert.equal(matchPrefillProducts(INVENTORY, ['dos cajas de glp'])[0].cantidad, 2)
  })

  it('a payment phrase or a question never flips pickup to delivery', () => {
    assert.equal(detectOrderChoices(['paso a recoger', 'ya pagué y envío el comprobante']).orderType, 'RA')
    assert.equal(detectOrderChoices(['paso a retirar', '¿cuánto cuesta el envío?']).orderType, 'RA')
    assert.deepEqual(detectOrderChoices(['¿hacen contra entrega?']), { orderType: null, paymentChoice: null })
  })

  it("a chat form's draft is written only by the chat draft writer; the alert link is set after the chat check", () => {
    const form = readFileSync('src/app/ventas/components/EnhancedSalesForm.tsx', 'utf8')
    const autoSaveHead = form.slice(form.indexOf('const autoSave = useCallback'), form.indexOf('const autoSave = useCallback') + 400)
    assert.ok(autoSaveHead.includes('if (draftKey) return;'))
    const inbox = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
    assert.match(inbox, /if \(selectedConversationIdRef\.current !== requestedId\) return\s+setChatOrderPrefill\([^\n]+\)\s+setResolveTagOnOrder\(resolveTag\)\s+setCreateOrderOpen\(true\)/)
  })
})

describe('chat → order prefill: wiring (verifier round 1)', () => {
  it('read-only POST route: update_sales + create_sales, same-origin, no-store, tenant-scoped, NO AI (SecureDog H2)', () => {
    const r = readFileSync('src/app/api/chat/conversations/[id]/order-prefill/route.ts', 'utf8')
    assert.match(r, /export async function POST\(/)
    assert.doesNotMatch(r, /export async function GET\(/)
    assert.match(r, /if \(!isSameOriginRequest\(request\)\)/)
    assert.match(r, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(r, /hasPermission\(auth\.role as Role, 'create_sales'\)/)
    assert.match(r, /where: \{ tenantId: auth\.tenantId, conversationId: conversation\.id, direction: 'inbound'/)
    assert.match(r, /const customerTexts = boundedCustomerTexts\(/)
    assert.match(r, /'Cache-Control': 'no-store'/)
    // The accepted AI terms cover agent replies only: no provider call here until the terms are updated.
    assert.doesNotMatch(r, /enhanceCustomerPasteWithAi|softAiResponsesCreate|customer-paste-ai/)
    assert.doesNotMatch(r, /\.create\(|\.update\(|\.upsert\(/)
    assert.match(readFileSync('src/lib/rbac.ts', 'utf8'), /'POST \/api\/chat\/conversations\/\*\/order-prefill': 'update_sales'/)
  })

  it('SecureDog H1: 60 messages × 4 096 chars and 500 products stay fast (bounded once, no per-token regex)', async () => {
    const { boundedCustomerTexts } = await import('../chat-order-prefill-core')
    const hostile = Array.from({ length: 60 }, (_, i) => (i % 2 ? 'a,' : 'x@y.').repeat(1_024))
    const items = Array.from({ length: 500 }, (_, i) => ({ id: String(i), name: 'Producto Especial ' + i + ' Plus', category: 'X', sellingPrice: 1 }))
    const started = Date.now()
    const texts = boundedCustomerTexts(hostile)
    labelledCustomerFields(texts)
    matchPrefillProducts(items, texts)
    detectOrderChoices(texts)
    const ms = Date.now() - started
    assert.ok(texts.join('').length <= 6_000)
    assert.ok(ms < 300, 'took ' + ms + ' ms')
  })

  it('SecureDog H2: the Ventas AI helper masks card / cédula / IBAN before the provider call', () => {
    const ai = readFileSync('src/lib/customer-paste-ai.ts', 'utf8')
    assert.match(ai, /rawText: redactSensitiveForProvider\(input\.rawText\.slice\(0, 6_000\)\)/)
  })

  it('inbox: chat switch drops a late result; the alert clears once the order exists, even if linking fails', () => {
    const inbox = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
    assert.match(inbox, /if \(selectedConversationIdRef\.current !== requestedId\) return/)
    assert.match(inbox, /setChatOrderPrefill\(prefill \? \{ conversationId: requestedId, prefill \} : null\)/)
    assert.match(inbox, /useEffect\(\(\) => \{\s+setCreateOrderOpen\(false\)\s+setResolveTagOnOrder\(null\)\s+\}, \[selectedConversationId\]\)/)
    assert.match(inbox, /if \(tag === ORDER_REVIEW_TAG\) \{\s+void openCreateOrderFromChat\(\)/)
    const created = inbox.slice(inbox.indexOf('const handleOrderCreated'), inbox.indexOf("fetch('/api/chat/order-link'"))
    assert.match(created, /patchConversation\(\{ removeTag: settleTag \}\)/)
    assert.match(inbox, /busy: reviewBusy \|\| orderPrefillLoading/)
    // SecureDog L3: on WhatsApp the verified chat number stays the order phone.
    assert.match(inbox, /phone: selectedConversation\.platform === 'whatsapp' \? selectedConversation\.recipientId : chatPrefillForOpenChat\?\.phone/)
  })

  it('form: a restored draft keeps its delivery choice and products; no draft until a person edits', () => {
    const form = readFileSync('src/app/ventas/components/EnhancedSalesForm.tsx', 'utf8')
    assert.match(form, /!fromDraft && prev\.products\.length === 0 && initial\.products\?\.length/)
    assert.match(form, /initial\.orderType && !fromDraft &&/)
    assert.match(form, /if \(prefillSnapshotRef\.current && prefillSnapshotRef\.current === JSON\.stringify\(latest\)\) return;/)
    assert.match(form, /const takeAddress = !prev\.customerInfo\.province && Boolean\(initial\.province\)/)
  })
})
