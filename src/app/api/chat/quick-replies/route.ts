import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { quickRepliesFromSettings, sanitizeQuickReplies } from '@/lib/chat-quick-replies'

export const dynamic = 'force-dynamic'

/** GET /api/chat/quick-replies — the team's quick replies for the chat composer. */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.tenantId }, select: { settings: true } })
  return NextResponse.json(
    { success: true, items: quickRepliesFromSettings(tenant?.settings) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * PUT /api/chat/quick-replies { items: [{ id?, shortcut, text }] } — replaces the list.
 * Only `settings.chatQuickReplies` is written (jsonb_set), so other settings keys are untouched.
 */
export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { items?: unknown } | null
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'Lista inválida' }, { status: 400 })
  }
  const { items, error } = sanitizeQuickReplies(body.items)
  if (error) return NextResponse.json({ error }, { status: 400 })

  const payload = JSON.stringify(items)
  await prisma.$executeRaw`
    UPDATE "Tenant"
    SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{chatQuickReplies}', ${payload}::jsonb, true)
    WHERE "id" = ${auth.tenantId}
  `
  return NextResponse.json({ success: true, items })
}
