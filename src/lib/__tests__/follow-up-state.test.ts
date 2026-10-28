import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { customerGaveOrderData, customerNamedLaterDate, followUpSlot, followUpStateSkip, parseStageTexts, WAITING_DATE_RE } from '../soft-ai/follow-up-state'

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

describe('follow-ups v2: where the chat stopped (slots)', () => {
  it('price given, customer quiet → quoted', () => {
    assert.equal(followUpSlot([inb('¿Cuánto cuesta el soporte?'), out('El arnés cuesta ₡14 900 con envío gratis. ¿Querés ver la guía de tallas?')], false), 'quoted')
  })

  it('customer picked something → chose (never on a question)', () => {
    for (const t of ['Sí, lo quiero.', 'Sería xl', 'Quiero una bolsa', 'Solo una', 'el pack de 2']) {
      assert.equal(followUpSlot([out('₡9 900'), inb(t), out('¿Envío o retiro?')], false), 'chose', t)
    }
    assert.equal(followUpSlot([out('₡9 900'), inb('¿Cuánto es el pack?'), out('₡19 800')], false), 'quoted')
  })

  it('payment details sent, nothing paid since → sinpe_reminder; a receipt or a store confirmation ends it', () => {
    const details = out('Perfecto 🙌 SINPE Móvil: 6201 9914 A nombre de: Rafael García')
    assert.equal(followUpSlot([inb('Sinpe'), details, out('Cuando lo hagás, mandame el comprobante 😊')], false), 'sinpe_reminder')
    assert.equal(followUpSlot([inb('Sinpe'), details, inb('[image]'), out('¡Gracias! Dame un momento')], false), null)
    assert.equal(followUpSlot([inb('Sinpe'), details, out('¡Pago recibido! 🙌')], false), null)
  })

  it('a reminder text with a number, amount or link is dropped (the details are never re-sent unattended)', () => {
    assert.deepEqual(parseStageTexts({ sinpe_reminder: 'Cuando hagás el SINPE al 6201 9914 mandame el comprobante' }), undefined)
    assert.deepEqual(parseStageTexts({ sinpe_reminder: 'Son ₡12 900, mandame el comprobante' }), undefined)
    assert.deepEqual(parseStageTexts({ sinpe_reminder: 'Pagá en https://x.cr' }), undefined)
    assert.deepEqual(parseStageTexts({ sinpe_reminder: '¡Hola! Cuando hagás el SINPE, mandame el comprobante 😊', other: 'x' }), { sinpe_reminder: '¡Hola! Cuando hagás el SINPE, mandame el comprobante 😊' })
  })

  it('a date question is not a promise; a named later date is', () => {
    assert.equal(followUpStateSkip([inb('¿Llega hasta el viernes?')]), null)
    assert.equal(followUpStateSkip([inb('Me interesa una 4 XL pero sería para después del 15 noviembre')]), 'waiting_date')
  })

  it('the engine: arm texts per slot, the reminder only with an owner text, slot recorded on the message', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    assert.match(src, /const stageTexts = c\.stageTexts\?\.\[variant\]/)
    assert.match(src, /followUpSkipReason\(tenantId, conv, \{ sinpeReminder: Boolean\(stageTexts\?\.sinpe_reminder\) \}\)/)
    assert.match(src, /followUp: \{ campaignId: c\.id, variant, \.\.\.\(slot && stageTexts\?\.\[slot\] \? \{ slot \} : \{\}\) \}/)
    // The review tags and every older skip rule still run first.
    assert.ok(src.indexOf("return 'review_alert'") < src.indexOf('followUpStateSkip(recent)'))
  })
})

describe('follow-ups v2: verifier 2026-10-28', () => {
  it('a named later date after the payment details blocks the reminder too', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    assert.match(src, /followUpSlot\(recent\) === 'sinpe_reminder' && !customerNamedLaterDate\(recent\)/)
    for (const t of ['Ok, espero la quincena y le hago el sinpe', 'Ahorita no tengo plata, cuando me paguen le aviso', 'Mañana le escribo']) {
      assert.equal(customerNamedLaterDate([inb(t)]), true, t)
    }
  })

  it('a smaller order or "después del pago" is not a later date', () => {
    for (const t of ['No me alcanza para el pack, mejor solo una', 'Ok entonces lo envían después del pago']) {
      assert.equal(WAITING_DATE_RE.test(t), false, t)
    }
  })

  it('SINPE reminders never count toward the A/B winner rule', () => {
    const src = readFileSync('scripts/agent-pack/follow-up-campaign.ts', 'utf8')
    assert.match(src, /followUp\?\.slot === 'sinpe_reminder'\) \{\s+s\.reminders\+\+\s+continue/)
  })
})
