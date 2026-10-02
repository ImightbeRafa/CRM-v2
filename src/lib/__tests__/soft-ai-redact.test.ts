import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  redactEmail,
  redactIban,
  redactPhone,
  redactPiiText,
  redactSensitiveForProvider,
  redactSinpe,
  redactToolTrace,
} from '../soft-ai/llm/redact'
import { isOptOutText } from '../soft-ai/llm/safety-router'

describe('soft-ai redact (1.16)', () => {
  it('masks CR phone, email, SINPE and IBAN', () => {
    const raw =
      'Llame +50661043737 o juan@x.com SINPE 1234567890123456 IBAN CR05015202001026284066'
    const out = redactPiiText(raw)
    assert.match(out, /\+506 \*\*\*\* 3737/)
    assert.match(out, /j\*\*\*@\*\*\*\.com/)
    assert.match(out, /SINPE \*\*\*\*3456/)
    assert.match(out, /CR05\*\*\*\*.*4066|CR05\*\*\*\*/)
    assert.doesNotMatch(out, /61043737/)
    assert.doesNotMatch(out, /juan@x\.com/)
  })

  it('redacts nested toolTrace', () => {
    const trace = redactToolTrace({
      args: { phone: '+506 8888 9999', note: 'ok' },
      result: { email: 'ana@forge.cr' },
    }) as Record<string, any>
    assert.match(String(trace.args.phone), /\*\*\*\*/)
    assert.match(String(trace.result.email), /\*\*\*/)
  })

  it('helpers are stable', () => {
    assert.ok(redactPhone('+506 6104 3737').includes('****'))
    assert.ok(redactEmail('juan@x.com').startsWith('j'))
    assert.ok(redactSinpe('1234 5678 9012 3456').includes('SINPE'))
    assert.ok(redactIban('CR05015202001026284066').includes('****'))
  })
})

describe('redactSensitiveForProvider', () => {
  it('masks Luhn-valid card numbers but keeps order numbers', () => {
    const out = redactSensitiveForProvider('mi tarjeta 4111 1111 1111 1111 y el pedido 1234567')
    assert.ok(!out.includes('4111 1111'))
    assert.ok(out.includes('****1111'))
    assert.ok(out.includes('pedido 1234567'))
  })
  it('masks cédula and labelled ID numbers', () => {
    const out = redactSensitiveForProvider('cédula 1-2345-6789 / pasaporte: A1234567')
    assert.ok(!out.includes('2345-6789'))
    assert.ok(!out.includes('A1234567'))
  })
  it('masks the number whatever filler words follow the label', () => {
    for (const t of ['cedula numero 112345678', 'mi identificacion personal es 112345678', 'mi cedula es 112345678', 'mi dimex es 155812345678', 'cedula 1 1234 5678']) {
      const out = redactSensitiveForProvider(t)
      assert.ok(!/\d{8}/.test(out.replace(/\s/g, '')), t + ' -> ' + out)
    }
  })
  it('masks 17-digit accounts, CR accounts, lowercase IBAN and dotted cards', () => {
    for (const t of ['cuenta cliente 15201001024567893', 'cuenta BCR 001-0123456-7', 'cr05015202001026284066', 'tarjeta 4111.1111.1111.1111']) {
      const out = redactSensitiveForProvider(t)
      assert.ok(!/\d{6,}/.test(out.replace(/[\s.-]/g, '')), t + ' -> ' + out)
    }
  })
  it('keeps normal text and order numbers', () => {
    assert.equal(redactSensitiveForProvider('quiero 2 camisas talla M, pedido 4821'), 'quiero 2 camisas talla M, pedido 4821')
  })
})

describe('bare handoff word from the suggested customer notice', () => {
  it('routes "agente" / "human" to a person but not normal sentences', () => {
    for (const t of ['agente', ' Agente. ', '"agent"', 'humano']) assert.equal(isOptOutText(t), true, t)
    for (const t of ['el agente de ventas me dijo', 'quiero una camisa']) assert.equal(isOptOutText(t), false, t)
  })
})
