import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getConversationPeerId,
  groupMessagesByRecipient,
  humanizeChatSendError,
  messagesFingerprint,
  parseApiJson,
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
})
