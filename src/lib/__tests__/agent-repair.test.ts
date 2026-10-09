import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REPAIRABLE_REASONS, repairInstruction } from '@/lib/soft-ai/llm/runtime'

test('repair request names the broken rules in plain words, never customer text', () => {
  const text = repairInstruction(['unsourced_money', 'deal_offer'])
  assert.match(text, /monto que no está/)
  assert.match(text, /descuento o promoción/)
  assert.match(text, /solo el texto final/)
  assert.match(repairInstruction(['algo_nuevo']), /rompe una regla fija/)
})

test('one rewrite before a hand-off: same checks, text-only, inside the turn budget', () => {
  const src = readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8')
  const at = src.indexOf('repairInstruction(validation.reasons)')
  assert.ok(at > 0)
  const block = src.slice(src.indexOf('const repairLeftMs'), src.indexOf('if (validation.needsHuman || structured.needsHuman)'))
  assert.match(block, /validation\.needsHuman && repairable && !structured\.needsHuman && !escalate && repairLeftMs > 5_000/)
  assert.match(block, /validation\.reasons\.every\(\(r\) => REPAIRABLE_REASONS\.has\(r\)\)/)
  // Payment confirmations are never rewritten into something sendable.
  assert.equal(REPAIRABLE_REASONS.has('confirmation_wording'), false)
  assert.match(block, /toolChoice: 'none'/)
  assert.match(block, /const recheck = repaired\.text \? validate\(repaired\.text\) : null/)
  assert.match(block, /if \(recheck\?\.ok && !repairedRaw\.needsHuman\)/)
  // Escalation still follows the (possibly repaired) verdict.
  assert.ok(src.indexOf('if (validation.needsHuman || structured.needsHuman)') > at)
})

test('test chat says when the agent fixed its reply and which saved reply it used', async () => {
  const { probarWhy } = await import('@/lib/soft-ai/probar-why')
  assert.deepEqual(probarWhy({ toolTrace: [{ repair: { reasons: ['deal_offer'], ok: true } }], shortcutKey: 'pb_tallas' }), [
    'corrigió su respuesta para cumplir las reglas',
    'usó la respuesta guardada “pb_tallas”',
  ])
  assert.deepEqual(probarWhy({ toolTrace: [], shortcutKey: 'sys_payment_info' }), ['usó una respuesta rápida'])
})
