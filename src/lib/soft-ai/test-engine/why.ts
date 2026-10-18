/**
 * agents2-pace (2026-10-16): WHY a quick-check case got the safe line ("Dame un momento y te confirmo 😊") or
 * another non-answer — a validator rejection, an AI timeout / provider error, or a hand-off — in plain Spanish,
 * plus the raw codes. Pure and client-safe (run.ts stores it; the results UI shows `why`).
 */
import type { TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'
import { PROBAR_ESCALATE_LABELS } from '@/lib/soft-ai/probar-why'

/** Provider / runtime failures a second try can fix (not a validator rejection, not a missing key). */
export const RETRYABLE_TECHNICAL_CODES: ReadonlySet<string> = new Set([
  'LLM_TIMEOUT',
  'XAI_TIMEOUT',
  'LLM_ERROR',
  'XAI_ERROR',
  'empty_model_output',
])

/** Configuration problems: technical, but retrying the case does not help. */
const CONFIG_CODES: ReadonlySet<string> = new Set(['LLM_AUTH', 'LLM_NOT_CONFIGURED', 'XAI_NOT_CONFIGURED'])

const CODE_TEXT: Record<string, string> = {
  unknown_answer: 'No tenía la respuesta y pasó el chat a una persona (falta en el conocimiento)',
  unsourced_amount: 'El agente mencionó un monto que no está en los datos',
  unsourced_money: 'El agente mencionó un monto que no está en los datos',
  money_mismatch_inventory: 'El agente dio un precio distinto al del inventario',
  foreign_link: 'Puso un enlace que no es de la tienda',
  data_echo: 'Respondió solo con datos personales copiados del chat (nombre, teléfono, dirección)',
  repeat_refusal: 'Dijo que ya lo había compartido en vez de repetirlo',
  write_claim: 'Dijo que ya hizo algo que no hizo (pedido, guía…)',
  payment_number_unsourced: 'Dio un número de pago que no está en los datos',
  payment_number_not_shareable: 'Dio un número de pago que no se puede compartir por chat',
  payment_info_not_shared: 'Faltan los datos de pago para poder compartirlos',
  style_too_long: 'La respuesta fue demasiado larga',
  unknown_token: 'Dejó una marca interna sin completar',
  template_leak: 'Se le escapó texto interno en la respuesta',
  tag_leak: 'Se le escapó texto interno en la respuesta',
  deal_offer: 'Ofreció una promoción o descuento que no está activo',
  confirmation_wording: 'Dijo que un pago quedó confirmado (eso lo confirma una persona)',
  payment_status_claim: 'Dijo que un pago quedó confirmado (eso lo confirma una persona)',
  unsafe_letters: 'Usó letras o signos raros que pueden esconder palabras (lo revisa una persona)',
  model_text_too_long: 'La respuesta de la IA era demasiado larga para revisarla (lo revisa una persona)',
  unit_cost_leak: 'Mencionó el costo interno de un producto',
  brand_facts_missing: 'Faltan datos del negocio para responder',
  empty_output: 'La IA respondió vacío',
  empty_model_output: 'La IA respondió vacío',
  sales_needs_human: 'La venta necesita a una persona en este paso',
  LLM_TIMEOUT: 'La IA tardó demasiado en responder',
  XAI_TIMEOUT: 'La IA tardó demasiado en responder',
  LLM_ERROR: 'Error de la IA (proveedor)',
  XAI_ERROR: 'Error de la IA (proveedor)',
  LLM_AUTH: 'La clave de la IA no es válida',
  LLM_NOT_CONFIGURED: 'La IA no está configurada',
  XAI_NOT_CONFIGURED: 'La IA no está configurada',
  test_budget_blocked: 'Se acabó el límite diario de pruebas',
  not_bound_to_channel: 'El agente no atiende esta línea',
}

/** Not failures by themselves (the reply was adjusted, not replaced). */
const BENIGN: ReadonlySet<string> = new Set(['shortened', 'unjoined', 'purchase_summary_appended', 'data_list'])

/** Probar / quick check: the raw outcome codes of one test turn (deduped, bounded). Pure. */
export function probarOutcomeCodes(input: {
  validationReasons?: string[]
  policyReasons?: string[]
  errorCode?: string | null
  escalate?: boolean
  escalateReason?: string | null
  handoff?: TurnHandoff | null
}): string[] {
  const out = [
    ...(input.errorCode ? [input.errorCode] : []),
    ...(input.validationReasons ?? []),
    ...(input.policyReasons ?? []),
    ...(input.escalate && input.escalateReason ? [`escalate:${input.escalateReason}`] : []),
    ...(input.handoff?.kind === 'review' ? ['review'] : []),
    // A 'no lo tengo' reply the code handed to a person: the agent lacked the answer (Rafael 2026-10-16).
    ...(input.handoff?.kind === 'handoff' && input.handoff.reason === 'unknown_answer' ? ['unknown_answer'] : []),
  ]
  return [...new Set(out.filter((c) => typeof c === 'string' && /^[A-Za-z0-9_:.-]{1,60}$/.test(c)))].slice(0, 12)
}

/** A validator / policy rejection (the agent's own text broke a rule) — never retried. */
function isRejectionCode(code: string): boolean {
  return !RETRYABLE_TECHNICAL_CODES.has(code) && !CONFIG_CODES.has(code) && !code.startsWith('escalate:') && code !== 'review' && !BENIGN.has(code)
}

/**
 * The case failed ONLY because of a provider error / timeout (no validator rejection): worth one automatic retry.
 * Hand-off / review markers that the fallback adds after the error do not count against it.
 */
export function isTechnicalOnlyFailure(codes: string[]): boolean {
  return codes.some((c) => RETRYABLE_TECHNICAL_CODES.has(c)) && !codes.some(isRejectionCode)
}

/**
 * Quick check: retry a failed case once when it failed only for a technical reason, it was not blocked / errored
 * (test budget, line not bound, thrown error), it is the first try, and the run's cost cap still has room.
 */
export function shouldRetryCase(
  result: { pass: boolean; error?: string | null; codes?: string[]; retried?: boolean },
  spentMicros: number,
  costCapMicros: number,
  /** INT-124: time left in this leased step; none left = no retry (the next step / cron runs the next case). */
  stepTimeLeftMs: number = Number.POSITIVE_INFINITY,
): boolean {
  if (result.pass || result.error || result.retried) return false
  if (spentMicros >= costCapMicros) return false
  if (!(stepTimeLeftMs > 0)) return false
  return isTechnicalOnlyFailure(result.codes ?? [])
}

/** INT-124: a timed-out attempt may report no usage; the run cap still counts it at this estimate (US$0.02). */
export const TIMEOUT_ATTEMPT_COST_MICROS = 20_000
const TIMEOUT_CODES = new Set(['LLM_TIMEOUT', 'XAI_TIMEOUT'])

export function attemptCostMicros(codes: string[], measuredMicros: number): number {
  const measured = Math.max(0, Math.round(measuredMicros || 0))
  return codes.some((c) => TIMEOUT_CODES.has(c)) ? Math.max(measured, TIMEOUT_ATTEMPT_COST_MICROS) : measured
}

/** Plain-Spanish reason for a case (null when nothing unusual happened). Up to two reasons. */
export function caseWhy(codes: string[], error?: string | null): string | null {
  const lines: string[] = []
  if (error) lines.push(CODE_TEXT[error] ?? 'No se pudo correr esta prueba')
  for (const code of codes) {
    if (BENIGN.has(code) || code === 'review') continue
    if (code.startsWith('escalate:')) {
      const reason = code.slice('escalate:'.length)
      lines.push(`Pasó a una persona: ${PROBAR_ESCALATE_LABELS[reason] ?? 'otro motivo'}`)
      continue
    }
    lines.push(CODE_TEXT[code] ?? `Otro motivo (${code})`)
  }
  if (!lines.length && codes.includes('review')) lines.push('Respondió con la frase de respaldo: su respuesta no pasó las reglas')
  const unique = [...new Set(lines)]
  return unique.length ? unique.slice(0, 2).join(' · ') : null
}
