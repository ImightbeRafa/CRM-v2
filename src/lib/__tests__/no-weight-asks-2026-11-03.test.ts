/**
 * DeepSleep "no weight asks" (2026-11-03 owner answers 2, 3, 5): the bot never asks weight or height; given a weight
 * it says the size from the guide; between two sizes it recommends the bigger one; back pain keeps selling.
 * Covers the surgical text-patch planner, the edit set, the follow-up stage copy, the pb_tallas seed and the
 * conversion-apply constants (a re-run must not bring the weight question back).
 *
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/no-weight-asks-2026-11-03.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planTextEdits, textEditProblem, type TextEdit } from '@/lib/soft-ai/text-patch'
import { PURA_STAGE, STAGE_TEXTS } from '@/lib/soft-ai/deepsleep-conversion-pack'
import { SALES_REPLY_TEMPLATES } from '@/lib/soft-ai/shortcuts'
import {
  NO_WEIGHT_BRAND_FACT_EDITS,
  NO_WEIGHT_INSTRUCTION_EDITS,
  NO_WEIGHT_KNOWLEDGE_EDITS,
  NO_WEIGHT_SALES_RULE_EDITS,
  NO_WEIGHT_SHORTCUT_EDITS,
} from '../../../scripts/lib/deepsleep-no-weight-edits'
import { sameJson } from '../../../scripts/agent-pack/deepsleep-no-weight-shared'

/** A question that asks the customer for weight or height. */
const WEIGHT_ASK = /¿[^?]*\b(?:pes[aá]s|pes[aá]is|med[ií]s|tu peso|tu estatura)\b[^?]*\?|pasame tu peso|ped[ií] (?:el )?peso|ped[ií] estatura|pedimos el peso|decime cuánto medís/iu

const allEdits: Array<[string, TextEdit[]]> = [
  ['instructions', NO_WEIGHT_INSTRUCTION_EDITS],
  ...Object.entries(NO_WEIGHT_SHORTCUT_EDITS).map(([k, v]) => [`shortcut ${k}`, v] as [string, TextEdit[]]),
  ...Object.entries(NO_WEIGHT_KNOWLEDGE_EDITS).map(([k, v]) => [`kb ${k}`, v] as [string, TextEdit[]]),
  ...Object.entries(NO_WEIGHT_BRAND_FACT_EDITS).map(([k, v]) => [`fact ${k}`, v] as [string, TextEdit[]]),
  ...Object.entries(NO_WEIGHT_SALES_RULE_EDITS).map(([k, v]) => [`rules ${k}`, v] as [string, TextEdit[]]),
]

describe('planTextEdits', () => {
  const edits = [{ from: 'pedí peso.', to: 'seguí la venta.' }]
  it('replaces a sentence found exactly once and keeps the rest', () => {
    const plan = planTextEdits('Hola. Luego pedí peso. Lavado a mano.', edits)
    assert.deepEqual(plan, { status: 'change', next: 'Hola. Luego seguí la venta. Lavado a mano.' })
  })
  it('is idempotent: an already swapped text is unchanged', () => {
    assert.equal(planTextEdits('Hola. Luego seguí la venta.', edits).status, 'same')
  })
  it('refuses a text edited by hand or with the sentence twice (never guesses)', () => {
    const missing = planTextEdits('Hola. Luego preguntá el peso.', edits)
    assert.equal(missing.status, 'conflict')
    assert.equal(missing.next, 'Hola. Luego preguntá el peso.')
    assert.equal(planTextEdits('pedí peso. pedí peso.', edits).status, 'conflict')
  })
  it('a later conflict leaves the whole text as it was', () => {
    const plan = planTextEdits('A pedí peso. B', [...edits, { from: 'nope', to: 'x' }])
    assert.equal(plan.status, 'conflict')
    assert.equal(plan.next, 'A pedí peso. B')
  })
  it('refuses malformed edits', () => {
    assert.ok(textEditProblem({ from: '', to: 'x' }))
    assert.ok(textEditProblem({ from: 'x', to: '' }))
    assert.ok(textEditProblem({ from: 'ab', to: 'xaby' }))
  })
})

describe('no-weight edit set', () => {
  it('every edit is well-formed and its new text never asks weight or height', () => {
    for (const [label, edits] of allEdits) {
      for (const e of edits) {
        assert.equal(textEditProblem(e), null, label)
        assert.doesNotMatch(e.to, WEIGHT_ASK, label)
        assert.doesNotMatch(e.to, /la más pequeña/u, label)
      }
    }
  })
  it('the sentences it removes are the weight asks and the "smaller size" rule', () => {
    const removed = allEdits.flatMap(([, edits]) => edits.map((e) => e.from)).join('\n')
    assert.match(removed, /¿Cuánto pesás\?/u)
    assert.match(removed, /pedí peso/u)
    assert.match(removed, /pedí estatura y peso/u)
    assert.match(removed, /la más pequeña/u)
  })
  it('between two sizes → the bigger one, in instructions, saved reply, KB, fact and rules', () => {
    const bigger = /la (?:más grande|mayor)/u
    assert.match(NO_WEIGHT_INSTRUCTION_EDITS.map((e) => e.to).join(' '), bigger)
    assert.match(NO_WEIGHT_SHORTCUT_EDITS.fg_tallas[0].to, bigger)
    assert.match(NO_WEIGHT_KNOWLEDGE_EDITS['ForgeCR · Preguntas frecuentes'][0].to, bigger)
    assert.match(NO_WEIGHT_KNOWLEDGE_EDITS['ForgeCR · Arnés'][0].to, bigger)
    assert.match(NO_WEIGHT_BRAND_FACT_EDITS['Elegir talla'][0].to, bigger)
    assert.match(NO_WEIGHT_SALES_RULE_EDITS.neverSay[0].to, bigger)
  })
  it('back pain stays answered (no handoff) and keeps selling', () => {
    assert.match(NO_WEIGHT_SALES_RULE_EDITS.handoffWhen[1].to, /dolor de espalda \(también crónico\)/u)
    assert.match(NO_WEIGHT_SHORTCUT_EDITS.fg_dolor[0].to, /¿te lo aparto\?/u)
    assert.match(NO_WEIGHT_INSTRUCTION_EDITS[2].to, /sin handoff/u)
  })
  it('list items and brand facts stay within their save caps', () => {
    for (const e of [...NO_WEIGHT_SALES_RULE_EDITS.mustSay, ...NO_WEIGHT_SALES_RULE_EDITS.neverSay]) assert.ok(e.to.length <= 200)
    assert.ok(NO_WEIGHT_BRAND_FACT_EDITS['Elegir talla'][0].to.length + ' Casos complejos → persona.'.length <= 200)
  })
})

describe('code copy without weight asks', () => {
  it('follow-up size stage never asks weight; Pura (no sizes) has no size stage', () => {
    assert.doesNotMatch(STAGE_TEXTS.A.size, WEIGHT_ASK)
    assert.doesNotMatch(STAGE_TEXTS.B.size, WEIGHT_ASK)
    assert.match(STAGE_TEXTS.B.size, /la más grande/u)
    assert.equal('size' in PURA_STAGE.A, false)
    assert.equal('size' in PURA_STAGE.B, false)
    assert.equal(PURA_STAGE.A.how_it_works, STAGE_TEXTS.A.how_it_works)
  })
  it('pb_tallas starter reply sends the guide and lets the customer choose', () => {
    const row = SALES_REPLY_TEMPLATES.find((r) => r.key === 'pb_tallas')
    assert.ok(row)
    assert.doesNotMatch(row.body, WEIGHT_ASK)
    assert.match(row.body, /guía de tallas/u)
  })
  it('deepsleep-conversion-apply constants already carry the swaps (a re-run converges)', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/agent-pack/deepsleep-conversion-apply.ts'), 'utf8')
    const mirrored = [
      ...NO_WEIGHT_INSTRUCTION_EDITS,
      ...NO_WEIGHT_SHORTCUT_EDITS.fg_tallas,
      ...NO_WEIGHT_SHORTCUT_EDITS.fg_dolor,
      ...NO_WEIGHT_KNOWLEDGE_EDITS['FAQ — dolor de espalda (sin claims médicos)'],
    ]
    for (const e of mirrored) {
      assert.equal(src.includes(e.from), false, e.from)
      assert.equal(src.split(e.to).length - 1, 1, e.to)
    }
    assert.doesNotMatch(src, /¿Cuánto pesás\?|cuánto pesás para ver/u)
  })
})

describe('sameJson (backup compare)', () => {
  it('ignores key order (jsonb) but not values', () => {
    assert.ok(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }))
    assert.equal(sameJson({ a: 1 }, { a: 2 }), false)
  })
})
