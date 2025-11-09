import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const db = prisma as any
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = (token as any).tenantId as string
    if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })

    const userId = (token as any)?.sub as string
    const body = await request.json()
    const platform = String(body.platform || '').toLowerCase()
    const accountId = String(body.accountId || '').trim()
    const accessToken = body.accessToken ? String(body.accessToken) : null
    const refreshToken = body.refreshToken ? String(body.refreshToken) : null
    const expiresIn = body.expiresIn ? Number(body.expiresIn) : null

    if (!platform || !accountId) {
      return NextResponse.json({ error: 'Missing platform or accountId' }, { status: 400 })
    }

    // Auto-subscribe WhatsApp number to app so webhooks are delivered
    if (platform === 'whatsapp' && accountId && accessToken) {
      try {
        const subscribeUrl = `https://graph.facebook.com/v18.0/${encodeURIComponent(accountId)}/subscribed_apps`;
        const body = new URLSearchParams({ access_token: accessToken })
        const subRes = await fetch(subscribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body
        })
        const subText = await subRes.text()
        if (!subRes.ok) {
          console.warn('[social/link] WhatsApp subscribed_apps failed', { accountId, status: subRes.status, subText })
        } else {
          console.log('[social/link] WhatsApp number subscribed_apps success', { accountId, subText })
        }
      } catch (e) {
        console.warn('[social/link] WhatsApp subscribed_apps error', e)
      }
    }

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

    const existing = await db.socialAccount.findFirst({
      where: { tenantId, platform, accountId }
    })

    let result
    if (existing) {
      result = await db.socialAccount.update({
        where: { id: existing.id },
        data: {
          userId,
          isActive: true,
          accessToken: accessToken ?? undefined,
          refreshToken: refreshToken ?? undefined,
          expiresAt: expiresAt ?? undefined,
        },
        select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true }
      })
    } else {
      result = await db.socialAccount.create({
        data: {
          tenantId,
          userId,
          platform,
          accountId,
          isActive: true,
          accessToken: accessToken ?? undefined,
          refreshToken: refreshToken ?? undefined,
          expiresAt: expiresAt ?? undefined,
        },
        select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true }
      })
    }

    return NextResponse.json({ success: true, account: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
