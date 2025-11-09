import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'

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
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tenantId = String(token.tenantId)
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
        const subscribeUrl = `https://graph.facebook.com/v18.0/${encodeURIComponent(acc.accountId)}/subscribed_apps`
        const form = new URLSearchParams({ access_token: acc.accessToken })
        const subRes = await fetch(subscribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form
        })
        const subText = await subRes.text()
        if (!subRes.ok) {
          console.warn('[social/subscribe] WhatsApp subscribed_apps failed', { id, status: subRes.status, subText })
          return NextResponse.json({ success: false, status: subRes.status, message: 'Subscribe failed', details: subText })
        }
        console.log('[social/subscribe] WhatsApp subscribed_apps success', { id, subText })
        return NextResponse.json({ success: true })
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
