/**
 * GET/POST /api/super-admin/agent-kill — platform kill switch for INBOX Soft agents.
 * Betsy platform admins only (404 to others). Every change is audited with a mandatory reason.
 * Env SOFT_AGENT_KILL=1 is the second, always-on trigger and is read-only here.
 * POST authenticates from the session token directly (like the other super-admin write routes) so a
 * billing restriction on the admin's own business can never block an emergency stop.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginJson } from '@/lib/same-origin'
import { authenticateAPI } from '@/lib/auth-helpers'
import { getLiveToken } from '@/lib/live-token'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
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
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
const bad = (error: string) => NextResponse.json({ success: false, error }, { status: 400, headers: NO_STORE })

export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  if (!(await isSuperAdmin(auth.userId))) return notFound()
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
  const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
  const userId = token?.sub
  if (!userId || !(await isSuperAdmin(userId))) return notFound()
  // Arming/disarming every agent on the platform: JSON from this site only (CSRF defence in depth).
  if (!isSameOriginJson(request)) return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403, headers: NO_STORE })
  const homeTenantId = (token as { tenantId?: string | null }).tenantId || ''

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof body?.armed !== 'boolean') return bad('Falta indicar si se frena o se reanuda.')
  const armed = body.armed
  const scope = body.scope
  if (scope !== 'global' && scope !== 'tenant') return bad('Alcance inválido.')
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3) return bad('Escribí el motivo.')

  let auditTenantId = homeTenantId
  let tenantId = ''
  if (scope === 'tenant') {
    tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : ''
    if (!tenantId) return bad('Falta el negocio.')
    const exists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!exists) return notFound()
    auditTenantId = tenantId // the affected business sees the event in its own log
  }
  if (!auditTenantId) return bad('No se pudo registrar la auditoría.')

  try {
    await writeAgentKill({
      key: scope === 'tenant' ? killTenantKey(tenantId) : KILL_GLOBAL_KEY,
      armed,
      updatedBy: userId,
      reason,
    })
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'agent_kill_switch',
      entityId: scope === 'tenant' ? tenantId : 'global',
      description: `${armed ? 'Armó' : 'Desarmó'} el freno de agentes (${scope}): ${reason.slice(0, 200)}`,
      newValues: { armed, scope },
      userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auditTenantId,
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
