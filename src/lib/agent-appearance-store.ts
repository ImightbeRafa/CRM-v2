import 'server-only'
import { prisma } from '@/lib/db'
import { parseAgentAppearance, type AgentAppearance } from '@/lib/agent-appearance'

/**
 * Agent appearance (owner UI only: plate color, ring, display label) as one TenantFeatureFlag row
 * per agent: scope = tenantId, key `agent_appearance:<agentId>`, enabled always false (it is data,
 * not a flag). Same convention as `meta-attribution/settings.ts`. Never read by the agent runtime.
 */
export const AGENT_APPEARANCE_KEY_PREFIX = 'agent_appearance:'

export const appearanceKey = (agentId: string) => `${AGENT_APPEARANCE_KEY_PREFIX}${agentId}`

/** Saved appearances of this business's agents (agent ids that no longer exist are dropped). */
export async function readAgentAppearances(tenantId: string): Promise<Record<string, Partial<AgentAppearance>>> {
  if (!tenantId) return {}
  const [rows, agents] = await Promise.all([
    prisma.tenantFeatureFlag.findMany({
      where: { tenantId, scope: tenantId, key: { startsWith: AGENT_APPEARANCE_KEY_PREFIX } },
      select: { key: true, config: true },
      take: 500,
    }),
    prisma.chatAgent.findMany({ where: { tenantId }, select: { id: true }, take: 500 }),
  ])
  const own = new Set(agents.map((a) => a.id))
  const out: Record<string, Partial<AgentAppearance>> = {}
  for (const row of rows) {
    const agentId = row.key.slice(AGENT_APPEARANCE_KEY_PREFIX.length)
    const parsed = own.has(agentId) ? parseAgentAppearance(row.config) : null
    if (parsed) out[agentId] = parsed
  }
  return out
}

export async function writeAgentAppearance(
  tenantId: string,
  agentId: string,
  appearance: Partial<AgentAppearance>,
  userId: string,
): Promise<Partial<AgentAppearance>> {
  const config = { ...appearance, updatedByUserId: userId, updatedAt: new Date().toISOString() }
  await prisma.tenantFeatureFlag.upsert({
    where: { scope_key: { scope: tenantId, key: appearanceKey(agentId) } },
    create: { scope: tenantId, tenantId, key: appearanceKey(agentId), enabled: false, config },
    update: { enabled: false, config },
  })
  return appearance
}
