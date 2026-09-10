import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readProviderJson(response: Response): Promise<any> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {
      error: {
        message: 'El proveedor Meta devolvió una respuesta no JSON',
        rawPreview: text.slice(0, 120),
      },
    }
  }
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

const META_SEND_TIMEOUT_MS = 15_000

function metaFetchSignal() {
  return AbortSignal.timeout(META_SEND_TIMEOUT_MS)
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) {
      // Always JSON — never HTML redirects for this route
      return auth.response
    }

    const db = prisma as any
    const { tenantId } = auth

    let body: any
    try {
      body = await request.json()
    } catch {
      return jsonError('Cuerpo de solicitud inválido (JSON requerido)', 400)
    }

    const socialAccountId = body.socialAccountId ? String(body.socialAccountId) : null
    const platform = body.platform ? String(body.platform).toLowerCase() : null
    const accountId = body.accountId ? String(body.accountId) : null
    const recipient = body.recipient ? String(body.recipient) : ''
    const content = body.content ? String(body.content) : ''
    const orderId = body.orderId ? String(body.orderId) : null
    const clientId = body.clientId ? String(body.clientId) : null

    if (!recipient || !content) {
      return jsonError('Falta destinatario o contenido del mensaje', 400)
    }

    if (recipient === 'unknown') {
      return jsonError('Destinatario inválido. Selecciona una conversación con un cliente real.', 400)
    }

    let account: {
      id: string
      platform: string
      accountId: string
      accessToken?: string | null
      refreshToken?: string | null
    } | null = null

    if (socialAccountId) {
      const found = await db.socialAccount.findFirst({ where: { id: socialAccountId, tenantId } })
      if (!found) return jsonError('Cuenta social no encontrada', 404)
      account = {
        id: found.id,
        platform: found.platform,
        accountId: found.accountId,
        accessToken: found.accessToken,
        refreshToken: found.refreshToken,
      }
    } else if (platform && accountId) {
      const found = await db.socialAccount.findFirst({ where: { tenantId, platform, accountId } })
      if (!found) return jsonError('Cuenta social no encontrada', 404)
      account = {
        id: found.id,
        platform: found.platform,
        accountId: found.accountId,
        accessToken: found.accessToken,
        refreshToken: found.refreshToken,
      }
    } else {
      return jsonError('Falta socialAccountId o platform+accountId', 400)
    }

    if (!account.accessToken) {
      return jsonError(`Falta el token de acceso de ${account.platform}. Reconecta la cuenta en Configuración Social.`, 400)
    }

    let dispatchResult = 'sent'
    let providerMessageId: string | undefined
    let providerResponse: any = null

    if (account.platform === 'instagram') {
      try {
        const pageId = parseSocialRefreshToken(account.refreshToken).pageId
        const sendPath = pageId ? `${encodeURIComponent(pageId)}/messages` : 'me/messages'
        const sendUrl = addAppSecretProofToUrl(buildMetaGraphUrl(sendPath), account.accessToken)
        const igRes = await fetch(sendUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_type: 'RESPONSE',
            recipient: { id: recipient },
            message: { text: content },
          }),
          signal: metaFetchSignal(),
        })
        providerResponse = await readProviderJson(igRes)
        if (!igRes.ok) {
          console.error('[chat/send] Instagram send failed', {
            status: igRes.status,
            sendPath,
            error: providerResponse?.error,
          })
          return jsonError(
            providerResponse?.error?.message || 'Falló el envío por Instagram',
            502,
            { providerResponse },
          )
        }
        providerMessageId = providerResponse?.message_id || providerResponse?.messages?.[0]?.id
      } catch (e: any) {
        console.error('[chat/send] Instagram send error', e)
        if (isAbortError(e)) {
          return jsonError('Tiempo de espera agotado al contactar Instagram. Intenta de nuevo.', 504)
        }
        return jsonError(e?.message || 'Error al enviar por Instagram', 502)
      }
    } else if (account.platform === 'whatsapp') {
      try {
        const sendUrl = addAppSecretProofToUrl(
          buildMetaGraphUrl(`${account.accountId}/messages`),
          account.accessToken,
          { purpose: 'whatsapp' },
        )
        const waRes = await fetch(sendUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
            type: 'text',
            text: {
              preview_url: false,
              body: content,
            },
          }),
          signal: metaFetchSignal(),
        })

        const waData = await readProviderJson(waRes)
        providerResponse = waData

        if (!waRes.ok) {
          console.error('[chat/send] WhatsApp send failed', { status: waRes.status, error: waData?.error })
          return jsonError(
            waData?.error?.message || 'Falló el envío por WhatsApp',
            502,
            { providerResponse: waData },
          )
        }

        providerMessageId = waData.messages?.[0]?.id
        console.log('[chat/send] WhatsApp message sent', { messageId: providerMessageId, to: recipient })
      } catch (e: any) {
        console.error('[chat/send] WhatsApp send error', e)
        if (isAbortError(e)) {
          return jsonError('Tiempo de espera agotado al contactar WhatsApp. Intenta de nuevo.', 504)
        }
        return jsonError(e?.message || 'Error al enviar por WhatsApp', 502)
      }
    } else {
      return jsonError(`Plataforma no soportada: ${account.platform}`, 400)
    }

    const now = new Date()
    const saved = await db.chatMessage.create({
      data: {
        tenantId,
        socialAccountId: account.id,
        clientId: clientId ?? undefined,
        orderId: orderId ?? undefined,
        direction: 'outbound',
        content,
        metadata: {
          to: recipient,
          provider: account.platform,
          platform: account.platform,
          providerMessageId,
          providerDispatch: dispatchResult,
          providerResponse,
        },
        sentAt: now,
        receivedAt: null,
      },
    })

    return NextResponse.json({ success: true, message: saved, providerDispatch: dispatchResult })
  } catch (error) {
    console.error('[chat/send] Internal error', error)
    return jsonError('Error interno al enviar el mensaje', 500)
  }
}
