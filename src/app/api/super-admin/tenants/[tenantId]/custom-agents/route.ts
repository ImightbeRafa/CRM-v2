/**
 * Per-tenant "Agente personalizado" switch (Rafael only, SPEC §4).
 * GET → current flag + the tenant's agents. PUT {enabled, agentIds?, reason?} → upserts the
 * custom_agents TenantFeatureFlag and writes an AuditLog row in ONE transaction; on a fresh
 * enable, emails the tenant owner "Tu agente está activo".
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { CUSTOM_AGENTS_FLAG, readCustomAgentsFlag } from '@/lib/support/agent-access'
import { buildAgentEnabledEmail, resendSender } from '@/lib/support/notify'
import { requireSuperAdmin } from '@/lib/support/super-admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function tenantAgents(tenantId: string) {
  return prisma.chatAgent.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, status: true, operationMode: true },
    take: 50,
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const guard = await requireSuperAdmin(request)
  if (!guard.ok) return guard.response
  const { tenantId } = await params
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [flag, agents] = await Promise.all([readCustomAgentsFlag(tenantId), tenantAgents(tenantId)])
  return NextResponse.json({ tenant, flag, agents })
}

const putSchema = z.object({
  enabled: z.boolean(),
  agentIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(20).optional(),
  reason: z.string().trim().max(300).optional(),
})

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const guard = await requireSuperAdmin(request, { write: true })
  if (!guard.ok) return guard.response
  const { tenantId } = await params
  const parsed = putSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } })
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only agents of THIS tenant can be listed on its flag.
  const requested = [...new Set(parsed.data.agentIds ?? [])]
  const owned = requested.length
    ? await prisma.chatAgent.findMany({ where: { tenantId, id: { in: requested } }, select: { id: true } })
    : []
  if (owned.length !== requested.length) {
    return NextResponse.json({ error: 'Agente no pertenece a este negocio' }, { status: 400 })
  }

  const before = await readCustomAgentsFlag(tenantId)
  const now = new Date().toISOString()
  const config = {
    agentIds: requested.length ? requested : before?.config.agentIds ?? [],
    enabledBy: guard.userId,
    enabledAt: parsed.data.enabled ? (before?.enabled ? before.config.enabledAt ?? now : now) : before?.config.enabledAt ?? null,
  }
  const flag = await prisma.$transaction(async (tx) => {
    const row = await tx.tenantFeatureFlag.upsert({
      where: { scope_key: { scope: tenantId, key: CUSTOM_AGENTS_FLAG } },
      create: { scope: tenantId, tenantId, key: CUSTOM_AGENTS_FLAG, enabled: parsed.data.enabled, config },
      update: { tenantId, enabled: parsed.data.enabled, config },
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        action: 'UPDATE',
        entityType: 'TenantFeatureFlag',
        entityId: row.id,
        entityName: CUSTOM_AGENTS_FLAG,
        oldValues: before ? { enabled: before.enabled, agentIds: before.config.agentIds } : { enabled: false },
        newValues: { enabled: parsed.data.enabled, agentIds: config.agentIds },
        reason: parsed.data.reason || (parsed.data.enabled ? 'Agente personalizado activado' : 'Agente personalizado desactivado'),
        userId: guard.userId,
        userName: guard.name,
        userRole: 'SUPER_ADMIN',
      },
    })
    return row
  })

  let ownerNotified = false
  if (parsed.data.enabled && !before?.enabled) {
    const owner = await prisma.membership.findFirst({
      where: { tenantId, role: 'OWNER', isActive: true },
      orderBy: { joinedAt: 'asc' },
      select: { user: { select: { email: true } } },
    })
    if (owner?.user.email) {
      const res = await resendSender(buildAgentEnabledEmail(owner.user.email, tenant.name))
      ownerNotified = res.ok
    }
  }
  return NextResponse.json({ ok: true, enabled: flag.enabled, agentIds: config.agentIds, ownerNotified })
}
