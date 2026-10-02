/**
 * PATCH/DELETE /api/config/chat-automations/[id] — edit, enable/disable or delete a rule of this business.
 * update_config only; tenantId from the session (a rule of another business is a plain 404); audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { isAssignableChatMember } from '@/lib/chat-conversation-route-helpers'
import { parseRuleInput } from '@/lib/chat-automation-rules'
import { loadTags } from '@/lib/crm-stages-server'
import {
  RulesNotReadyError,
  deleteRule,
  getRule,
  setRuleEnabled,
  updateRule,
} from '@/lib/chat-automation-rules-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ success: false, error: 'Regla no encontrada' }, { status: 404 })

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const existing = await getRule(auth.tenantId, id)
    if (!existing) return notFound()

    // Toggle only: { enabled: boolean }
    if (body && Object.keys(body).length === 1 && typeof body.enabled === 'boolean') {
      await setRuleEnabled(auth.tenantId, id, body.enabled)
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatAutomationRule',
        entityId: id,
        entityName: existing.name,
        oldValues: { enabled: existing.enabled },
        newValues: { enabled: body.enabled },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
      return NextResponse.json({ success: true })
    }

    const parsed = parseRuleInput({ ...existing, ...(body ?? {}) })
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    const { rule } = parsed
    if (rule.actionKind === 'assign' && !(await isAssignableChatMember(auth.tenantId, String(rule.actionConfig.userId)))) {
      return NextResponse.json({ success: false, error: 'Esa persona no puede recibir chats.' }, { status: 400 })
    }
    if (rule.actionKind === 'tag') {
      const allowed = (await loadTags(auth.tenantId)).tags.filter((t) => !t.archived).map((t) => t.key)
      if (!allowed.includes(String(rule.actionConfig.tag))) {
        return NextResponse.json({ success: false, error: 'Elegí una etiqueta de la lista del negocio.' }, { status: 400 })
      }
    }
    if (!(await updateRule(auth.tenantId, id, rule))) return notFound()
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatAutomationRule',
      entityId: id,
      entityName: rule.name,
      oldValues: existing,
      newValues: rule,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof RulesNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las automatizaciones todavía no están disponibles.' }, { status: 503 })
    }
    console.error('[config/chat-automations PATCH]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar la regla' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const existing = await getRule(auth.tenantId, id)
    if (!existing) return notFound()
    await deleteRule(auth.tenantId, id)
    await logAuditEvent({
      action: 'DELETE',
      entityType: 'ChatAutomationRule',
      entityId: id,
      entityName: existing.name,
      oldValues: existing,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof RulesNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las automatizaciones todavía no están disponibles.' }, { status: 503 })
    }
    console.error('[config/chat-automations DELETE]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo borrar la regla' }, { status: 500 })
  }
}
