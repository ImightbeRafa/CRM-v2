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

    let account: { id: string; platform: string; accountId: string } | null = null

    if (socialAccountId) {
      const found = await db.socialAccount.findFirst({ where: { id: socialAccountId, tenantId } })
      if (!found) return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
      account = { id: found.id, platform: found.platform, accountId: found.accountId }
    } else if (platform && accountId) {
      const found = await db.socialAccount.findFirst({ where: { tenantId, platform, accountId } })
      if (!found) return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
      account = { id: found.id, platform: found.platform, accountId: found.accountId }
    } else {
      return NextResponse.json({ error: 'Missing socialAccountId or platform+accountId' }, { status: 400 })
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
          platform: account.platform
        },
        sentAt: now,
        receivedAt: null,
      }
    })

    // Provider dispatch
    let dispatchResult = 'queued'
    if (account.platform === 'instagram') {
      try {
        const social = await db.socialAccount.findFirst({ where: { id: account.id, tenantId } })
        if (!social?.accessToken) {
          throw new Error('Missing Instagram access token')
        }

        // Instagram Graph API send (using Facebook Graph API for Instagram Business)
        const igRes = await fetch(
          `https://graph.facebook.com/v21.0/me/messages?access_token=${social.accessToken}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: { id: recipient },
              message: { text: content }
            })
          }
        )
        if (!igRes.ok) {
          const err = await igRes.text()
          console.error('[chat/send] Instagram send failed', err)
          dispatchResult = 'failed'
        } else {
          dispatchResult = 'sent'
        }
      } catch (e: any) {
        console.error('[chat/send] Instagram send error', e)
        dispatchResult = 'error'
      }
    } else if (account.platform === 'whatsapp') {
      try {
        const social = await db.socialAccount.findFirst({ where: { id: account.id, tenantId } })
        if (!social?.accessToken) {
          throw new Error('Missing WhatsApp access token')
        }

        // WhatsApp Cloud API send message
        // The accountId is the Phone Number ID
        const waRes = await fetch(
          `https://graph.facebook.com/v21.0/${social.accountId}/messages`,
          {
            method: 'POST',
            headers: { 
              'Authorization': `Bearer ${social.accessToken}`,
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
        
        if (!waRes.ok) {
          console.error('[chat/send] WhatsApp send failed', waData)
          dispatchResult = 'failed'
        } else {
          console.log('[chat/send] WhatsApp message sent', { 
            messageId: waData.messages?.[0]?.id,
            to: recipient 
          })
          dispatchResult = 'sent'
        }
      } catch (e: any) {
        console.error('[chat/send] WhatsApp send error', e)
        dispatchResult = 'error'
      }
    }

    return NextResponse.json({ success: true, message: saved, providerDispatch: dispatchResult })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
