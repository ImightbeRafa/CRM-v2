import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { subscribeWhatsAppApp } from '@/lib/meta-api'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/social/subscribe
 * Body: { id: string }
 * For WhatsApp numbers: re-call /{phone_number_id}/subscribed_apps to ensure webhook delivery.
 * Instagram re-subscribe requires Page ID and user/page token; we instruct to reconnect via OAuth.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { tenantId } = auth
    const body = await request.json()
    const id = String(body?.id || '').trim()
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = prisma as any
    const rows = await db.$queryRaw<any[]>`
      SELECT id, "tenantId", platform, "accountId", "accessToken"
      FROM "SocialAccount"
      WHERE id = ${id}
    `
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const acc = rows[0]
    if (acc.tenantId !== tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (acc.platform === 'whatsapp') {
      if (!acc.accessToken) return NextResponse.json({ error: 'Missing access token for WhatsApp account' }, { status: 400 })
      try {
        const sub = await subscribeWhatsAppApp({
          accessToken: acc.accessToken,
          phoneNumberId: acc.accountId,
        })

        if (!sub.ok) {
          console.warn('[social/subscribe] WhatsApp subscribed_apps failed', {
            id,
            targetId: sub.targetId,
            status: sub.status,
            data: sub.data,
          })
          return NextResponse.json({
            success: false,
            status: sub.status,
            message: 'Subscribe failed',
            details: sub.data,
          })
        }

        console.log('[social/subscribe] WhatsApp subscribed_apps success', { id, targetId: sub.targetId })
        return NextResponse.json({ success: true, targetId: sub.targetId })
      } catch (e: any) {
        console.warn('[social/subscribe] WhatsApp subscribed_apps error', e)
        return NextResponse.json({ error: e.message || 'Subscribe error' }, { status: 500 })
      }
    }

    // Instagram: needs page context; advise reconnect
    return NextResponse.json({ success: false, message: 'Instagram re-subscribe requires reconnect via OAuth' })
  } catch (e: any) {
    console.error('[social/subscribe] Error', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
