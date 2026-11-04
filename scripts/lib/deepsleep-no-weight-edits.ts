/**
 * DeepSleep "no weight asks" (2026-11-03, owner answers 2, 3 and 5) — the exact sentence swaps on live Forge data.
 *
 * Owner words (Chief of Staff chat, 2026-11-03): "the flow with the guia is better not to ask for weight and size
 * and stuff and send the image, if they need help sure we advise which one specially for mixed where people are
 * between sizes", "3 always round to bigger size", "5 A" (back pain: answer carefully, keep selling, no handoff).
 *
 * Each swap replaces ONE exact sentence of the live value and leaves the rest of that text untouched (inbox
 * corrections, shipping, payment, washing, colors and order-data lines stay as they are). See text-patch.ts.
 * Brand copy and ids live here (scripts/) so A1 locked-paths stays green.
 */
import type { TextEdit } from '@/lib/soft-ai/text-patch'
import { DEEPSLEEP_AGENTS } from './deepsleep-conversion-ids'
// 2026-11-04 "weight decides": the mismatch sentences below end on the same text as deepsleep-weight-decides-edits.ts,
// so a re-run of this set after that apply is a no-op and can never bring "la más grande de las dos" back.
import { ELEGIR_TALLA_SIZE, MISMATCH_ARNES, MISMATCH_FAQ, NEVER_SAY_SIZE } from './deepsleep-weight-decides-edits'

/** Owner/admin login that saves these edits (has an active OWNER/ADMIN membership on DeepSleep). */
export const NO_WEIGHT_ACTOR_EMAIL = 'rafa.work0412@gmail.com'

export const NO_WEIGHT_AGENT_ID = DEEPSLEEP_AGENTS.forge

/** Forge systemInstructions (live 1193 → 1199 JS chars, cap 1200). The Color/Envío/Lavado interpolated lines are untouched. */
export const NO_WEIGHT_INSTRUCTION_EDITS: TextEdit[] = [
  // Item 4 (first price question → price + guide image) is delivered by agent_size_guide_v1; the old line forbade it.
  { from: 'Sin guía de tallas en saludo ni precio.', to: 'Sin guía de tallas en saludo.' },
  {
    // Probar: with only "no pidas peso" the model still asked "¿Cuánto pesás?" on "¿Qué talla soy?"; say what to do instead.
    from: 'solo si preguntan talla/peso/kg/kilos/mido/medidas o ya compran. Manda el peso (M/L 51–60 … 4XL 91–100 kg); solo estatura → pedí peso.',
    to: 'solo si preguntan talla/peso/kg/mido/medidas o ya compran. Nunca pidas peso/estatura: mandá fg_tallas; si los dan, decí la talla (entre dos, la mayor).',
  },
  { from: 'luego pedí peso; sin handoff.', to: 'seguí la venta; sin handoff.' },
]

/** Saved replies (body only; keywords, mode, intents and title stay). */
export const NO_WEIGHT_SHORTCUT_EDITS: Record<string, TextEdit[]> = {
  fg_tallas: [{ from: '¿Cuánto pesás?', to: 'Si quedás entre dos tallas, te recomiendo la más grande 😊 ¿Cuál te aparto?' }],
  fg_dolor: [
    {
      from: 'Si querés probarlo para la postura, ¿cuánto pesás para ver tu talla?',
      to: 'Si querés probarlo como ayuda para la postura, ¿te lo aparto?',
    },
  ],
}

/** Knowledge sources bound to Forge, by exact name (a new approved version replaces the bound one). */
export const NO_WEIGHT_KNOWLEDGE_EDITS: Record<string, TextEdit[]> = {
  'FAQ — dolor de espalda (sin claims médicos)': [
    {
      from: 'Después, si quiere probarlo para postura, pedimos el peso para la talla.',
      to: 'Después seguimos con la venta (precio y guía de tallas); nunca pedimos peso ni estatura.',
    },
  ],
  'ForgeCR · Preguntas frecuentes': [
    {
      from: 'R: Manda el peso: M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90, 4XL 91–100. Decí esa talla ("por tu peso va la XL") y mandá la guía. Solo estatura: pedí el peso.',
      to: 'R: Mandá la guía; nunca pidas peso ni estatura. Si te dan el peso, manda el peso: M/L 51–60 kg, XL 61–70, 2XL 71–80, 3XL 81–90, 4XL 91–100; decí esa talla ("por tu peso va la XL"). Solo estatura: usá la estatura de la guía. Entre dos tallas, siempre la más grande.',
    },
    // 2026-11-04 owner: when height and weight disagree, weight decides (was "la más grande de las dos" on 11-03).
    { from: 'Si estatura y peso no coinciden, seguí el peso;', to: MISMATCH_FAQ },
  ],
  'ForgeCR · Arnés': [
    {
      from: 'Si solo hay estatura, pedí el peso.',
      to: 'Si solo hay estatura, usá la estatura de la tabla; nunca pidas peso ni estatura. Entre dos tallas, siempre la más grande.',
    },
    {
      from: 'Si la estatura cae en otra talla, igual va la del peso (aunque quede fuera de los cm).',
      to: MISMATCH_ARNES,
    },
  ],
}

/** brandFacts.extraFacts entries, by exact label (value ≤200). Only the value changes. */
export const NO_WEIGHT_BRAND_FACT_EDITS: Record<string, TextEdit[]> = {
  'Elegir talla': [
    {
      from: 'Andrés no elige la talla: siempre manda la guía de tallas y el cliente elige. Única guía: entre dos tallas, la más pequeña.',
      to: `Andrés manda la guía de tallas y nunca pide peso ni estatura. ${ELEGIR_TALLA_SIZE}`,
    },
  ],
}

/** ChatAgentSettings.salesRules (lists are edited item by item; every other rule key is left as it is). */
export const NO_WEIGHT_SALES_RULE_EDITS: {
  mustSay: TextEdit[]
  neverSay: TextEdit[]
  objections: TextEdit[]
  handoffWhen: TextEdit[]
} = {
  mustSay: [
    {
      from: 'Para la talla: mandá la guía de tallas y que el cliente elija',
      to: 'Para la talla: mandá la guía; si el cliente da su peso, decile su talla (entre dos, la más grande)',
    },
  ],
  neverSay: [
    {
      from: 'Elegir la talla por el cliente o decir "te queda X" / "según la tabla caés en X": solo mandá la guía; entre dos tallas, la más pequeña',
      to: NEVER_SAY_SIZE,
    },
  ],
  objections: [
    { from: '¿Cómo compro? El precio y pedí estatura y peso.', to: '¿Cómo compro? El precio y la guía de tallas (nunca pidas peso ni estatura).' },
  ],
  handoffWhen: [
    // "insists you recommend a size" is now answered (owner: "if they need help sure we advise which one").
    { from: 'dudas del cuerpo o si insiste en que le recomiendes una talla (no adivines)', to: 'dudas del cuerpo' },
    // Owner answer 5: back pain (also chronic) is answered, never handed off. Specific clinical cases still pass.
    {
      from: 'Retiro con cita, embarazo (consultá al médico)',
      to: 'Retiro con cita, dolor de espalda (también crónico), embarazo (consultá al médico)',
    },
  ],
}
