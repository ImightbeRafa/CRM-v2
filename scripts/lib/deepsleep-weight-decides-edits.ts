/**
 * DeepSleep "weight decides" (2026-11-04) — follow-up to deepsleep-no-weight-edits.ts on live Forge data.
 *
 * Owner words (Chief of Staff chat, 2026-11-04 08:24 CR): "Weight is the most important if the sizes of heigh and
 * weight are to far apart weight becomes the most important because is the circumferened of the hip sand stuff." /
 * "yes if out of stock recommend the closest to work going bigger never smaller." / "Without telling them that is not
 * right for them or anything it wokrs they are universal."
 *
 * So: height and weight point to different sizes → the WEIGHT size (this morning's "the bigger of the two" was wrong).
 * Between two sizes by weight → still the bigger one. The size is sold out → the closest size UP that is in stock,
 * offered as a normal recommendation (never smaller, never "it is not right for you").
 *
 * Each `from` is the exact sentence deepsleep-no-weight-apply.ts wrote at 08:06 CR; the rest of each text stays.
 * deepsleep-no-weight-edits.ts carries the same new sentences, so re-running it cannot bring the old ones back.
 */
import type { TextEdit } from '@/lib/soft-ai/text-patch'
import { DEEPSLEEP_AGENTS } from './deepsleep-conversion-ids'

/** Same owner/admin login and agent as the no-weight apply (imported the other way round, so no import cycle). */
export const WEIGHT_DECIDES_ACTOR_EMAIL = 'rafa.work0412@gmail.com'
export const WEIGHT_DECIDES_AGENT_ID = DEEPSLEEP_AGENTS.forge

/** Height and weight disagree → weight decides (new sentences, shared with deepsleep-no-weight-edits.ts). */
export const MISMATCH_FAQ = 'Si estatura y peso no coinciden, manda el peso;'
export const MISMATCH_ARNES = 'Si la estatura cae en otra talla, igual manda el peso (aunque quede fuera de los cm).'
export const ELEGIR_TALLA_SIZE = 'Si los da, la talla va por el peso (aunque la estatura no coincida); entre dos tallas, la más grande.'
export const NEVER_SAY_SIZE =
  'Pedir peso o estatura. Si el cliente los da, decí su talla por el peso (aunque la estatura no coincida); entre dos, la más grande; agotada → la más cercana más grande, sin decir que no le queda'

/** Sold out → the closest size up that is in stock, as a normal recommendation. */
export const SOLD_OUT_ARNES =
  'Si esa talla está agotada, ofrecé la talla disponible más cercana hacia arriba (nunca una más pequeña) como una recomendación normal: las tallas son universales; nunca digas que no es su talla o que no le va a quedar. Si no hay una más grande disponible, decí que está agotada.'
export const SOLD_OUT_FAQ =
  'Si esa talla está agotada, recomendá la más cercana hacia arriba que esté disponible (nunca una más pequeña), sin decir que no le queda: las tallas son universales.'

export const WEIGHT_DECIDES_KNOWLEDGE_EDITS: Record<string, TextEdit[]> = {
  'ForgeCR · Preguntas frecuentes': [
    { from: 'Si estatura y peso no coinciden, la más grande de las dos;', to: MISMATCH_FAQ },
    {
      from: 'Entre dos tallas, siempre la más grande. Bajo 51 o sobre 100 kg',
      to: `Entre dos tallas, siempre la más grande. ${SOLD_OUT_FAQ} Bajo 51 o sobre 100 kg`,
    },
  ],
  'ForgeCR · Arnés': [
    { from: 'Si la estatura cae en otra talla, recomendá la más grande de las dos.', to: MISMATCH_ARNES },
    {
      from: 'Entre dos tallas, siempre la más grande. Bajo 51 kg',
      to: `Entre dos tallas, siempre la más grande. ${SOLD_OUT_ARNES} Bajo 51 kg`,
    },
  ],
}

/** brandFacts "Elegir talla" (value ≤200; " Casos complejos → persona." stays). */
export const WEIGHT_DECIDES_BRAND_FACT_EDITS: Record<string, TextEdit[]> = {
  'Elegir talla': [
    {
      from: 'Si el cliente los da, le dice su talla. Entre dos tallas (o si peso y estatura no coinciden), la más grande.',
      to: ELEGIR_TALLA_SIZE,
    },
  ],
}

/** Selling rules: one neverSay item (the list is 10/10, so nothing is added). */
export const WEIGHT_DECIDES_SALES_RULE_EDITS: { neverSay: TextEdit[]; objections: TextEdit[]; handoffWhen: TextEdit[] } = {
  neverSay: [
    {
      from: 'Pedir peso o estatura. Si el cliente los da, decí su talla; entre dos tallas (o peso y estatura distintos), la más grande',
      to: NEVER_SAY_SIZE,
    },
  ],
  objections: [],
  handoffWhen: [],
}

/**
 * OPT-IN (--drop-mismatch-handoff), pending the owner's yes: with weight deciding, "estatura y peso muy distintos" and
 * "estatura fuera de la tabla" are no longer reasons to hand off (1.86 m / 65 kg → XL by weight). Under 51 or over
 * 100 kg (no size by weight) still hands off.
 */
export const MISMATCH_HANDOFF_EDITS: { objections: TextEdit[]; handoffWhen: TextEdit[] } = {
  objections: [
    {
      from: 'Fuera de la tabla (estatura o peso: menos de 155 o más de 185 cm, menos de 51 o más de 100 kg; p. ej. 1.86 m/65 kg): no elijas talla;',
      to: 'Fuera de la tabla por peso (menos de 51 o más de 100 kg): no elijas talla; la estatura sola no saca de la tabla (1.86 m y 65 kg → XL por el peso);',
    },
  ],
  handoffWhen: [
    {
      from: 'talla compleja: fuera de la tabla, estatura y peso muy distintos, dudas del cuerpo',
      to: 'talla compleja: fuera de la tabla por peso (menos de 51 o más de 100 kg), dudas del cuerpo',
    },
  ],
}

/** The full set for one run. */
export function weightDecidesEdits(opts: { dropMismatchHandoff: boolean }) {
  return {
    knowledge: WEIGHT_DECIDES_KNOWLEDGE_EDITS,
    brandFacts: WEIGHT_DECIDES_BRAND_FACT_EDITS,
    salesRules: {
      neverSay: WEIGHT_DECIDES_SALES_RULE_EDITS.neverSay,
      objections: opts.dropMismatchHandoff ? MISMATCH_HANDOFF_EDITS.objections : [],
      handoffWhen: opts.dropMismatchHandoff ? MISMATCH_HANDOFF_EDITS.handoffWhen : [],
    },
  }
}
