/** Reads the custom_agents TenantFeatureFlag row (no auth imports: used by MCP tools and the gate). */
import 'server-only'
import { prisma } from '@/lib/db'
import { CUSTOM_AGENTS_FLAG } from '@/lib/feature-flags'
import { parseCustomAgentsConfig } from './agent-access-core'

export { CUSTOM_AGENTS_FLAG }

export async function readCustomAgentsFlag(tenantId: string) {
  const row = await prisma.tenantFeatureFlag.findFirst({
    where: { scope: tenantId, tenantId, key: CUSTOM_AGENTS_FLAG },
    select: { enabled: true, config: true, updatedAt: true },
  })
  return row ? { enabled: row.enabled === true, config: parseCustomAgentsConfig(row.config), updatedAt: row.updatedAt } : null
}
