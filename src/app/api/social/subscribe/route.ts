import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { subscribePageToInstagramMessages, subscribeWhatsAppApp } from '@/lib/meta-api'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/social/subscribe
 * Body: { id: string }
 * WhatsApp: /{waba_or_phone}/subscribed_apps
 * Instagram: /{pageId}/subscribed_apps when page id was stored at connect time
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
      SELECT id, "tenantId", platform, "accountId", "accessToken", "refreshToken"
      FROM "SocialAccount"
      WHERE id = ${id}
    `
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const acc = rows[0]
    if (acc.tenantId !== tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const accessToken = decryptSocialAccessToken(acc.accessToken) || null

    if (acc.platform === 'whatsapp') {
      if (!accessToken) {
        return NextResponse.json({ error: 'Missing access token for WhatsApp account' }, { status: 400 })
      }
      const meta = parseSocialRefreshToken(acc.refreshToken)
      try {
        const sub = await subscribeWhatsAppApp({
          accessToken,
          phoneNumberId: acc.accountId,
          whatsappBusinessAccountId: meta.whatsappBusinessAccountId,
        })

        if (!sub.ok) {
          console.warn('[social/subscribe] WhatsApp subscribed_apps failed', {
            id,
            targetId: sub.targetId,
            status: sub.status,
          })
          return NextResponse.json({
            success: false,
            status: sub.status,
            message:
              'WhatsApp no quedó suscrito a webhooks (subscribed_apps falló). Sin esto no recibirás mensajes en /chats.',
            details: sub.data,
          })
        }

        // Activate only after a successful subscribe (aligns with connect contract).
        await db.socialAccount.update({
          where: { id: acc.id },
          data: { isActive: true },
        })

        return NextResponse.json({ success: true, subscribed: true, targetId: sub.targetId })
      } catch (e: any) {
        console.warn('[social/subscribe] WhatsApp subscribed_apps error', e)
        return NextResponse.json({ error: e.message || 'Subscribe error' }, { status: 500 })
      }
    }

    if (acc.platform === 'instagram') {
      if (!accessToken) {
        return NextResponse.json({ error: 'Missing access token for Instagram account' }, { status: 400 })
      }
      const meta = parseSocialRefreshToken(acc.refreshToken)
      if (!meta.pageId) {
        return NextResponse.json({
          success: false,
          message: 'Falta Page ID guardado. Vuelve a conectar Instagram desde /config/social.',
        })
      }
      try {
        const sub = await subscribePageToInstagramMessages(meta.pageId, accessToken)
        if (!sub.ok) {
          return NextResponse.json({
            success: false,
            status: sub.status,
            message: 'Subscribe failed',
            details: sub.data,
          })
        }
        return NextResponse.json({ success: true, pageId: meta.pageId })
      } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Subscribe error' }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 })
  } catch (e: any) {
    console.error('[social/subscribe] Error', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
