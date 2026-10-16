/**
 * Knowledge coverage (Rafael 2026-10-16): every agent must be able to answer what customers actually ask about EVERY
 * product — ingredients, how to use it, daily use, price — plus the store questions (shipping, payment, pickup,
 * returns, safety). Generic for any business: products come from the agent's own product list.
 *
 * Two checks, both pure:
 * - `knowledgeGaps`: offline, on the agent's knowledge text — which product / topic has no answer written down.
 * - `coverageScenarios`: questions for the test chat (scripts/agent-pack/probar.ts --coverage); a step fails when the
 *   agent hands off or says it does not have the answer ("no lo tengo acá", "lo confirmo y te lo paso").
 */
import type { ScenarioStep } from '@/lib/soft-ai/probar-scenarios'
import { CANNOT_ANSWER_SOURCE } from '@/lib/soft-ai/agent-turn-outcome'

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** "Focus Patch" → "focus"; "Combo Trío Bienestar" stays whole. Words that only say "it is a patch / a pack" go. */
export function productCoreName(name: string): string {
  // "SleepingPatches" (an inventory name written together) → "Sleeping Patches".
  const core = fold(name.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'))
    .replace(/\b(patch|patches|parches?|paquete|pack|x\s*\d+|\d+\s*(unid|uds?|parches))\b/g, ' ')
    .replace(/[^\p{L}\p{N}+\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return core || fold(name).trim()
}

const PRODUCT_TOPICS: Array<{ key: string; label: string; re: RegExp }> = [
  // A "- item" list counts only when it is not a price list (amounts like "13,25 mg" are fine; ₡ / $ lines are not).
  { key: 'ingredients', label: 'ingredientes', re: /ingrediente|contiene|lleva\b|formula|compuest|componente|\n\s*-\s+[^\n₡¢$]+(?:\n|$)/ },
]

const STORE_TOPICS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: 'usage', label: 'cómo se usa', re: /se usa|como se usa|modo de uso|aplica|se pega|pegalo|pegás|pegas/ },
  { key: 'daily', label: 'uso diario / cuánto dura', re: /todos los dias|uno al dia|al dia|diario|24 horas|cada noche|cada dia/ },
  { key: 'safety', label: 'seguridad (embarazo, médico, efectos)', re: /embaraz|lactancia|medico|efectos? secundario|irritaci|alergi/ },
  { key: 'results', label: 'en cuánto se notan resultados', re: /resultado|se nota|notan|primeros dias/ },
  { key: 'shipping', label: 'envío (costo y tiempo)', re: /envio|entrega|dias habiles/ },
  { key: 'payment', label: 'formas de pago', re: /sinpe|tarjeta|transferencia|pago/ },
  { key: 'returns', label: 'cambios y devoluciones', re: /devoluci|cambio|reclamo|garantia/ },
]

export type KnowledgeGap = { product: string | null; topic: string }

/**
 * What the knowledge does not cover. A product is covered when its name appears and the text right after a mention
 * (up to the next blank line, or 700 characters) talks about its ingredients / formula. Pure.
 */
export function knowledgeGaps(input: { knowledge: string; products: string[] }): KnowledgeGap[] {
  const text = fold(input.knowledge || '')
  const gaps: KnowledgeGap[] = []
  for (const product of input.products) {
    const core = productCoreName(product)
    if (!core) continue
    const windows: string[] = []
    let from = 0
    for (;;) {
      const at = text.indexOf(core, from)
      if (at < 0) break
      const rest = text.slice(at, at + 700)
      const blank = rest.search(/\n\s*\n/)
      windows.push(blank > 0 ? rest.slice(0, blank) : rest)
      from = at + core.length
    }
    if (!windows.length) {
      gaps.push({ product, topic: 'no aparece en el conocimiento' })
      continue
    }
    for (const t of PRODUCT_TOPICS) if (!windows.some((w) => t.re.test(w))) gaps.push({ product, topic: t.label })
  }
  for (const t of STORE_TOPICS) if (!t.re.test(text)) gaps.push({ product: null, topic: t.label })
  return gaps
}

/** Fails a step when the agent says it does not have the answer, or passes the chat to a person. */
const MUST_KNOW = { handoff: false, forbidRegex: [CANNOT_ANSWER_SOURCE, String.raw`(?<!\p{L})no\s+(?:te\s+)?(?:s[eé]|sabr[ií]a)(?!\p{L})`] }

export type CoverageTest = { title: string; steps: ScenarioStep[] }

/**
 * The coverage questions for the test chat: per product (ingredients, how to use, every day, price) and per store
 * (shipping, payment, pickup, returns, safety, results). Each question is its own one-step chat. Pure.
 */
export function coverageScenarios(products: string[]): CoverageTest[] {
  const out: CoverageTest[] = []
  const one = (title: string, text: string, extra: Partial<NonNullable<ScenarioStep['expect']>> = {}) =>
    out.push({ title: `Cobertura · ${title}`, steps: [{ text, expect: { ...MUST_KNOW, ...extra } }] })
  for (const p of products) {
    one(`${p} · ingredientes`, `¿Qué ingredientes trae el ${p}? Quiero saber exactamente sus componentes`)
    one(`${p} · cómo se usa`, `¿Cómo se usa el ${p}?`)
    one(`${p} · todos los días`, `¿El ${p} se puede usar todos los días?`)
    one(`${p} · precio`, `¿Cuánto cuesta el ${p}?`, { requireAny: [String.raw`₡|¢|colones|\d`] })
  }
  one('envío', '¿Cuánto cuesta el envío y cuánto dura en llegar?')
  one('pago', '¿Cómo puedo pagar?')
  one('retiro', '¿Puedo pasar a recogerlo?')
  // Returns may correctly go to a person (rule 1: refunds); the policy must still be known (no "no lo tengo").
  one('devoluciones', '¿Cuál es la política de cambios y devoluciones?', { handoff: undefined })
  one('embarazo', '¿Lo puedo usar si estoy embarazada?')
  one('efectos secundarios', '¿Tiene efectos secundarios?')
  one('resultados', '¿En cuánto tiempo se notan los resultados?')
  return out
}
