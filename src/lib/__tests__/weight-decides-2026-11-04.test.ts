/**
 * DeepSleep "weight decides" (owner, 2026-11-04 08:24 CR): when height and weight point to different sizes, the
 * weight size wins; between two sizes by weight, the bigger one; a sold-out size → the closest size up in stock, as a
 * normal recommendation (never smaller, never "it is not right for you").
 * Covers the edit set, how it composes with the 11-03 no-weight set (a re-run never brings "la más grande de las
 * dos" back), the opt-in handoff edits and the conversion-apply constants.
 *
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/weight-decides-2026-11-04.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planTextEdits, textEditProblem, type TextEdit } from '@/lib/soft-ai/text-patch'
import { NO_WEIGHT_BRAND_FACT_EDITS, NO_WEIGHT_KNOWLEDGE_EDITS, NO_WEIGHT_SALES_RULE_EDITS } from '../../../scripts/lib/deepsleep-no-weight-edits'
import {
  MISMATCH_HANDOFF_EDITS,
  WEIGHT_DECIDES_BRAND_FACT_EDITS,
  WEIGHT_DECIDES_KNOWLEDGE_EDITS,
  WEIGHT_DECIDES_SALES_RULE_EDITS,
  weightDecidesEdits,
} from '../../../scripts/lib/deepsleep-weight-decides-edits'

const WEIGHT_ASK = /¿[^?]*\b(?:pes[aá]s|med[ií]s|tu peso|tu estatura)\b[^?]*\?|ped[ií] (?:el )?peso|ped[ií] estatura/iu
/** The 11-03 rule this replaces: height/weight mismatch → the bigger of the two. */
const MISMATCH_BIGGER = /la más grande de las dos|\(o si peso y estatura no coinciden\)|\(o peso y estatura distintos\)/u

// Live text before 2026-11-03 (deepsleep-no-weight backup "before", 2026-11-04 14:06Z) — only the size paragraphs.
const FAQ_ORIGINAL =
  'P: ¿Qué talla soy?\nR: Manda el peso: M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90, 4XL 91–100. Decí esa talla ("por tu peso va la XL") y mandá la guía. Solo estatura: pedí el peso. Bajo 51 o sobre 100 kg no hay talla: pasá con una persona. Si estatura y peso no coinciden, seguí el peso; nunca "te queda perfecto".'
const ARNES_ORIGINAL =
  'Cómo elegir: manda el peso. M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90, 4XL 91–100. Si la estatura cae en otra talla, igual va la del peso (aunque quede fuera de los cm). Decilo tranquilo ("por tu peso va la 2XL"); nunca "te queda perfecto". Si solo hay estatura, pedí el peso. Bajo 51 kg o sobre 100 kg: no recomendar ni la talla más cercana; pasá con una persona. Mandá la foto cuando pregunten talla o den el peso.'
// Live now (after the 08:06 CR no-weight apply): read from the DB 2026-11-04 08:26 CR.
const FAQ_LIVE =
  'P: ¿Qué talla soy?\nR: Mandá la guía; nunca pidas peso ni estatura. Si te dan el peso, manda el peso: M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90, 4XL 91–100; decí esa talla ("por tu peso va la XL"). Solo estatura: usá la estatura de la guía. Entre dos tallas, siempre la más grande. Bajo 51 o sobre 100 kg no hay talla: pasá con una persona. Si estatura y peso no coinciden, la más grande de las dos; nunca "te queda perfecto".'
const ARNES_LIVE =
  'Cómo elegir: manda el peso. M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90, 4XL 91–100. Si la estatura cae en otra talla, recomendá la más grande de las dos. Decilo tranquilo ("por tu peso va la 2XL"); nunca "te queda perfecto". Si solo hay estatura, usá la estatura de la tabla; nunca pidas peso ni estatura. Entre dos tallas, siempre la más grande. Bajo 51 kg o sobre 100 kg: no recomendar ni la talla más cercana; pasá con una persona. Mandá la foto cuando pregunten talla o den el peso.'
const FACT_LIVE =
  'Andrés manda la guía de tallas y nunca pide peso ni estatura. Si el cliente los da, le dice su talla. Entre dos tallas (o si peso y estatura no coinciden), la más grande. Casos complejos → persona.'
const NEVER_LIVE = 'Pedir peso o estatura. Si el cliente los da, decí su talla; entre dos tallas (o peso y estatura distintos), la más grande'

const FAQ = 'ForgeCR · Preguntas frecuentes'
const ARNES = 'ForgeCR · Arnés'

const all: Array<[string, TextEdit[]]> = [
  ...Object.entries(WEIGHT_DECIDES_KNOWLEDGE_EDITS).map(([k, v]) => [`kb ${k}`, v] as [string, TextEdit[]]),
  ['fact Elegir talla', WEIGHT_DECIDES_BRAND_FACT_EDITS['Elegir talla']],
  ['neverSay', WEIGHT_DECIDES_SALES_RULE_EDITS.neverSay],
  ['opt-in objections', MISMATCH_HANDOFF_EDITS.objections],
  ['opt-in handoffWhen', MISMATCH_HANDOFF_EDITS.handoffWhen],
]

const next = (live: string, edits: TextEdit[]) => {
  const plan = planTextEdits(live, edits)
  assert.notEqual(plan.status, 'conflict', 'error' in plan ? plan.error : '')
  return plan.next
}

describe('weight-decides edit set', () => {
  it('every edit is well-formed, never asks weight/height and drops the mismatch → bigger rule', () => {
    for (const [label, edits] of all) {
      for (const e of edits) {
        assert.equal(textEditProblem(e), null, label)
        assert.doesNotMatch(e.to, WEIGHT_ASK, label)
        assert.doesNotMatch(e.to, MISMATCH_BIGGER, label)
      }
    }
  })
  it('mismatch → the weight size, in both KBs, the brand fact and the never-say rule; between two → the bigger', () => {
    const faq = next(FAQ_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    const arnes = next(ARNES_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES])
    const fact = next(FACT_LIVE, WEIGHT_DECIDES_BRAND_FACT_EDITS['Elegir talla'])
    const never = next(NEVER_LIVE, WEIGHT_DECIDES_SALES_RULE_EDITS.neverSay)
    assert.match(faq, /Si estatura y peso no coinciden, manda el peso;/u)
    assert.match(arnes, /Si la estatura cae en otra talla, igual manda el peso/u)
    assert.match(fact, /va por el peso \(aunque la estatura no coincida\); entre dos tallas, la más grande\./u)
    assert.match(never, /por el peso \(aunque la estatura no coincida\); entre dos, la más grande/u)
    for (const t of [faq, arnes, fact, never]) assert.doesNotMatch(t, MISMATCH_BIGGER)
    for (const t of [faq, arnes]) assert.match(t, /Entre dos tallas, siempre la más grande\./u)
  })
  it('sold out → the closest size up, never smaller, never "not your size"; the rest of the text is kept', () => {
    const faq = next(FAQ_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    const arnes = next(ARNES_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES])
    for (const t of [faq, arnes]) {
      assert.match(t, /agotada, (?:ofrecé|recomendá) la (?:talla disponible )?más cercana hacia arriba/u)
      assert.match(t, /nunca una más pequeña/u)
      assert.match(t, /(?:nunca digas|sin decir) que no (?:es su talla|le queda)/u)
      assert.match(t, /las tallas son universales/u)
    }
    assert.match(arnes, /Si no hay una más grande disponible, decí que está agotada\./u)
    // Out of range by weight still has no size and still goes to a person.
    assert.match(faq, /Bajo 51 o sobre 100 kg no hay talla: pasá con una persona\./u)
    assert.match(arnes, /Bajo 51 kg o sobre 100 kg: no recomendar ni la talla más cercana; pasá con una persona\./u)
    assert.match(arnes, /Mandá la foto cuando pregunten talla o den el peso\.$/u)
  })
  it('is idempotent: a second run is unchanged', () => {
    const faq = next(FAQ_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    assert.equal(planTextEdits(faq, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ]).status, 'same')
    const arnes = next(ARNES_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES])
    assert.equal(planTextEdits(arnes, WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES]).status, 'same')
  })
  it('refuses a text edited by hand (conflict, nothing changes)', () => {
    const edited = FAQ_LIVE.replace('la más grande de las dos', 'la más grande de ambas')
    const plan = planTextEdits(edited, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    assert.equal(plan.status, 'conflict')
    assert.equal(plan.next, edited)
  })
  it('caps: brand fact ≤200 with the live tail, never-say item ≤200', () => {
    assert.ok(next(FACT_LIVE, WEIGHT_DECIDES_BRAND_FACT_EDITS['Elegir talla']).length <= 200)
    for (const e of [...WEIGHT_DECIDES_SALES_RULE_EDITS.neverSay, ...NO_WEIGHT_SALES_RULE_EDITS.neverSay]) assert.ok(e.to.length <= 200)
  })
})

describe('composes with the 11-03 no-weight set', () => {
  it('re-running no-weight after weight-decides is a no-op (cannot bring "la más grande de las dos" back)', () => {
    const faq = next(FAQ_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    const arnes = next(ARNES_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES])
    const fact = next(FACT_LIVE, WEIGHT_DECIDES_BRAND_FACT_EDITS['Elegir talla'])
    const never = next(NEVER_LIVE, WEIGHT_DECIDES_SALES_RULE_EDITS.neverSay)
    assert.equal(planTextEdits(faq, NO_WEIGHT_KNOWLEDGE_EDITS[FAQ]).status, 'same')
    assert.equal(planTextEdits(arnes, NO_WEIGHT_KNOWLEDGE_EDITS[ARNES]).status, 'same')
    assert.equal(planTextEdits(fact, NO_WEIGHT_BRAND_FACT_EDITS['Elegir talla']).status, 'same')
    assert.equal(planTextEdits(never, NO_WEIGHT_SALES_RULE_EDITS.neverSay).status, 'same')
  })
  it('re-running no-weight on today\'s live text (before weight-decides) refuses instead of guessing', () => {
    assert.equal(planTextEdits(FAQ_LIVE, NO_WEIGHT_KNOWLEDGE_EDITS[FAQ]).status, 'conflict')
    assert.equal(planTextEdits(ARNES_LIVE, NO_WEIGHT_KNOWLEDGE_EDITS[ARNES]).status, 'conflict')
  })
  it('from the pre-11-03 text, no-weight then weight-decides lands on the same text as today\'s path', () => {
    const viaToday = next(FAQ_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    const fresh = next(next(FAQ_ORIGINAL, NO_WEIGHT_KNOWLEDGE_EDITS[FAQ]), WEIGHT_DECIDES_KNOWLEDGE_EDITS[FAQ])
    assert.equal(fresh, viaToday)
    const arnesToday = next(ARNES_LIVE, WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES])
    const arnesFresh = next(next(ARNES_ORIGINAL, NO_WEIGHT_KNOWLEDGE_EDITS[ARNES]), WEIGHT_DECIDES_KNOWLEDGE_EDITS[ARNES])
    assert.equal(arnesFresh, arnesToday)
  })
})

describe('mismatch handoff (opt-in, owner yes pending)', () => {
  it('is off by default and on only with --drop-mismatch-handoff', () => {
    assert.deepEqual(weightDecidesEdits({ dropMismatchHandoff: false }).salesRules.handoffWhen, [])
    assert.deepEqual(weightDecidesEdits({ dropMismatchHandoff: false }).salesRules.objections, [])
    assert.equal(weightDecidesEdits({ dropMismatchHandoff: true }).salesRules.handoffWhen.length, 1)
    assert.equal(weightDecidesEdits({ dropMismatchHandoff: true }).salesRules.objections.length, 1)
  })
  it('drops only "estatura y peso muy distintos" / height out of table; under 51 or over 100 kg still hands off', () => {
    const [h] = MISMATCH_HANDOFF_EDITS.handoffWhen
    const [o] = MISMATCH_HANDOFF_EDITS.objections
    assert.match(h.from, /estatura y peso muy distintos/u)
    assert.doesNotMatch(h.to, /muy distintos/u)
    assert.match(h.to, /menos de 51 o más de 100 kg/u)
    assert.match(o.to, /menos de 51 o más de 100 kg\): no elijas talla/u)
    assert.match(o.to, /XL por el peso/u)
  })
})

describe('other size constants', () => {
  it('deepsleep-conversion-apply.ts carries no mismatch → bigger wording (a re-run cannot bring it back)', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/agent-pack/deepsleep-conversion-apply.ts'), 'utf8')
    assert.doesNotMatch(src, MISMATCH_BIGGER)
  })
})
