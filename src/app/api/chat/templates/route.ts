import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type WhatsAppApprovedTemplate = {
  name: string
  language: string
  status: string
  category?: string
}

/**
 * GET /api/chat/templates?socialAccountId=...
 * Lists APPROVED WhatsApp message templates for the account's WABA
 * using the tenant SocialAccount token (not staff WHATSAPP_* env).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    const url = new URL(request.url)
    const socialAccountId = url.searchParams.get('socialAccountId')
    if (!socialAccountId) {
      return NextResponse.json({ error: 'Missing socialAccountId' }, { status: 400 })
    }

    const db = prisma as any
    const account = await db.socialAccount.findFirst({
      where: { id: socialAccountId, tenantId, isActive: true },
      select: {
        id: true,
        platform: true,
        accountId: true,
        accessToken: true,
        refreshToken: true,
      },
    })

    if (!account) {
      return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
    }
    if (account.platform !== 'whatsapp') {
      return NextResponse.json({ error: 'Templates only available for WhatsApp' }, { status: 400 })
    }

    const accessToken = decryptSocialAccessToken(account.accessToken)
    if (!accessToken) {
      return NextResponse.json({ error: 'Missing access token. Reconnect WhatsApp.' }, { status: 400 })
    }

    const meta = parseSocialRefreshToken(account.refreshToken)
    const wabaId = meta.whatsappBusinessAccountId
    if (!wabaId) {
      return NextResponse.json(
        {
          error:
            'Falta WhatsApp Business Account ID. Reconectá WhatsApp desde Configuración Social.',
        },
        { status: 400 },
      )
    }

    const graphUrl = addAppSecretProofToUrl(
      buildMetaGraphUrl(
        `${encodeURIComponent(wabaId)}/message_templates?limit=50&fields=${encodeURIComponent('name,status,language,category')}`,
      ),
      accessToken,
      { purpose: 'whatsapp' },
    )

    const res = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      console.warn('[chat/templates] Graph fetch failed', {
        status: res.status,
        error: data?.error?.message,
      })
      return NextResponse.json(
        {
          error: data?.error?.message || 'No se pudieron cargar las plantillas Meta',
          providerResponse: data,
        },
        { status: 502 },
      )
    }

    const rawList = Array.isArray(data?.data) ? data.data : []
    const templates: WhatsAppApprovedTemplate[] = rawList
      .map((row: any) => ({
        name: String(row?.name || '').trim(),
        language: String(row?.language || 'es').trim() || 'es',
        status: String(row?.status || '').toUpperCase(),
        category: row?.category ? String(row.category) : undefined,
      }))
      .filter(
        (t: WhatsAppApprovedTemplate) =>
          Boolean(t.name) && (t.status === 'APPROVED' || t.status === 'ACTIVE'),
      )

    return NextResponse.json({ success: true, templates, wabaId })
  } catch (error) {
    console.error('[chat/templates] Internal error', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
