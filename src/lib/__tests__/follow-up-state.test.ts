import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { customerGaveOrderData, followUpStateSkip, WAITING_DATE_RE } from '../soft-ai/follow-up-state'

const out = (content: string) => ({ direction: 'outbound', content })
const inb = (content: string) => ({ direction: 'inbound', content })

describe('follow-ups v2: wrong sends (DeepSleep 2026-10-28)', () => {
  it('payment details already sent → no "¿Te quedó alguna duda?" (Debbie, Sleeping)', () => {
    const chat = [inb('Sinpe'), out('Perfecto 🙌 SINPE Móvil: 6201 9914 A nombre de: Rafael García'), out('Cuando lo hagás, mandame el comprobante por aquí y lo revisamos 😊')]
    assert.equal(followUpStateSkip(chat, false), 'payment_details_sent')
  })

  it('order data given (labelled list, free line with phone + address, email) → skip', () => {
    assert.ok(customerGaveOrderData('• Nombre completo: Daniela Zeledón • Teléfono: 61830587 • Provincia: Heredia • Cantón: San Francisco'))
    assert.ok(customerGaveOrderData('Laura Sandí Aguilar 8529 1151 San jose San jose Catedral De la iglesia de san cayetano 100oeste, 25 norte'))
    assert.ok(customerGaveOrderData('Cristopher Álvarez Pérez 89111190 Crisap3108@gmail.com'))
    assert.ok(customerGaveOrderData('Diego Vega\n89427801\nAlajuela, Ciruelas'))
    assert.equal(followUpStateSkip([inb('Diego Vega 89427801 Alajuela/Alajuela/Ciruelas 200mts este de la rotonda')]), 'data_given')
  })

  it('no data: a price question, a size, a lone number or a phone with nothing else', () => {
    for (const t of ['¿Cuánto cuesta un paquete de parches?', 'Mido 1.80 y peso 90kg', 'Sería XL', '2', 'Quiero 2 bolsas', 'Mi número es 8888 8888']) {
      assert.equal(customerGaveOrderData(t), false, t)
    }
  })

  it('a named later date or no money right now → skip (only the last customer message counts)', () => {
    for (const t of ['Ahorita no tengo dinero gracias', 'Mañana les escribo', 'espero la quincena', 'Cuando me paguen le aviso', 'El lunes te confirmo', 'la otra semana lo pido', 'Le escribo mañana']) {
      assert.ok(WAITING_DATE_RE.test(t), t)
    }
    assert.equal(followUpStateSkip([inb('Mañana les escribo'), out('¡Con gusto!')]), 'waiting_date')
    // An old promise followed by new questions: the chat is alive again.
    assert.equal(followUpStateSkip([inb('¿Y cuánto es el envío?'), out('₡3 000'), inb('Mañana les escribo')]), null)
  })

  it('questions about time are not a promise to come back', () => {
    for (const t of ['¿Llega mañana?', '¿Lo pueden mandar el lunes?', '¿Hacen envíos el sábado?', 'Lo necesito para mañana', '¿Cuánto tarda?']) {
      assert.equal(WAITING_DATE_RE.test(t), false, t)
    }
  })

  it('a normal price-only chat still gets its follow-up', () => {
    assert.equal(followUpStateSkip([inb('¿Cuánto cuesta un paquete de parches?'), out('Una bolsa cuesta ₡9 900 y el envío ₡3 000. ¿Cuántas bolsas querés?')], false), null)
  })

  it('followUpSkipReason runs the state checks after the decline check', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    const at = src.indexOf('followUpStateSkip(recent)')
    assert.ok(at > src.indexOf("return 'declined'") && at < src.indexOf("return 'already_followed_up'"))
  })
})
