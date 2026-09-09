import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'
import { subscribePageToInstagramMessages } from '@/lib/meta-api'
import { buildInstagramSuccessHtml } from '@/lib/instagram-connect'
import {
  getInstagramPendingCookieName,
  verifyInstagramPendingConnect,
} from '@/lib/instagram-pending-connect'
import { encodeInstagramRefreshToken } from '@/lib/social-account-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function upsertInstagramAccount(params: {
  tenantId: string
  userId: string
  igBusinessAccountId: string
  pageAccessToken: string
  pageId: string
}) {
  const db = prisma as any
  const expiresAt = new Date(Date.now() + 5184000 * 1000)
  const refreshToken = encodeInstagramRefreshToken(params.pageId)
  const existing = await db.socialAccount.findFirst({
    where: {
      tenantId: params.tenantId,
      platform: 'instagram',
      accountId: String(params.igBusinessAccountId),
    },
  })
  if (existing) {
    return db.socialAccount.update({
      where: { id: existing.id },
      data: {
        accessToken: params.pageAccessToken,
        refreshToken: refreshToken ?? undefined,
        expiresAt,
        isActive: true,
        userId: params.userId,
      },
    })
  }
  return db.socialAccount.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      platform: 'instagram',
      accountId: String(params.igBusinessAccountId),
      accessToken: params.pageAccessToken,
      refreshToken: refreshToken ?? undefined,
      expiresAt,
      isActive: true,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.tenantId || !token?.sub) {
      return new NextResponse('Sesión no encontrada', { status: 401 })
    }

    const pendingRaw = request.cookies.get(getInstagramPendingCookieName())?.value || ''
    const pending = pendingRaw ? await verifyInstagramPendingConnect(pendingRaw) : null
    if (!pending || pending.tenantId !== token.tenantId || pending.userId !== token.sub) {
      return new NextResponse('Sesión de conexión expirada. Vuelve a intentar desde /config/social.', {
        status: 400,
      })
    }

    const form = await request.formData().catch(() => null)
    const selectionRaw = form?.get('selection')
    const index = Number(selectionRaw)
    const match = pending.matches[index]
    if (!match) {
      return new NextResponse('Selección inválida', { status: 400 })
    }

    try {
      const sub = await subscribePageToInstagramMessages(match.pageId, match.pageAccessToken)
      if (!sub.ok) {
        console.warn('[instagram/complete] Page subscribe failed', { status: sub.status })
      }
    } catch (error) {
      console.warn('[instagram/complete] Page subscribe error', error)
    }

    await upsertInstagramAccount({
      tenantId: pending.tenantId,
      userId: pending.userId,
      igBusinessAccountId: match.igBusinessAccountId,
      pageAccessToken: match.pageAccessToken,
      pageId: match.pageId,
    })

    const response = new NextResponse(
      buildInstagramSuccessHtml({
        pageName: match.pageName,
        igUsername: match.igUsername,
      }),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
    response.cookies.set(getInstagramPendingCookieName(), '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (error) {
    console.error('[instagram/complete] Unexpected error', error)
    return new NextResponse('Error al completar la conexión de Instagram', { status: 500 })
  }
}
