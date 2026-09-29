import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { chatSendRateLimit } from '@/lib/rate-limit'
import { deleteChatBlobs } from '@/lib/chat-media'
import {
  QUICK_REPLIES_VERSION_KEY,
  quickRepliesFromSettings,
  quickRepliesVersionFromSettings,
  isQuickReplyMediaPath,
  quickReplyMediaPaths,
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

    // Files dropped from the list are deleted (never left sendable or billable).
    const kept = quickReplyMediaPaths(items)
    const removed = [...quickReplyMediaPaths(quickRepliesFromSettings(before?.settings))].filter((p) => !kept.has(p) && isQuickReplyMediaPath(p, auth.tenantId))
    if (removed.length) {
      // Background: the list change is already committed; file cleanup never delays the answer.
      void deleteChatBlobs(removed).catch((err) => console.warn('[chat/quick-replies] blob cleanup failed', err))
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

type QuickReplyOp =
  | { op: 'upsert'; item: { id?: string; shortcut?: unknown; text?: unknown; media?: unknown } }
  | { op: 'delete'; id: string }

class OpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

/**
 * POST /api/chat/quick-replies { op: 'upsert', item } | { op: 'delete', id } — applies ONE change
 * to the current list inside a transaction that locks the tenant row (SELECT … FOR UPDATE). Two
 * admins editing at once never overwrite each other and there is no version to go stale.
 * Managers only; only the quick-reply keys of settings are written; audited; removed files deleted.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const rate = await chatSendRateLimit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
  }
  const body = (await request.json().catch(() => null)) as QuickReplyOp | null
  if (!body || (body.op !== 'upsert' && body.op !== 'delete')) {
    return NextResponse.json({ error: 'Cambio inválido' }, { status: 400 })
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`
        SELECT "settings" FROM "Tenant" WHERE "id" = ${auth.tenantId} FOR UPDATE
      `
      if (!rows.length) throw new OpError('Negocio no encontrado', 404)
      const beforeItems = quickRepliesFromSettings(rows[0].settings)
      let nextRaw: unknown[]
      if (body.op === 'delete') {
        if (typeof body.id !== 'string') throw new OpError('Falta la respuesta a borrar')
        nextRaw = beforeItems.filter((i) => i.id !== body.id)
      } else {
        const incoming = body.item && typeof body.item === 'object' ? body.item : null
        if (!incoming) throw new OpError('Falta la respuesta')
        const one = sanitizeQuickReplies([incoming], { tenantId: auth.tenantId })
        if (one.error) throw new OpError(one.error)
        if (!one.items.length) throw new OpError('Completá el atajo y el texto (o adjuntá un archivo).')
        // sanitize keeps a valid incoming id (edit) or assigns a new one (create)
        const item = one.items[0]
        const clash = beforeItems.find((i) => i.shortcut === item.shortcut && i.id !== item.id)
        if (clash) throw new OpError(`Ya existe /${item.shortcut}.`)
        const exists = beforeItems.some((i) => i.id === item.id)
        nextRaw = exists ? beforeItems.map((i) => (i.id === item.id ? item : i)) : [...beforeItems, item]
      }
      const { items, error } = sanitizeQuickReplies(nextRaw, { tenantId: auth.tenantId })
      if (error) throw new OpError(error)
      const version = quickRepliesVersionFromSettings(rows[0].settings) + 1
      await tx.$executeRaw`
        UPDATE "Tenant"
        SET "settings" = jsonb_set(
          jsonb_set(
            CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END,
            '{chatQuickReplies}', ${JSON.stringify(items)}::jsonb, true
          ),
          '{chatQuickRepliesVersion}', to_jsonb(${version}::int), true
        )
        WHERE "id" = ${auth.tenantId}
      `
      return { beforeItems, items, version }
    })

    const kept = quickReplyMediaPaths(result.items)
    const removed = [...quickReplyMediaPaths(result.beforeItems)].filter((p) => !kept.has(p) && isQuickReplyMediaPath(p, auth.tenantId))
    if (removed.length) {
      // Background: the list change is already committed; file cleanup never delays the answer.
      void deleteChatBlobs(removed).catch((err) => console.warn('[chat/quick-replies] file cleanup failed', err))
    }
    await logAuditEvent({
      action: body.op === 'delete' ? 'DELETE' : 'UPDATE',
      entityType: 'Tenant',
      entityId: auth.tenantId,
      description: body.op === 'delete' ? 'Respuesta rápida borrada' : 'Respuesta rápida guardada',
      oldValues: { chatQuickReplies: result.beforeItems },
      newValues: { chatQuickReplies: result.items },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, items: result.items, version: result.version })
  } catch (err) {
    if (err instanceof OpError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[chat/quick-replies POST]', err)
    return NextResponse.json({ error: 'No se pudieron guardar las respuestas rápidas.' }, { status: 500 })
  }
}
