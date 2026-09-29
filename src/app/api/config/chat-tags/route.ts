import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/rbac'
import { loadTags, saveTags } from '@/lib/crm-stages-server'
import { validateTagList } from '@/lib/crm-stages'
import { logAuditEvent } from '@/lib/auditLogger'
import { recordActivity } from '@/lib/activity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  // People who work chats or see config (SecureDog AUTH-37: not every member).
  if (!hasPermission(auth.role, 'update_sales') && !hasPermission(auth.role, 'view_config')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  const result = await loadTags(auth.tenantId)
  return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const json = (await request.json().catch(() => null)) as { tags?: unknown } | null
  const valid = validateTagList(json?.tags)
  if (!valid.ok) return NextResponse.json({ success: false, error: valid.error }, { status: 400 })
  const current = await loadTags(auth.tenantId)
  if (!current.available) {
    return NextResponse.json({ success: false, error: 'La personalización de etiquetas aún no está disponible.' }, { status: 503 })
  }
  await saveTags(auth.tenantId, valid.tags, auth.userId)
  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'CrmTag',
    entityId: auth.tenantId,
    description: 'Etiquetas de chats actualizadas',
    oldValues: { keys: current.tags.map((t) => t.key) },
    newValues: { keys: valid.tags.map((t) => t.key) },
    userId: auth.userId,
    userRole: auth.role,
    tenantId: auth.tenantId,
  }).catch(() => {})
  void recordActivity({ tenantId: auth.tenantId, actorUserId: auth.userId, verb: 'config.tags.save', surface: 'config', props: { count: valid.tags.length } })
  const saved = await loadTags(auth.tenantId)
  return NextResponse.json({ success: true, ...saved })
}
