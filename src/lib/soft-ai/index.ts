/**
 * Soft Tenant AI — public barrel (customer inbox agent, not staff bot).
 */

export {
  SOFT_TENANT_AI_V1_FLAG,
  DEFAULT_SOFT_AI_CONFIG,
  parseSoftAiConfig,
  softAiConfigToJson,
  isPaymentSensitiveText,
  isToolAllowed,
} from '@/lib/soft-ai/config'
export type {
  SoftAiAgentMode,
  SoftAiToolName,
  SoftAiToolLogEntry,
  SoftAiConfig,
  SoftAiTurnMessage,
  SoftAiTurnInput,
  SoftAiTurnResult,
} from '@/lib/soft-ai/types'
export { SOFT_AI_ALL_TOOLS } from '@/lib/soft-ai/types'
export { runSoftAiTurn } from '@/lib/soft-ai/worker'
export {
  SOFT_AI_AGENT_STATE_KEY,
  readAgentStateMap,
  writeAgentStateMap,
  getConversationAgentState,
  applyAgentControl,
  appendToolLog,
  agentModeLabel,
  defaultAgentMode,
  isSoftHumanComposerEnabled,
  type SoftAiConversationState,
  type SoftAiAgentStateMap,
} from '@/lib/soft-ai/agent-state'
export {
  extractOrderHint,
  runCreateOrLinkOrder,
  runGetOrderStatus,
  runCorreosGuia,
  runTagChat,
  runEscalateToHuman,
  type SoftAiToolDeps,
} from '@/lib/soft-ai/tools'
export {
  canEnableSoftTenantAi,
  canDisablePaymentAlwaysHuman,
  decideSoftAiConfigPatch,
  wantsEnabledTrueFromBody,
  wantsPaymentAlwaysHumanFalseFromBody,
  SOFT_AI_CONFIG_FORBIDDEN,
  SOFT_AI_PAYMENT_GATE_FORBIDDEN,
} from '@/lib/soft-ai/config-rbac'
export {
  resolvePersistedAgentMode,
  maySoftAiMetaReply,
  softAiConversationKey,
} from '@/lib/soft-ai/agent-mode-server'
