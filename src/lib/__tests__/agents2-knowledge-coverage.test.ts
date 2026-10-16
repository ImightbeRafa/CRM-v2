/**
 * Knowledge coverage (Rafael 2026-10-16): every agent must answer ingredients / use / daily use / price for every
 * product plus the store questions; the test chat fails any "no lo tengo / lo confirmo" or hand-off. Pure; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-knowledge-coverage.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coverageScenarios, knowledgeGaps, productCoreName } from '@/lib/soft-ai/knowledge-coverage'
import { evaluateStep } from '@/lib/soft-ai/probar-scenarios'

const STORE =
  'Se pega en piel limpia, uno al día. Embarazo: consultar al médico. Los resultados se notan con uso constante. Envío 2 a 5 días hábiles. Pago por SINPE o tarjeta. Devoluciones: no se aceptan abiertas.'

describe('productCoreName', () => {
  it('drops "patch / parches / pack" words and splits joined names', () => {
    assert.equal(productCoreName('Focus Patch'), 'focus')
    assert.equal(productCoreName('SleepingPatches'), 'sleeping')
    assert.equal(productCoreName('GLP-1 Patch'), 'glp-1')
    assert.equal(productCoreName('Combo Trío Bienestar'), 'combo trio bienestar')
  })
})

describe('knowledgeGaps', () => {
  it('a product with no ingredients written down is a gap; with them it is not', () => {
    const knowledge = `Focus Patch: para estudiar. Ingredientes: melena de león y NAC.\n\nStress Patch: para días de carga.\n\n${STORE}`
    assert.deepEqual(knowledgeGaps({ knowledge, products: ['Focus Patch', 'Stress Patch'] }), [{ product: 'Stress Patch', topic: 'ingredientes' }])
  })

  it('a product missing from the knowledge and missing store topics are gaps', () => {
    const gaps = knowledgeGaps({ knowledge: 'Focus Patch. Ingredientes: NAC.', products: ['Focus Patch', 'Energy Patch'] })
    assert.ok(gaps.some((g) => g.product === 'Energy Patch' && g.topic === 'no aparece en el conocimiento'))
    for (const topic of ['cómo se usa', 'formas de pago', 'cambios y devoluciones']) assert.ok(gaps.some((g) => g.product === null && g.topic === topic), topic)
  })

  it('the ingredients must sit with the product, not elsewhere in the text', () => {
    const knowledge = `Energy Patch: energía para el día.\n\nFocus Patch. Ingredientes: NAC.\n\n${STORE}`
    assert.deepEqual(knowledgeGaps({ knowledge, products: ['Energy Patch'] }), [{ product: 'Energy Patch', topic: 'ingredientes' }])
  })
})

describe('coverageScenarios', () => {
  const tests = coverageScenarios(['Focus Patch', 'Energy Patch'])

  it('asks ingredients, use, every day and price per product, plus the store questions', () => {
    assert.equal(tests.length, 2 * 4 + 7)
    assert.ok(tests.some((t) => t.title === 'Cobertura · Focus Patch · ingredientes'))
    assert.ok(tests.some((t) => t.title === 'Cobertura · envío'))
    // Every question must be answered without a hand-off — except returns, which may correctly go to a person.
    for (const t of tests) assert.equal(t.steps[0].expect?.handoff, t.title === 'Cobertura · devoluciones' ? undefined : false, t.title)
    for (const t of tests) assert.ok(t.steps[0].expect?.forbidRegex?.length, t.title)
  })

  it('fails "no lo tengo acá / lo confirmo y te lo paso" and a hand-off; passes a real answer', () => {
    const expect = tests[0].steps[0].expect
    const base = { text: '', escalate: false, needsHuman: false, outcome: 'send' as const }
    const live = evaluateStep({ ...base, text: 'El detalle exacto de esa mezcla no lo tengo acá. Lo confirmo y te lo paso.' } as never, expect)
    assert.equal(live.pass, false)
    const handed = evaluateStep({ ...base, text: 'Dame un momento y te confirmo 😊', escalate: true, needsHuman: true } as never, expect)
    assert.equal(handed.pass, false)
    // The code's own "no lo sé" hand-off (unknown_answer) also fails it.
    const planned = evaluateStep({ ...base, text: 'Lleva NAC.', handoff: { kind: 'handoff', reason: 'unknown_answer' } } as never, expect)
    assert.equal(planned.pass, false)
    const good = evaluateStep({ ...base, text: 'Lleva vitamina B, NAC, melena de león y ginseng rojo 🌿' } as never, expect)
    assert.equal(good.pass, true, good.failures.join(','))
  })
})
