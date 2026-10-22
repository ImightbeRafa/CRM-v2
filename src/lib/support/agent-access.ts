/**
 * Per-tenant access to the AI agent editor (SPEC §3 "custom-agent enablement").
 *
 * Rule (only while SUPPORT_PIPELINE_ENABLED=true; off = legacy, everyone keeps the editor):
 *   super admin → yes · TenantFeatureFlag(scope=tenantId, key=custom_agents).enabled → yes · else no.
 * No implicit grandfathering: tenants already running agents get an explicit ON row from
 * scripts/seed-custom-agents-flag.ts before the switch is flipped (runbook).
 *
 * Scope: the editor/config surface only (/api/chat/agents/**, /api/chat/knowledge/**). The
 * runtime (inbox replies of a live agent) is never gated here: a flag lookup must not stop
 * a business's agent from answering. Inbox-side calls (thumbs feedback, AI-terms) stay open.
 */
import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import type { Permission } from '@/lib/rbac'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { supportPipelineEnabled } from './config'
import { decideCustomAgentAccess, parseCustomAgentsConfig, type CustomAgentsConfig } from './agent-access-core'
import { CUSTOM_AGENTS_FLAG, readCustomAgentsFlag } from './agent-flag'

export { CUSTOM_AGENTS_FLAG, readCustomAgentsFlag }

export type CustomAgentAccess = {
  enabled: boolean
  reason: 'legacy' | 'super_admin' | 'flag' | 'not_enabled'
  config: CustomAgentsConfig
}

export async function getCustomAgentAccess(tenantId: string, userId: string | null): Promise<CustomAgentAccess> {
  const pipelineEnabled = supportPipelineEnabled()
  if (!pipelineEnabled) return { enabled: true, reason: 'legacy', config: parseCustomAgentsConfig(null) }
  const [superAdmin, flag] = await Promise.all([
    userId ? isSuperAdmin(userId) : Promise.resolve(false),
    readCustomAgentsFlag(tenantId),
  ])
  const decision = decideCustomAgentAccess({ pipelineEnabled, superAdmin, flagEnabled: flag?.enabled ?? null })
  return { ...decision, config: flag?.config ?? parseCustomAgentsConfig(null) }
}

const NOT_ENABLED_BODY = {
  success: false,
  error: 'Tu negocio todavía no tiene un agente de IA activo.',
  code: 'custom_agents_not_enabled',
}

/** 403 response when the tenant may not use the agent editor; null when allowed. Fails closed. */
export async function customAgentDenied(tenantId: string, userId: string | null): Promise<NextResponse | null> {
  if (!supportPipelineEnabled()) return null
  try {
    const access = await getCustomAgentAccess(tenantId, userId)
    return access.enabled ? null : NextResponse.json(NOT_ENABLED_BODY, { status: 403 })
  } catch (error) {
    console.error('[custom-agents] access check failed', (error as Error)?.name)
    return NextResponse.json({ success: false, error: 'No se pudo verificar el acceso.' }, { status: 503 })
  }
}

/** authenticateAPIWithPermission + the custom_agents gate. Used by every agent-editor API route. */
export async function authenticateAgentAPI(
  request: NextRequest,
  permission: Permission,
  opts: {
    skipBillingGuard?: boolean
    /**
     * Requests that only STOP a live agent (power a line off, deactivate) skip the gate: a business
     * whose access was turned off (or missed by the seed) must still be able to stop its agent.
     */
    isStopRequest?: (body: unknown) => boolean
  } = {},
) {
  // A stop request also skips the billing write guard: a business with restricted billing must still be
  // able to stop its own agent (same as revoking the AI terms).
  const isStop = opts.isStopRequest ? opts.isStopRequest(await request.clone().json().catch(() => null)) : false
  const auth = await authenticateAPIWithPermission(request, permission, {
    skipBillingGuard: opts.skipBillingGuard || isStop,
  })
  if (!auth.ok) return auth
  if (isStop) return auth
  const denied = await customAgentDenied(auth.tenantId, auth.userId)
  if (denied) return { ok: false as const, response: denied }
  return auth
}
