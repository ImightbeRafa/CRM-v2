/**
 * GET/POST /api/super-admin/agent-kill — platform kill switch for INBOX Soft agents.
 * Betsy platform admins only (404 to others). Every change is audited with a mandatory reason.
 * Env SOFT_AGENT_KILL=1 is the second, always-on trigger and is read-only here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import {
  KILL_GLOBAL_KEY,
  KillTableMissingError,
  envKillArmed,
  killTenantKey,
  listAgentKills,
  writeAgentKill,
} from '@/lib/soft-ai/agent-kill-switch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

async function gate(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return { response: auth.response }
  if (!(await isSuperAdmin(auth.userId))) {
    return { response: NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE }) }
  }
  return { auth }
}

export async function GET(request: NextRequest) {
  const g = await gate(request)
  if ('response' in g && g.response) return g.response
  try {
    const kills = await listAgentKills()
    return NextResponse.json(
      {
        success: true,
        env: envKillArmed(),
        global: kills.find((k) => k.key === KILL_GLOBAL_KEY)?.armed === true,
        tenants: kills
          .filter((k) => k.key.startsWith('agent_kill_tenant:') && k.armed)
          .map((k) => ({ tenantId: k.key.slice('agent_kill_tenant:'.length), reason: k.reason })),
      },
      { headers: NO_STORE },
    )
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500, headers: NO_STORE })
  }
}

export async function POST(request: NextRequest) {
  const g = await gate(request)
  if ('response' in g && g.response) return g.response
  const auth = g.auth!
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body?.armed !== 'boolean') {
    return NextResponse.json({ success: false, error: 'Falta indicar si se frena o se reanuda.' }, { status: 400, headers: NO_STORE })
  }
  const armed = body.armed
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const scope = body?.scope === 'tenant' ? 'tenant' : 'global'
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : ''
  if (reason.length < 3) {
    return NextResponse.json({ success: false, error: 'Escribí el motivo.' }, { status: 400, headers: NO_STORE })
  }
  if (scope === 'tenant' && !tenantId) {
    return NextResponse.json({ success: false, error: 'Falta el negocio.' }, { status: 400, headers: NO_STORE })
  }
  try {
    await writeAgentKill({
      key: scope === 'tenant' ? killTenantKey(tenantId) : KILL_GLOBAL_KEY,
      armed,
      updatedBy: auth.userId,
      reason,
    })
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'agent_kill_switch',
      entityId: scope === 'tenant' ? tenantId : 'global',
      description: `${armed ? 'Armó' : 'Desarmó'} el freno de agentes (${scope}): ${reason.slice(0, 200)}`,
      newValues: { armed, scope },
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auth.tenantId,
    })
    return NextResponse.json({ success: true, armed, scope }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof KillTableMissingError) {
      return NextResponse.json(
        {
          success: false,
          code: 'KILL_TABLE_MISSING',
          error: 'El freno desde el panel todavía no está activo en la base de datos. Usá SOFT_AGENT_KILL=1 mientras tanto.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    console.error('[super-admin/agent-kill] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Failed' }, { status: 500, headers: NO_STORE })
  }
}
