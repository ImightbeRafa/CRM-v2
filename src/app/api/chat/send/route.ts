import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const db = prisma as any
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = (token as any).tenantId as string
    if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })

    const body = await request.json()
    const socialAccountId = body.socialAccountId ? String(body.socialAccountId) : null
    const platform = body.platform ? String(body.platform).toLowerCase() : null
    const accountId = body.accountId ? String(body.accountId) : null
    const recipient = body.recipient ? String(body.recipient) : ''
    const content = body.content ? String(body.content) : ''
    const orderId = body.orderId ? String(body.orderId) : null
    const clientId = body.clientId ? String(body.clientId) : null

    if (!recipient || !content) {
      return NextResponse.json({ error: 'Missing recipient or content' }, { status: 400 })
    }

    let account: { id: string; platform: string; accountId: string; accessToken?: string | null } | null = null

    if (socialAccountId) {
      const found = await db.socialAccount.findFirst({ where: { id: socialAccountId, tenantId } })
      if (!found) return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
      account = { id: found.id, platform: found.platform, accountId: found.accountId, accessToken: found.accessToken }
    } else if (platform && accountId) {
      const found = await db.socialAccount.findFirst({ where: { tenantId, platform, accountId } })
      if (!found) return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
      account = { id: found.id, platform: found.platform, accountId: found.accountId, accessToken: found.accessToken }
    } else {
      return NextResponse.json({ error: 'Missing socialAccountId or platform+accountId' }, { status: 400 })
    }

    if (!account.accessToken) {
      return NextResponse.json({ error: `Missing ${account.platform} access token` }, { status: 400 })
    }

    // Provider dispatch
    let dispatchResult = 'sent'
    let providerMessageId: string | undefined
    let providerResponse: any = null

    if (account.platform === 'instagram') {
      try {
        const sendUrl = addAppSecretProofToUrl(buildMetaGraphUrl('me/messages'), account.accessToken)
        const igRes = await fetch(
          sendUrl,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_type: 'RESPONSE',
              recipient: { id: recipient },
              message: { text: content }
            })
          }
        )
        providerResponse = await igRes.json().catch(() => null)
        if (!igRes.ok) {
          console.error('[chat/send] Instagram send failed', providerResponse)
          return NextResponse.json(
            { error: providerResponse?.error?.message || 'Instagram send failed', providerResponse },
            { status: 502 }
          )
        }
        providerMessageId = providerResponse?.message_id || providerResponse?.messages?.[0]?.id
      } catch (e: any) {
        console.error('[chat/send] Instagram send error', e)
        return NextResponse.json({ error: e.message || 'Instagram send error' }, { status: 502 })
      }
    } else if (account.platform === 'whatsapp') {
      try {
        const sendUrl = addAppSecretProofToUrl(buildMetaGraphUrl(`${account.accountId}/messages`), account.accessToken)
        const waRes = await fetch(
          sendUrl,
          {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${account.accessToken}`,
              'Content-Type': 'application/json' 
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipient,
              type: 'text',
              text: { 
                preview_url: false,
                body: content 
              }
            })
          }
        )
        
        const waData = await waRes.json()
        providerResponse = waData
        
        if (!waRes.ok) {
          console.error('[chat/send] WhatsApp send failed', waData)
          return NextResponse.json(
            { error: waData?.error?.message || 'WhatsApp send failed', providerResponse: waData },
            { status: 502 }
          )
        }

        providerMessageId = waData.messages?.[0]?.id
        console.log('[chat/send] WhatsApp message sent', { messageId: providerMessageId, to: recipient })
      } catch (e: any) {
        console.error('[chat/send] WhatsApp send error', e)
        return NextResponse.json({ error: e.message || 'WhatsApp send error' }, { status: 502 })
      }
    } else {
      return NextResponse.json({ error: `Unsupported platform: ${account.platform}` }, { status: 400 })
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
      }
    })

    return NextResponse.json({ success: true, message: saved, providerDispatch: dispatchResult })
  } catch (error) {
    console.error('[chat/send] Internal error', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
