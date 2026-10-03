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
  const masked = (t: string) => redactSensitiveForProvider(t)
  it('masks Luhn-valid cards (spaces, dashes, dots) but keeps order numbers', () => {
    for (const t of ['mi tarjeta 4111 1111 1111 1111', 'tarjeta 4111-1111-1111-1111', 'tarjeta 4111.1111.1111.1111']) {
      const out = masked(t)
      assert.ok(out.includes('****1111') && !out.includes('4111'), t + ' -> ' + out)
    }
    assert.equal(masked('el pedido 1234567 ya salió'), 'el pedido 1234567 ya salió')
  })
  it('masks labelled IDs whatever filler words follow the label', () => {
    for (const t of [
      'cedula numero 112345678',
      'mi identificacion personal es 112345678',
      'mi cedula es 112345678',
      'mi dimex es 155812345678',
      'cedula 1 1234 5678',
      'cédula: 1-1234-5678',
      'pasaporte: A1234567',
    ]) {
      const out = masked(t)
      assert.ok(!/\d{6,}/.test(out.replace(/[\s-]/g, '')), t + ' -> ' + out)
    }
  })
  it('keeps the quantity after a masked ID', () => {
    assert.equal(masked('mi cedula es 112345678 y 2 camisas'), 'mi cedula es [número oculto] y 2 camisas')
  })
  it('masks 17-digit accounts, CR bank accounts and IBANs in any case', () => {
    for (const t of ['cuenta cliente 15201001024567893', 'cuenta BCR 001-0123456-7', 'cr05015202001026284066', 'CR05 0152 0200 1026 2840 66']) {
      const out = masked(t)
      assert.ok(!/\d{6,}/.test(out.replace(/[\s.-]/g, '')), t + ' -> ' + out)
    }
  })
  it('never rewrites product codes, prices, quantities or tracking numbers', () => {
    for (const t of [
      'quiero 2 camisas talla M, pedido 4821',
      'el modelo AB12 cuesta 15000 y el CD34 20000 colones',
      'talla XL32 quiero 2 camisas 15000',
      'precio del UN55TU7000 y el envio a 20101',
      'Tienen el SKU AB1234567890?',
      'mi guía es WS123456789CR',
      'son 2 1500 2000 colones',
      'quiero 1 2500 2500',
      'mi número es 8888-7777',
    ]) {
      assert.equal(masked(t), t)
    }
  })
  it('stays fast on crafted input (no catastrophic backtracking)', () => {
    const crafted = [
      'cedula' + '  de'.repeat(400) + ' x',
      'cedula' + '    de'.repeat(400) + ' x',
      'Hola, mi cedula' + '\n\nde'.repeat(400),
      'AB12' + ' 1234'.repeat(800) + 'x',
      '1 '.repeat(2_000) + 'x',
    ]
    for (const t of crafted) {
      const started = Date.now()
      masked(t)
      assert.ok(Date.now() - started < 50, `took ${Date.now() - started} ms`)
    }
  })
})

describe('bare handoff word from the suggested customer notice', () => {
  it('routes "agente" / "human" to a person but not normal sentences', () => {
    for (const t of ['agente', ' Agente. ', '"agent"', 'humano']) assert.equal(isOptOutText(t), true, t)
    for (const t of ['el agente de ventas me dijo', 'quiero una camisa']) assert.equal(isOptOutText(t), false, t)
  })
})
