import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { CUSTOM_AGENTS_FLAG } from '@/lib/support/agent-access'
import { parseCustomAgentsConfig } from '@/lib/support/agent-access-core'
import { supportPipelineEnabled } from '@/lib/support/config'
import { requireSuperAdmin } from '@/lib/support/super-admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Rafael's per-business agent access list (/super-admin/agentes): every business with its
 * custom_agents flag, agent count and active channel bindings, so a missing seed is visible.
 */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin(request)
  if (!guard.ok) return guard.response
  const [tenants, flags, agents, bindings] = await Promise.all([
    prisma.tenant.findMany({ select: { id: true, name: true, plan: true, isActive: true }, orderBy: { name: 'asc' }, take: 1000 }),
    prisma.tenantFeatureFlag.findMany({ where: { key: CUSTOM_AGENTS_FLAG }, select: { scope: true, enabled: true, config: true, updatedAt: true } }),
    // AI agents only: the auto-created human_only default agent is not something to protect.
    prisma.chatAgent.findMany({ where: { NOT: { operationMode: 'human_only' } }, select: { id: true, tenantId: true } }),
    prisma.chatAgentBinding.findMany({ where: { isActive: true }, select: { tenantId: true, agentId: true } }),
  ])
  const flagBy = new Map(flags.map((f) => [f.scope, f]))
  const aiAgentIds = new Set(agents.map((a) => a.id))
  const agentsBy = new Map<string, number>()
  for (const a of agents) agentsBy.set(a.tenantId, (agentsBy.get(a.tenantId) ?? 0) + 1)
  const bindingsBy = new Map<string, number>()
  for (const b of bindings) {
    if (aiAgentIds.has(b.agentId)) bindingsBy.set(b.tenantId, (bindingsBy.get(b.tenantId) ?? 0) + 1)
  }
  return NextResponse.json(
    {
      gateActive: supportPipelineEnabled(),
      tenants: tenants.map((t) => {
        const f = flagBy.get(t.id)
        return {
          id: t.id,
          name: t.name,
          plan: String(t.plan),
          isActive: t.isActive,
          agentCount: agentsBy.get(t.id) ?? 0,
          activeBindings: bindingsBy.get(t.id) ?? 0,
          customAgents: f ? { enabled: f.enabled, ...parseCustomAgentsConfig(f.config), updatedAt: f.updatedAt.toISOString() } : null,
        }
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
