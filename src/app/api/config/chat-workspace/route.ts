import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { loadStages } from '@/lib/crm-stages-server'
import { isClosedCategory } from '@/lib/crm-stages'
import { validateWorkspaceSettings } from '@/lib/chat-assignment-rules'
import { loadWorkspaceSettings, saveWorkspaceSettings } from '@/lib/chat-workspace-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function publicSettings(s: Awaited<ReturnType<typeof loadWorkspaceSettings>>['settings']) {
  return {
    assignmentMode: s.assignmentMode,
    assigneeUserIds: s.assigneeUserIds,
    skipAiActive: s.skipAiActive,
    businessHours: s.businessHours,
    timezone: s.timezone,
    autoCloseDays: s.autoCloseDays,
    autoCloseStageKey: s.autoCloseStageKey,
    reopenOnInbound: s.reopenOnInbound,
    assignmentEnabledAt: s.assignmentEnabledAt ? s.assignmentEnabledAt.toISOString() : null,
  }
}

/** GET — assignment rules, business hours and auto-close of this business (Config › Chats). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config')
  if (!auth.ok) return auth.response
  const { available, settings } = await loadWorkspaceSettings(auth.tenantId)
  return NextResponse.json({ success: true, available, settings: publicSettings(settings) }, { headers: { 'Cache-Control': 'no-store' } })
}

/** PUT — owners / admins only; audited. Everything stays off unless turned on here. */
export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const json = await request.json().catch(() => null)
  const { stages } = await loadStages(auth.tenantId, 'chat')
  const closedKeys = stages.filter((s) => !s.archived && isClosedCategory(s.category)).map((s) => s.key)
  const valid = validateWorkspaceSettings(json, closedKeys)
  if (!valid.ok) return NextResponse.json({ success: false, error: valid.error }, { status: 400 })
  const before = await loadWorkspaceSettings(auth.tenantId)
  if (!before.available) return NextResponse.json({ success: false, error: 'Esta configuración aún no está disponible.' }, { status: 503 })
  const saved = await saveWorkspaceSettings(auth.tenantId, auth.userId, valid.settings)
  if (!saved.ok) return NextResponse.json({ success: false, error: saved.error }, { status: saved.status })
  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'ChatWorkspaceSettings',
    entityId: auth.tenantId,
    description: 'Reglas de chats actualizadas (asignación / horario / cierre automático)',
    oldValues: { mode: before.settings.assignmentMode, people: before.settings.assigneeUserIds.length, autoCloseDays: before.settings.autoCloseDays, reopen: before.settings.reopenOnInbound },
    newValues: { mode: saved.settings.assignmentMode, people: saved.settings.assigneeUserIds.length, autoCloseDays: saved.settings.autoCloseDays, reopen: saved.settings.reopenOnInbound },
    userId: auth.userId,
    userRole: auth.role,
    tenantId: auth.tenantId,
  }).catch(() => {})
  return NextResponse.json({ success: true, available: true, settings: publicSettings(saved.settings) })
}
