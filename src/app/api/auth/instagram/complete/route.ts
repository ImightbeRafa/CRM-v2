import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'
import { subscribePageToInstagramMessages } from '@/lib/meta-api'
import { buildInstagramSuccessHtml } from '@/lib/instagram-connect'
import {
  clearInstagramPending,
  getInstagramPendingCookieName,
  loadInstagramPendingRecord,
} from '@/lib/instagram-pending-connect'
import { encodeInstagramRefreshToken } from '@/lib/social-account-meta'
import { encryptSocialAccessToken } from '@/lib/social-account-crypto'

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
  const encryptedToken = encryptSocialAccessToken(params.pageAccessToken)
  if (existing) {
    return db.socialAccount.update({
      where: { id: existing.id },
      data: {
        accessToken: encryptedToken,
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
      accessToken: encryptedToken,
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
    const loaded = pendingRaw
      ? await loadInstagramPendingRecord(pendingRaw, {
          tenantId: String(token.tenantId),
          userId: String(token.sub),
        })
      : null
    if (!loaded) {
      return new NextResponse('Sesión de conexión expirada. Vuelve a intentar desde /config/social.', {
        status: 400,
      })
    }

    // Bind cookie claims to the active session (SD-01).
    if (
      loaded.cookie.tenantId !== token.tenantId ||
      loaded.cookie.userId !== token.sub ||
      loaded.record.tenantId !== token.tenantId ||
      loaded.record.userId !== token.sub
    ) {
      return new NextResponse('Sesión de conexión no coincide con el usuario autenticado.', {
        status: 403,
      })
    }

    const form = await request.formData().catch(() => null)
    const selectionRaw = form?.get('selection')
    const index = Number(selectionRaw)
    const match = loaded.record.matches[index]
    if (!match) {
      return new NextResponse('Selección inválida', { status: 400 })
    }

    // Cookie only listed page ids — ensure selection is one of them.
    if (!loaded.cookie.pageIds.includes(match.pageId)) {
      return new NextResponse('Selección no autorizada', { status: 403 })
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
      tenantId: loaded.record.tenantId,
      userId: loaded.record.userId,
      igBusinessAccountId: match.igBusinessAccountId,
      pageAccessToken: match.pageAccessToken,
      pageId: match.pageId,
    })

    await clearInstagramPending(loaded.cookie.pendingId)

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
