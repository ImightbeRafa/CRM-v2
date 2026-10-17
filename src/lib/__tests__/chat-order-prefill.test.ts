import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { customerTextsForPrefill, detectOrderChoices, matchPrefillProducts, productKey } from '../chat-order-prefill-core'

const INVENTORY = [
  { id: 'glp', name: 'GLP Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'focus', name: 'Focus Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'energy', name: 'Energy Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'stress', name: 'Stress Patch', category: 'Parche', sellingPrice: 9900 },
  { id: 'arn', name: 'ARNESS FORGE M/L', category: 'ARNESS', sellingPrice: 14900 },
]

describe('chat → order prefill (pure)', () => {
  it('reads only the customer, without placeholders', () => {
    const texts = customerTextsForPrefill([
      { direction: 'inbound', content: '[ig_post]' },
      { direction: 'inbound', content: 'Hola GLP-1' },
      { direction: 'outbound', content: '- Focus - Energy - Stress Relief - Dopamine - GLP-1' },
      { direction: 'inbound', content: 'Esteban García\n84475680' },
    ])
    assert.deepEqual(texts, ['Hola GLP-1', 'Esteban García\n84475680'])
  })

  it("matches the products the customer named (never the store's catalog list), with quantity", () => {
    assert.equal(productKey('GLP Patch'), 'glp')
    const one = matchPrefillProducts(INVENTORY, ['Me interesa para probar el GLp1'])
    assert.deepEqual(one.map((p) => [p.id, p.cantidad, p.type, p.baseCost]), [['glp', 1, 'GLP Patch', 9900]])
    const two = matchPrefillProducts(INVENTORY, ['Entonces mejor 2 de Glp-1'])
    assert.equal(two[0].cantidad, 2)
    const mix = matchPrefillProducts(INVENTORY, ['Me gustaría de Glp-1 y energy', 'dos de focus'])
    assert.deepEqual(mix.map((p) => [p.id, p.cantidad]).sort(), [['energy', 1], ['focus', 2], ['glp', 1]])
    assert.deepEqual(matchPrefillProducts(INVENTORY, ['hola, precio?']), [])
  })

  it('pickup vs delivery and contra entrega, latest mention wins', () => {
    assert.deepEqual(detectOrderChoices(['Contra entrega']), { orderType: 'EA', paymentChoice: 'contra_entrega' })
    assert.deepEqual(detectOrderChoices(['quiero envío', 'mejor retiro con cita']), { orderType: 'RA', paymentChoice: null })
    assert.deepEqual(detectOrderChoices(['hola']), { orderType: null, paymentChoice: null })
  })
})

describe('chat → order prefill (wiring)', () => {
  it('read-only route: create_sales, tenant-scoped chat, rate-limited, AI only with terms + not paused', () => {
    const r = readFileSync('src/app/api/chat/conversations/[id]/order-prefill/route.ts', 'utf8')
    assert.match(r, /authenticateAPIWithPermission\(request, 'create_sales'\)/)
    assert.match(r, /loadConversationForTenant\(\{ conversationId: id, tenantId: auth\.tenantId/)
    assert.match(r, /where: \{ tenantId: auth\.tenantId, conversationId: conversation\.id/)
    assert.match(r, /where: \{ tenantId: auth\.tenantId, isActive: true \}/)
    assert.match(r, /!\(await isPlatformAiPaused\(\)\) && \(await isAiTermsAcceptedNow\(auth\.tenantId\)\)/)
    assert.doesNotMatch(r, /\.create\(|\.update\(|\.upsert\(/)
  })

  it('Confirmado on "Pedido por confirmar" opens the prefilled form; the alert clears once the order exists', () => {
    const inbox = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
    assert.match(inbox, /if \(tag === ORDER_REVIEW_TAG && !selectedConversation\.orderId\) \{\s+void openCreateOrderFromChat\(tag\)/)
    assert.match(inbox, /if \(resolveTagOnOrder && conv\.tags\.includes\(resolveTagOnOrder\)\) \{\s+await patchConversation\(\{ removeTag: resolveTagOnOrder \}\)/)
    assert.equal(inbox.split('onCreateOrder: () => void openCreateOrderFromChat()').length - 1, 1)
    const form = readFileSync('src/app/ventas/components/EnhancedSalesForm.tsx', 'utf8')
    // Only empty fields; products only when the form has none; the whole address together.
    assert.match(form, /prev\.products\.length === 0 && initial\.products\?\.length/)
    assert.match(form, /const takeAddress = !prev\.customerInfo\.province && Boolean\(initial\.province\)/)
  })
})
