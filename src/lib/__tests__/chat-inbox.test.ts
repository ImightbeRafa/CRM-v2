import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appendOptimisticOutbound,
  chatSendErrorNeedsReconnect,
  createOptimisticOutboundMessage,
  getConversationPeerId,
  groupMessagesByRecipient,
  humanizeChatSendError,
  markOptimisticOutboundFailed,
  messagesFingerprint,
  newClientRequestId,
  outboundDeliveryLabel,
  parseApiJson,
  preferDeliveryStatus,
  projectOptimisticListPreview,
  reconcileOptimisticOutbound,
} from '../chat-inbox'

describe('chat-inbox helpers', () => {
  it('resolves peer ids from inbound from / outbound to', () => {
    assert.equal(
      getConversationPeerId({ direction: 'inbound', metadata: { from: '507123' } }),
      '507123',
    )
    assert.equal(
      getConversationPeerId({ direction: 'outbound', metadata: { to: '507123' } }),
      '507123',
    )
    assert.equal(getConversationPeerId({ direction: 'inbound', metadata: {} }), 'unknown')
    assert.equal(
      getConversationPeerId({
        direction: 'outbound',
        metadata: { from: '507123', webhookField: 'smb_message_echoes', smbEcho: true },
      }),
      '507123',
    )
    assert.equal(
      getConversationPeerId({
        direction: 'outbound',
        metadata: { from: '507123', historical: true, webhookField: 'history' },
      }),
      '507123',
    )
    assert.equal(
      getConversationPeerId({ direction: 'outbound', metadata: { from: '507123' } }),
      'unknown',
    )
  })

  it('groups inbound + outbound into one conversation without losing selection key', () => {
    const convs = groupMessagesByRecipient(
      [
        {
          id: '1',
          direction: 'inbound',
          content: 'Hola',
          sentAt: '2026-09-10T10:00:00.000Z',
          receivedAt: '2026-09-10T10:00:01.000Z',
          metadata: { from: 'ig-user-1', name: 'Ana', platform: 'instagram' },
        },
        {
          id: '2',
          direction: 'outbound',
          content: 'Buenas',
          sentAt: '2026-09-10T10:01:00.000Z',
          receivedAt: null,
          metadata: { to: 'ig-user-1', platform: 'instagram' },
        },
      ],
      'instagram',
    )

    assert.equal(convs.length, 1)
    assert.equal(convs[0].recipientId, 'ig-user-1')
    assert.equal(convs[0].recipientName, 'Ana')
    assert.equal(convs[0].messages.length, 2)
    assert.equal(convs[0].lastMessage, 'Buenas')
  })

  it('keeps legacy tagged coexistence outbound (from-only) in the customer thread', () => {
    const convs = groupMessagesByRecipient(
      [
        {
          id: '1',
          direction: 'inbound',
          content: 'Hola',
          sentAt: '2026-09-20T10:00:00.000Z',
          receivedAt: '2026-09-20T10:00:01.000Z',
          metadata: { from: '16505551234', name: 'Cliente', platform: 'whatsapp' },
        },
        {
          id: '2',
          direction: 'outbound',
          content: 'Echo viejo',
          sentAt: '2026-09-20T10:01:00.000Z',
          receivedAt: null,
          metadata: {
            from: '16505551234',
            platform: 'whatsapp',
            webhookField: 'smb_message_echoes',
            smbEcho: true,
          },
        },
      ],
      'whatsapp',
    )

    assert.equal(convs.length, 1)
    assert.equal(convs[0].recipientId, '16505551234')
    assert.equal(convs[0].messages.length, 2)
  })

  it('does not fall back outbound from unless the row is tagged coexistence', () => {
    const convs = groupMessagesByRecipient(
      [
        {
          id: '1',
          direction: 'inbound',
          content: 'Hola',
          sentAt: '2026-09-20T10:00:00.000Z',
          receivedAt: '2026-09-20T10:00:01.000Z',
          metadata: { from: '16505551234', platform: 'whatsapp' },
        },
        {
          id: '2',
          direction: 'outbound',
          content: 'CRM send',
          sentAt: '2026-09-20T10:01:00.000Z',
          receivedAt: null,
          metadata: { from: '16505551234', platform: 'whatsapp' },
        },
      ],
      'whatsapp',
    )

    assert.equal(convs.length, 2)
    assert.ok(convs.some((c) => c.recipientId === '16505551234'))
    assert.ok(convs.some((c) => c.recipientId === 'unknown'))
  })

  it('fingerprints messages for calm silent polls', () => {
    const a = messagesFingerprint([
      {
        id: '1',
        direction: 'inbound',
        content: 'x',
        sentAt: 't1',
        receivedAt: null,
      },
    ])
    const b = messagesFingerprint([
      {
        id: '1',
        direction: 'inbound',
        content: 'x',
        sentAt: 't1',
        receivedAt: null,
      },
    ])
    const c = messagesFingerprint([
      {
        id: '1',
        direction: 'inbound',
        content: 'xy',
        sentAt: 't1',
        receivedAt: null,
      },
    ])
    assert.equal(a, b)
    assert.notEqual(a, c)
  })

  it('parseApiJson handles HTML error pages without throwing', async () => {
    const htmlRes = new Response('<!DOCTYPE html><html><body>Login</body></html>', {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
    })
    const parsed = await parseApiJson(htmlRes)
    assert.equal(parsed.ok, false)
    if (parsed.ok) throw new Error('expected failure')
    assert.equal(parsed.isHtml, true)
    assert.match(parsed.error, /HTML/)

    const jsonRes = new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const ok = await parseApiJson<{ success: boolean }>(jsonRes)
    assert.equal(ok.ok, true)
    if (!ok.ok) throw new Error('expected success')
    assert.equal(ok.data.success, true)
  })

  it('humanizeChatSendError maps DOCTYPE parse noise to Spanish', () => {
    const msg = humanizeChatSendError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)
    assert.match(msg, /HTML|Recarga/i)
    assert.equal(humanizeChatSendError(null, 403), 'No tienes permiso para enviar mensajes.')
  })

  it('humanizeChatSendError maps Meta 24h window failures to Spanish', () => {
    assert.match(
      humanizeChatSendError(
        '(#131047) Message failed to send because more than 24 hours have passed since the customer last replied to this number',
      ),
      /ventana de 24 horas/i,
    )
    assert.match(
      humanizeChatSendError('Message is outside of the allowed messaging window'),
      /ventana de 24 horas/i,
    )
    assert.match(
      humanizeChatSendError('This message was not delivered because it is a re-engagement message'),
      /ventana de 24 horas|plantilla/i,
    )
  })

  it('chatSendErrorNeedsReconnect detects token/oauth reconnect cases', () => {
    assert.equal(chatSendErrorNeedsReconnect('Token de acceso expirado. Reconectá la cuenta.'), true)
    assert.equal(chatSendErrorNeedsReconnect('(#190) Session has been invalidated'), true)
    assert.equal(chatSendErrorNeedsReconnect('OAuthException: Error validating access token'), true)
    assert.equal(chatSendErrorNeedsReconnect('La ventana de 24 horas ya cerró'), false)
  })

  it('outboundDeliveryLabel covers pending/sent/failed/delivered/read', () => {
    assert.equal(outboundDeliveryLabel('pending'), 'Enviando…')
    assert.equal(outboundDeliveryLabel('sent'), 'Enviado ✓')
    assert.equal(outboundDeliveryLabel('failed'), 'Falló ✕')
    assert.equal(outboundDeliveryLabel('delivered'), 'Entregado')
    assert.equal(outboundDeliveryLabel('read'), 'Leído')
  })

  it('optimistic outbound create/append/reconcile/fail stays correlated by clientRequestId', () => {
    const clientRequestId = newClientRequestId()
    assert.ok(clientRequestId.length > 8)

    const optimistic = createOptimisticOutboundMessage({
      content: 'Hola desk',
      clientRequestId,
      to: '506888',
      platform: 'whatsapp',
      sentAt: '2026-09-21T12:00:00.000Z',
    })
    assert.equal(optimistic.id, `optimistic:${clientRequestId}`)
    assert.equal(optimistic.direction, 'outbound')
    assert.equal(optimistic.deliveryStatus, 'pending')
    assert.equal(optimistic.clientRequestId, clientRequestId)
    assert.equal(optimistic.metadata?.clientRequestId, clientRequestId)

    const withOptimistic = appendOptimisticOutbound([], optimistic)
    assert.equal(withOptimistic.length, 1)
    assert.equal(appendOptimisticOutbound(withOptimistic, optimistic).length, 1)

    const persisted = {
      id: 'msg_server_1',
      direction: 'outbound' as const,
      content: 'Hola desk',
      sentAt: '2026-09-21T12:00:01.000Z',
      receivedAt: null,
      deliveryStatus: 'sent',
      clientRequestId,
      metadata: { clientRequestId, to: '506888' },
    }
    const reconciled = reconcileOptimisticOutbound(withOptimistic, persisted)
    assert.equal(reconciled.length, 1)
    assert.equal(reconciled[0].id, 'msg_server_1')
    assert.equal(reconciled[0].deliveryStatus, 'sent')
    assert.equal(reconciled[0].clientRequestId, clientRequestId)

    const failed = markOptimisticOutboundFailed(withOptimistic, clientRequestId)
    assert.equal(failed[0].deliveryStatus, 'failed')
    assert.equal(preferDeliveryStatus('failed', 'sent'), 'sent')
    assert.equal(preferDeliveryStatus('sent', 'delivered'), 'delivered')
  })

  it('projectOptimisticListPreview updates last message preview fields', () => {
    const row = projectOptimisticListPreview(
      {
        lastMessage: 'antes',
        lastMessageAt: '2026-09-21T11:00:00.000Z',
        lastMessageDirection: 'inbound',
        unreadCount: 2,
      },
      'Nuevo outbound',
      '2026-09-21T12:00:00.000Z',
    )
    assert.equal(row.lastMessage, 'Nuevo outbound')
    assert.equal(row.lastMessageAt, '2026-09-21T12:00:00.000Z')
    assert.equal(row.lastMessageDirection, 'outbound')
    assert.equal(row.unreadCount, 2)
  })
})
