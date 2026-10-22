/**
 * Pure parts of the custom_agents entitlement (see agent-access.ts).
 * Flag config: {"enabledBy":"<userId>","enabledAt":"ISO","agentIds":["<ChatAgent.id>"]}.
 */

export type CustomAgentsConfig = { agentIds: string[]; enabledBy: string | null; enabledAt: string | null }

/** Missing / invalid config → empty (never throws). */
export function parseCustomAgentsConfig(raw: unknown): CustomAgentsConfig {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const ids = Array.isArray(obj.agentIds) ? obj.agentIds : []
  return {
    agentIds: [...new Set(ids.filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)))].slice(0, 20),
    enabledBy: typeof obj.enabledBy === 'string' ? obj.enabledBy.slice(0, 64) : null,
    enabledAt: typeof obj.enabledAt === 'string' && !Number.isNaN(Date.parse(obj.enabledAt)) ? obj.enabledAt : null,
  }
}

export function decideCustomAgentAccess(input: {
  pipelineEnabled: boolean
  superAdmin: boolean
  /** null = no flag row (→ off). */
  flagEnabled: boolean | null
}): { enabled: boolean; reason: 'legacy' | 'super_admin' | 'flag' | 'not_enabled' } {
  if (!input.pipelineEnabled) return { enabled: true, reason: 'legacy' }
  if (input.superAdmin) return { enabled: true, reason: 'super_admin' }
  if (input.flagEnabled === true) return { enabled: true, reason: 'flag' }
  return { enabled: false, reason: 'not_enabled' }
}
