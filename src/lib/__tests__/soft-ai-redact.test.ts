import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  redactEmail,
  redactIban,
  redactPhone,
  redactPiiText,
  redactSinpe,
  redactToolTrace,
} from '../soft-ai/llm/redact'

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
