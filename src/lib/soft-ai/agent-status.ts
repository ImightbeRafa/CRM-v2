/**
 * Agentes IA 2.0 (A · "One switch and the truth"). PURE, client-safe.
 *
 * North star (Rafael 2026-10-15): "If it says IA, it answers. If it can't, it says why and who has the chat."
 *
 *  - lineAiStatus(input): one line (WhatsApp number / Instagram) → off | checking | on | problem, with a plain Spanish
 *    label and the single fix. Every input is a REAL switch the send path checks (flags, AI terms, kill switch,
 *    schema, line connection, binding, agent live + Responder, model, provider key, products, allowlist, activation
 *    of THIS agent + model, tenant and agent budget), the one switch's check run, and what really happened to the
 *    line's last AI turn. The server loader is agent-status-server.ts (this file has no DB import so the inbox and
 *    the agent page can use it).
 *  - chatAiStatus(...): what one chat shows. 'human' and 'paused' win; otherwise the chat follows its line
 *    (effectiveConversationAiMode: NULL on a line that is on = IA, unless a person wrote in the last 24 h).
 */
import type { AiFullUnlockMismatch } from '@/lib/soft-ai/agent-types'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { effectiveConversationAiMode } from '@/lib/soft-ai/agent-mode-server'

export type LineAiState = 'off' | 'checking' | 'on' | 'problem'

export type LineAiCode =
  | 'ON'
  | 'OFF'
  | 'CHECKING'
  | 'NOT_SUPPORTED'
  | 'OTHER_AGENT'
  | 'SCHEMA'
  | 'AI_PAUSED_PLATFORM'
  | 'AI_PAUSED_TENANT'
  | 'AI_NOT_ENABLED'
  | 'AI_TERMS'
  | 'LINE_DISCONNECTED'
  | 'NO_AGENT'
  | 'CHECK_FAILED'
  | 'CHECK_STOPPED'
  | 'ACTIVATION_REFUSED'
  | 'AGENT_NOT_LIVE'
  | 'AGENT_HUMAN_ONLY'
  | 'MODEL_NOT_ALLOWED'
  | 'PROVIDER'
  | 'NO_PRODUCTS'
  | 'NOT_ALLOWED'
  | 'NOT_CHECKED'
  | 'AGENT_CHANGED'
  | 'RECHECK'
  | 'NO_BUDGET'
  | 'LAST_TURN'

export type LineAiStatus = {
  state: LineAiState
  code: LineAiCode
  /** Short pill text ("IA respondiendo", "Sin IA", "Sin presupuesto de IA hoy"). */
  label: string
  /** The single fix / what happens, one sentence. */
  hint: string
  /** While checking: progress of the 6-case check. */
  progress?: { done: number; total: number } | null
  /** When the check failed: the titles of the cases that failed. */
  failedCases?: string[]
  /** On, but the agent changed since its check (version drift): it keeps answering; re-testing is suggested. */
  retestSuggested?: boolean
}

export type LineRunInput = {
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cost_capped' | 'canceled' | 'error'
  done: number
  total: number
  /** The one switch's quick check (a quick run IS the "turn on when it passes" intent). */
  quick: boolean
  /** After a green quick run: did the automatic activation work (summary.activation)? */
  activation?: { ok: boolean; code?: string | null } | null
  failedTitles: string[]
}

export type LineAiInput = {
  platform: string
  /** SocialAccount health: isActive, disconnectedAt, tokenStatus. */
  account: { isActive: boolean; disconnected: boolean; tokenStatus?: string | null }
  schemaReady: boolean
  flags: { softAi: boolean; agentLayer: boolean }
  aiTermsAccepted: boolean
  kill: { armed: boolean; source: 'env' | 'platform' | 'tenant' | null }
  /** The agent that serves this line (exact binding, or an allowed tenant default), or null. */
  binding: {
    agentId: string
    agentName: string
    status: string
    operationMode: string
    modelAllowed: boolean
    providerConfigured: boolean
    /** It searches products but has none chosen (activation and the check refuse it). */
    inventoryMapMissing: boolean
  } | null
  /** Agent page: the agent being looked at. A line another agent serves / has on reads "La atiende …". */
  viewingAgentId?: string | null
  allowlisted: boolean
  /** aiFullUnlockStatus for the serving agent + model (agent-config.ts). */
  unlock: { unlocked: boolean; reason: AiFullUnlockMismatch | null; versionWarning?: boolean; agentId?: string | null }
  budget: { tenantExhausted: boolean; agentExhausted: boolean }
  /** Latest test run of the evaluated agent on this line. */
  run: LineRunInput | null
  /** The line's latest real AI turn in the last hour (not tests), when it did NOT answer for an unexpected reason. */
  lastTurnProblem?: { status: string; reason: string | null } | null
}

const SUPPORTED = new Set(['whatsapp', 'instagram'])
const TOKEN_DOWN = new Set(['expired', 'revoked', 'invalid'])

/** Plain copy for the refusal codes the automatic activation can hit after a green check. */
export const POWER_ON_REFUSAL_HINT: Record<string, string> = {
  AI_TERMS_NOT_ACCEPTED: 'Aceptá los términos de IA y volvé a encender.',
  TESTS_OUTDATED: 'El agente cambió durante la prueba: volvé a encender.',
  TESTS_NOT_RUN: 'Volvé a encender para probar otra vez.',
  AGENT_NOT_BOUND: 'La línea cambió de agente durante la prueba: volvé a encender.',
  AI_NOT_ENABLED: 'La IA no está habilitada para este negocio. Pedile al administrador de Betsy.',
  PROVIDER_NOT_CONFIGURED: 'El modelo de respuestas no está configurado en Betsy.',
  INVENTORY_MAP_REQUIRED: 'Elegí los productos que vende este agente y volvé a encender.',
  CHANNEL_OWNED_BY_OTHER_AGENT: 'Esta línea la atiende otro agente: apagala ahí primero.',
}

/** Turn outcomes that are normal (a person has the chat, a newer message, the 24 h window) — not a line problem. */
export const EXPECTED_TURN_SKIPS = new Set([
  'human_replied',
  'superseded',
  'paused_before_send',
  'human_before_send',
  'missing_mode',
  'window_closed',
  'trigger_missing',
  'conversation_missing',
])

const TURN_REASON_COPY: Record<string, string> = {
  not_activated: 'la línea no estaba encendida para este agente',
  ai_full_not_unlocked: 'la línea no estaba encendida para este agente',
  stale_version: 'el agente cambió mientras respondía',
  kill_switch: 'la IA estaba pausada',
  budget_blocked: 'se acabó el presupuesto de IA de hoy',
  token_unhealthy: 'la línea perdió la conexión',
  ai_terms_not_accepted: 'faltan los términos de IA',
  flag_off: 'la IA no está habilitada para el negocio',
  account_not_allowlisted: 'la IA está apagada en la línea',
  binding_inactive: 'la línea no tiene agente',
  no_binding: 'la línea no tiene agente',
  agent_not_live: 'el agente no está en vivo',
  draft_agent: 'el agente está en borrador',
  model_not_allowed: 'el modelo del agente no está disponible',
  human_only: 'el agente está en Solo humanos',
  schema_not_ready: 'falta preparar la base de datos de agentes',
  failed: 'falló al responder',
  fallback: 'no pudo responder y dejó el chat a una persona',
}

/** Pure: plain Spanish for why the last AI turn did not answer (used in the line hint). */
export function turnProblemCopy(problem: { status: string; reason: string | null }): string {
  const key = problem.reason || problem.status
  return TURN_REASON_COPY[key] || TURN_REASON_COPY[problem.status] || 'no respondió'
}

/** Pure: does this real turn outcome mean the line has a problem? (delivered / suggested / expected skips = no) */
export function isUnexpectedTurnOutcome(turn: { status: string; skipReason: string | null }): boolean {
  if (['delivered', 'generated', 'suggested', 'partially_delivered', 'test', 'window_closed'].includes(turn.status)) return false
  if (turn.status === 'skipped') return !EXPECTED_TURN_SKIPS.has(turn.skipReason || '')
  return true
}

const st = (state: LineAiState, code: LineAiCode, label: string, hint: string, extra?: Partial<LineAiStatus>): LineAiStatus => ({
  state,
  code,
  label,
  hint,
  ...extra,
})

function failedList(titles: string[]): string {
  const list = titles.slice(0, 3).join(', ')
  return titles.length > 3 ? `${list} y ${titles.length - 3} más` : list
}

/** Pure: the truth for one line. Order = what blocks first in the real send path, then the fix that matters. */
export function lineAiStatus(input: LineAiInput): LineAiStatus {
  const platform = (input.platform || '').toLowerCase()
  if (!SUPPORTED.has(platform)) {
    return st('off', 'NOT_SUPPORTED', 'Sin IA', 'Por ahora la IA responde en WhatsApp e Instagram.')
  }
  const viewing = input.viewingAgentId || null
  const servedByOther = Boolean(viewing && input.binding && input.binding.agentId !== viewing)
  const onForOther = Boolean(viewing && input.unlock.agentId && input.unlock.agentId !== viewing && input.allowlisted)
  if (servedByOther || onForOther) {
    const name = input.binding?.agentName?.trim() || 'otro agente'
    return st('off', 'OTHER_AGENT', `La atiende ${name}`, 'Para que la atienda este agente, apagala primero en el otro o pasala a este agente.')
  }

  const run = input.run
  if (run && run.quick && (run.status === 'queued' || run.status === 'running')) {
    return st('checking', 'CHECKING', `Probando… ${run.done} de ${run.total}`, 'Si la prueba pasa, la línea se enciende sola.', {
      progress: { done: run.done, total: run.total },
    })
  }

  // A finished quick check that did not turn the line on still counts as "the owner wants it on".
  const finishedQuick =
    run && run.quick && run.status !== 'queued' && run.status !== 'running' && run.status !== 'canceled' && !input.unlock.unlocked
      ? run
      : null
  const wanted = input.allowlisted || input.unlock.unlocked || Boolean(finishedQuick)
  if (!wanted) return st('off', 'OFF', 'Sin IA', 'Encendé la línea para que la IA responda.')

  if (!input.schemaReady) return st('problem', 'SCHEMA', 'IA no disponible', 'Betsy está terminando de preparar los agentes. Probá en un rato.')
  if (input.kill.armed && (input.kill.source === 'env' || input.kill.source === 'platform')) {
    return st('problem', 'AI_PAUSED_PLATFORM', 'IA pausada en Betsy', 'Betsy pausó la IA por un momento. Los chats quedan para tu equipo.')
  }
  if (input.kill.armed) {
    return st('problem', 'AI_PAUSED_TENANT', 'IA pausada para este negocio', 'Escribile a Betsy para reactivarla. Los chats quedan para tu equipo.')
  }
  if (!input.flags.softAi || !input.flags.agentLayer) {
    return st('problem', 'AI_NOT_ENABLED', 'IA no habilitada', 'La IA no está habilitada para este negocio. Pedile al administrador de Betsy.')
  }
  if (!input.aiTermsAccepted) {
    return st('problem', 'AI_TERMS', 'Faltan los términos de IA', 'Aceptá los términos de IA (arriba, en Agentes).')
  }
  if (!input.account.isActive || input.account.disconnected || TOKEN_DOWN.has((input.account.tokenStatus || '').toLowerCase())) {
    return st('problem', 'LINE_DISCONNECTED', 'Línea desconectada', 'Reconectá la línea en Cuentas conectadas.')
  }
  if (!input.binding) {
    return st('problem', 'NO_AGENT', 'Sin agente', 'Encendé la línea desde el agente que querés que responda.')
  }

  // The switch's check finished and the line did not turn on: say which cases failed (or why it could not turn on).
  if (finishedQuick) {
    if (finishedQuick.status === 'failed') {
      return st(
        'problem',
        'CHECK_FAILED',
        'La prueba no pasó',
        finishedQuick.failedTitles.length
          ? `Falló: ${failedList(finishedQuick.failedTitles)}. Ajustá el agente y volvé a encender.`
          : 'Ajustá el agente y volvé a encender.',
        { failedCases: finishedQuick.failedTitles },
      )
    }
    if (finishedQuick.status !== 'passed') {
      return st('problem', 'CHECK_STOPPED', 'La prueba no terminó', 'Volvé a encender para probar otra vez.')
    }
    if (finishedQuick.activation && !finishedQuick.activation.ok) {
      const code = finishedQuick.activation.code || ''
      return st('problem', 'ACTIVATION_REFUSED', 'No se pudo encender', POWER_ON_REFUSAL_HINT[code] || 'Volvé a encender la línea.')
    }
  }

  if (input.binding.status !== 'live') return st('problem', 'AGENT_NOT_LIVE', 'Agente en borrador', 'Volvé a encender la línea.')
  if (input.binding.operationMode !== 'ai_full') {
    return st('problem', 'AGENT_HUMAN_ONLY', 'Agente en Solo humanos', 'Volvé a encender la línea para que la IA responda.')
  }
  if (!input.binding.modelAllowed) {
    return st('problem', 'MODEL_NOT_ALLOWED', 'Modelo no disponible', 'El modelo de este agente no está disponible. Elegí otro en Avanzado.')
  }
  if (!input.binding.providerConfigured) {
    return st('problem', 'PROVIDER', 'IA no disponible', 'El modelo de respuestas no está configurado en Betsy.')
  }
  if (input.binding.inventoryMapMissing) {
    return st('problem', 'NO_PRODUCTS', 'Faltan los productos', 'Elegí los productos que vende este agente y volvé a encender.')
  }
  if (!input.allowlisted) return st('problem', 'NOT_ALLOWED', 'IA apagada en esta línea', 'Volvé a encender la línea.')
  if (!input.unlock.unlocked) {
    switch (input.unlock.reason) {
      case 'agent':
      case 'model':
        // Only an agent or model change silences the line (strictUnlockVersion off: a version bump does not).
        return st('problem', 'AGENT_CHANGED', 'El agente cambió', 'El agente cambió: volvé a encender.')
      case 'hash':
      case 'version':
        return st('problem', 'RECHECK', 'Hay que volver a probar', 'Volvé a encender para probar al agente de nuevo.')
      default:
        return st('problem', 'NOT_CHECKED', 'Falta la prueba', 'Tocá Encender: Betsy prueba al agente y, si pasa, la línea queda encendida.')
    }
  }
  if (input.budget.tenantExhausted || input.budget.agentExhausted) {
    return st('problem', 'NO_BUDGET', 'Sin presupuesto de IA hoy', 'Se renueva a las 6:00 pm (hora de Costa Rica) o pedí subir el presupuesto.')
  }
  if (input.lastTurnProblem) {
    return st('problem', 'LAST_TURN', 'La IA no respondió', `En el último chat ${turnProblemCopy(input.lastTurnProblem)}. Revisá la línea.`)
  }
  if (input.unlock.versionWarning) {
    return st('on', 'ON', 'IA respondiendo', 'Cambiaste el agente desde la prueba: sigue respondiendo, conviene volver a probar.', {
      retestSuggested: true,
    })
  }
  return st('on', 'ON', 'IA respondiendo', 'La IA contesta los chats de esta línea.')
}

export type ChatAiState = 'ia' | 'human' | 'paused' | 'off'

export type ChatAiStatus = {
  state: ChatAiState
  /** Chip / banner text: "IA", "Con Ana", "Persona", "IA en pausa", "Sin IA". */
  label: string
  /** Why, in one plain sentence (the line's problem, the hand-off reason…). */
  reason: string
  /** "Devolver a IA" makes sense only when the line answers. */
  canReturnToAi: boolean
}

/** The line part a chat needs (the DTO carries this so the client can recompute after a mode change). */
export type ChatLineAi = Pick<LineAiStatus, 'state' | 'code' | 'label' | 'hint'>

/**
 * Pure: what one chat shows. 'human' and 'paused' (column, then agentState) win — the chat stays with the person
 * until "Devolver a IA"; otherwise the chat follows its line. The chip says "IA" ONLY when the line is on and the
 * chat is on IA. The assignee only names the person; it never decides who has the chat.
 */
export function chatAiStatus(input: {
  line: ChatLineAi | null | undefined
  conversationAiMode: string | null | undefined
  persistedAiMode?: SoftAiAgentMode | null
  /** A person wrote in this chat in the last 24 h (server-computed). Unknown = false. */
  humanWroteRecently?: boolean
  assignedUserName?: string | null
  handoffReason?: string | null
}): ChatAiStatus {
  const lineOn = input.line?.state === 'on'
  const { mode, via } = effectiveConversationAiMode({
    column: input.conversationAiMode,
    persisted: input.persistedAiMode ?? null,
    lineOn,
    humanWroteRecently: input.humanWroteRecently === true,
  })
  const person = input.assignedUserName?.trim()
  if (mode === 'human') {
    const reason =
      input.handoffReason?.trim() ||
      (via === 'line'
        ? 'Una persona escribió en este chat hace poco: sigue con el equipo.'
        : person
          ? `${person} tiene este chat.`
          : 'Una persona tiene este chat.')
    return { state: 'human', label: person ? `Con ${person}` : 'Persona', reason, canReturnToAi: lineOn }
  }
  if (mode === 'paused') {
    return { state: 'paused', label: 'IA en pausa', reason: 'Pausaron la IA en este chat.', canReturnToAi: lineOn }
  }
  if (!lineOn) {
    const line = input.line
    const reason =
      !line || line.state === 'off'
        ? 'La IA está apagada en esta línea.'
        : line.state === 'checking'
          ? 'La línea se está probando.'
          : `${line.label}. ${line.hint}`
    return { state: 'off', label: 'Sin IA', reason, canReturnToAi: false }
  }
  return { state: 'ia', label: 'IA', reason: 'La IA responde este chat.', canReturnToAi: false }
}

/** Old inbox dot from the truth: 'IA' only when the chat is really answered by the AI. */
export function dotFromChatAiStatus(status: ChatAiStatus): 'IA' | 'Hum' {
  return status.state === 'ia' ? 'IA' : 'Hum'
}
