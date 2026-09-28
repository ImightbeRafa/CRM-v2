import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { chatSendRateLimit } from '@/lib/rate-limit'
import {
  QUICK_REPLIES_VERSION_KEY,
  quickRepliesFromSettings,
  quickRepliesVersionFromSettings,
  sanitizeQuickReplies,
} from '@/lib/chat-quick-replies'

export const dynamic = 'force-dynamic'

/** GET /api/chat/quick-replies — the team's quick replies for the chat composer (+ version). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { settings: true } })
  return NextResponse.json(
    {
      success: true,
      items: quickRepliesFromSettings(tenant?.settings),
      version: quickRepliesVersionFromSettings(tenant?.settings),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * PUT /api/chat/quick-replies { items, version } — replaces the list (managers only: these are
 * customer-facing texts such as payment details). `version` must match the stored one, so a
 * stale tab never silently undoes someone else's change. Only the two quick-reply keys of
 * `settings` are written (jsonb_set); every change is audited with the old and new list.
 */
export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  try {
    const rate = await chatSendRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const body = (await request.json().catch(() => null)) as { items?: unknown; version?: unknown } | null
    if (!body || !Array.isArray(body.items)) {
      return NextResponse.json({ error: 'Lista inválida' }, { status: 400 })
    }
    const expected = typeof body.version === 'number' && Number.isInteger(body.version) ? body.version : -1
    const { items, error } = sanitizeQuickReplies(body.items, { tenantId: auth.tenantId })
    if (error) return NextResponse.json({ error }, { status: 400 })

    const before = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { settings: true } })
    const current = quickRepliesVersionFromSettings(before?.settings)
    if (expected !== current) {
      return NextResponse.json(
        { error: 'Alguien más cambió las respuestas rápidas. Se recargó la lista: revisá y guardá de nuevo.', code: 'stale', items: quickRepliesFromSettings(before?.settings), version: current },
        { status: 409 },
      )
    }
    const next = current + 1
    const payload = JSON.stringify(items)
    const updated = await prisma.$executeRaw`
      UPDATE "Tenant"
      SET "settings" = jsonb_set(
        jsonb_set(
          CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END,
          '{chatQuickReplies}', ${payload}::jsonb, true
        ),
        ${`{${QUICK_REPLIES_VERSION_KEY}}`}::text[], to_jsonb(${next}::int), true
      )
      WHERE "id" = ${auth.tenantId}
        AND COALESCE(("settings" ->> ${QUICK_REPLIES_VERSION_KEY})::int, 0) = ${current}
    `
    if (updated === 0) {
      return NextResponse.json({ error: 'Alguien más cambió las respuestas rápidas. Probá de nuevo.', code: 'stale' }, { status: 409 })
    }

    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'Tenant',
      entityId: auth.tenantId,
      description: 'Respuestas rápidas de chat actualizadas',
      oldValues: { chatQuickReplies: quickRepliesFromSettings(before?.settings) },
      newValues: { chatQuickReplies: items },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})

    return NextResponse.json({ success: true, items, version: next })
  } catch (err) {
    console.error('[chat/quick-replies PUT]', err)
    return NextResponse.json({ error: 'No se pudieron guardar las respuestas rápidas.' }, { status: 500 })
  }
}
