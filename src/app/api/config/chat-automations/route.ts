/**
 * GET/POST /api/config/chat-automations — this business's automation rules (internal actions only).
 * tenantId from the session; creating needs update_config and is audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission, type Role } from '@/lib/rbac'
import { logAuditEvent } from '@/lib/auditLogger'
import { isAssignableChatMember } from '@/lib/chat-conversation-route-helpers'
import { parseRuleInput } from '@/lib/chat-automation-rules'
import { loadTags } from '@/lib/crm-stages-server'
import {
  RuleLimitError,
  RulesNotReadyError,
  createRule,
  listRules,
} from '@/lib/chat-automation-rules-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const result = await listRules(auth.tenantId)
    return NextResponse.json(
      { success: true, ...result, canEdit: hasPermission(auth.role as Role, 'update_config') },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[config/chat-automations GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudieron cargar las reglas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const parsed = parseRuleInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    const rule = { ...parsed.rule, enabled: false } // new rules are always created off
    if (rule.actionKind === 'assign' && !(await isAssignableChatMember(auth.tenantId, String(rule.actionConfig.userId)))) {
      return NextResponse.json({ success: false, error: 'Esa persona no puede recibir chats.' }, { status: 400 })
    }
    if (rule.actionKind === 'tag') {
      const allowed = (await loadTags(auth.tenantId)).tags.filter((t) => !t.archived).map((t) => t.key)
      if (!allowed.includes(String(rule.actionConfig.tag))) {
        return NextResponse.json({ success: false, error: 'Elegí una etiqueta de la lista del negocio.' }, { status: 400 })
      }
    }
    const id = await createRule(auth.tenantId, auth.userId, rule)
    await logAuditEvent({
      action: 'CREATE',
      entityType: 'ChatAutomationRule',
      entityId: id,
      entityName: rule.name,
      newValues: rule,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, id })
  } catch (error) {
    if (error instanceof RulesNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las automatizaciones todavía no están disponibles.' }, { status: 503 })
    }
    if (error instanceof RuleLimitError) {
      return NextResponse.json({ success: false, error: 'Llegaste al máximo de reglas (20).' }, { status: 409 })
    }
    console.error('[config/chat-automations POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar la regla' }, { status: 500 })
  }
}
