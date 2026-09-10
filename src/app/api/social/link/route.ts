import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { subscribeWhatsAppApp, verifyWhatsAppAssetsForToken, getMetaWhatsAppAppSecret } from '@/lib/meta-api'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { encodeWhatsAppRefreshToken } from '@/lib/social-account-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response

    const db = prisma as any
    const { tenantId, userId } = auth
    const body = await request.json()
    const platform = String(body.platform || '').toLowerCase()
    const accountId = String(body.accountId || '').trim()
    const accessToken = body.accessToken ? String(body.accessToken) : null
    const refreshToken = body.refreshToken ? String(body.refreshToken) : null
    const expiresIn = body.expiresIn ? Number(body.expiresIn) : null
    const claimedWabaId = body.whatsappBusinessAccountId
      ? String(body.whatsappBusinessAccountId).trim()
      : null

    if (!platform || !accountId) {
      return NextResponse.json({ error: 'Missing platform or accountId' }, { status: 400 })
    }

    if (!['instagram', 'whatsapp'].includes(platform)) {
      return NextResponse.json({ error: 'Unsupported social platform' }, { status: 400 })
    }

    let resolvedAccountId = accountId
    let whatsappBusinessAccountId = claimedWabaId

    if (platform === 'whatsapp') {
      if (!accessToken) {
        return NextResponse.json(
          { error: 'Access Token es requerido para vincular WhatsApp', success: false },
          { status: 400 },
        )
      }

      // Same Graph ownership gate as Embedded Signup exchange (SD-02).
      const ownership = await verifyWhatsAppAssetsForToken({
        accessToken,
        phoneNumberId: accountId,
        whatsappBusinessAccountId: claimedWabaId,
      })

      if (!ownership.ok || !ownership.phoneNumberId) {
        console.warn('[social/link] Graph ownership check failed', {
          reason: ownership.reason,
          claimedPhone: Boolean(accountId),
          claimedWaba: Boolean(claimedWabaId),
        })
        return NextResponse.json(
          {
            success: false,
            message: 'WhatsApp phone/WABA could not be verified for this token',
            reason: ownership.reason || 'ownership_failed',
            error: 'WhatsApp phone/WABA could not be verified for this token',
          },
          { status: 403 },
        )
      }

      resolvedAccountId = ownership.phoneNumberId
      whatsappBusinessAccountId = ownership.whatsappBusinessAccountId

      let subscribeOk = false
      let subscribeStatus: number | null = null
      let subscribeTargetId: string | null = null
      let subscribeDetails: unknown = null
      let subscribeErrorMessage: string | null = null

      try {
        const sub = await subscribeWhatsAppApp({
          accessToken,
          phoneNumberId: resolvedAccountId,
          whatsappBusinessAccountId,
        })
        subscribeOk = sub.ok
        subscribeStatus = sub.status
        subscribeTargetId = sub.targetId
        subscribeDetails = sub.data

        if (!sub.ok) {
          console.warn('[social/link] WhatsApp subscribed_apps failed', {
            accountId: resolvedAccountId,
            targetId: sub.targetId,
            status: sub.status,
            data: sub.data,
            hasAppSecret: Boolean(getMetaWhatsAppAppSecret()),
            usingDedicatedWaApp: Boolean((process.env.META_WA_APP_ID || '').trim()),
          })
        } else {
          console.log('[social/link] WhatsApp subscribed_apps success', {
            accountId: resolvedAccountId,
            targetId: sub.targetId,
          })
        }
      } catch (e) {
        subscribeErrorMessage = e instanceof Error ? e.message : 'Subscribe error'
        console.warn('[social/link] WhatsApp subscribed_apps error', e)
      }

      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
      const storedRefreshToken =
        encodeWhatsAppRefreshToken(whatsappBusinessAccountId) || refreshToken

      const existing = await db.socialAccount.findFirst({
        where: { tenantId, platform, accountId: resolvedAccountId },
      })

      let result
      if (existing) {
        result = await db.socialAccount.update({
          where: { id: existing.id },
          data: {
            userId,
            isActive: subscribeOk,
            accessToken: accessToken ?? undefined,
            refreshToken: storedRefreshToken ?? undefined,
            expiresAt: expiresAt ?? undefined,
          },
          select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true },
        })
      } else {
        result = await db.socialAccount.create({
          data: {
            tenantId,
            userId,
            platform,
            accountId: resolvedAccountId,
            isActive: subscribeOk,
            accessToken: accessToken ?? undefined,
            refreshToken: storedRefreshToken ?? undefined,
            expiresAt: expiresAt ?? undefined,
          },
          select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true },
        })
      }

      if (!subscribeOk) {
        return NextResponse.json(
          {
            success: false,
            subscribed: false,
            message:
              'WhatsApp no quedó suscrito a webhooks (subscribed_apps falló). Sin esto no recibirás mensajes en /chats. Revisa permisos del token o usa Re-suscribir.',
            reason: 'subscribe_failed',
            error:
              'WhatsApp no quedó suscrito a webhooks (subscribed_apps falló). Sin esto no recibirás mensajes en /chats. Revisa permisos del token o usa Re-suscribir.',
            status: subscribeStatus,
            targetId: subscribeTargetId,
            details: subscribeDetails,
            subscribeError: subscribeErrorMessage,
            account: result,
          },
          { status: 422 },
        )
      }

      return NextResponse.json({ success: true, subscribed: true, account: result })
    }

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null

    const existing = await db.socialAccount.findFirst({
      where: { tenantId, platform, accountId },
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
        select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true },
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
        select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true },
      })
    }

    return NextResponse.json({ success: true, account: result })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
