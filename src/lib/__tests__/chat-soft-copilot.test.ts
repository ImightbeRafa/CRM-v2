import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAiSummary,
  buildSuggestedReply,
  computeUnreadCount,
  filterSoftConversations,
  formatRelativeEs,
  initialsFromName,
  isWhatsAppWindowClosedError,
  isWhatsAppWindowOpen,
  type SoftConversation,
} from '../chat-soft-copilot'

describe('chat-soft-copilot helpers', () => {
  it('computes unread as trailing inbound after last outbound', () => {
    assert.equal(
      computeUnreadCount([
        { id: '1', direction: 'inbound', content: 'a', sentAt: 't1', receivedAt: null },
        { id: '2', direction: 'outbound', content: 'b', sentAt: 't2', receivedAt: null },
        { id: '3', direction: 'inbound', content: 'c', sentAt: 't3', receivedAt: null },
        { id: '4', direction: 'inbound', content: 'd', sentAt: 't4', receivedAt: null },
      ]),
      2,
    )
    assert.equal(
      computeUnreadCount([
        { id: '1', direction: 'inbound', content: 'a', sentAt: 't1', receivedAt: null },
        { id: '2', direction: 'outbound', content: 'b', sentAt: 't2', receivedAt: null },
      ]),
      0,
    )
  })

  it('formats relative times and initials', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z')
    assert.equal(formatRelativeEs('2026-09-10T11:58:00.000Z', now), '2m')
    assert.equal(formatRelativeEs('2026-09-10T10:00:00.000Z', now), '2h')
    assert.equal(initialsFromName('María Soto'), 'MS')
    assert.equal(initialsFromName('@cliente.ig'), 'CL')
  })

  it('detects WA 24h window from last inbound', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z')
    const open = isWhatsAppWindowOpen(
      [
        {
          id: '1',
          direction: 'inbound',
          content: 'hola',
          sentAt: '2026-09-10T10:00:00.000Z',
          receivedAt: '2026-09-10T10:00:00.000Z',
        },
      ],
      'whatsapp',
      now,
    )
    assert.equal(open, true)

    const closed = isWhatsAppWindowOpen(
      [
        {
          id: '1',
          direction: 'inbound',
          content: 'hola',
          sentAt: '2026-09-08T10:00:00.000Z',
          receivedAt: '2026-09-08T10:00:00.000Z',
        },
      ],
      'whatsapp',
      now,
    )
    assert.equal(closed, false)
    assert.equal(isWhatsAppWindowOpen([], 'instagram', now), true)
    assert.equal(isWhatsAppWindowClosedError('La ventana de 24 horas ya cerró.'), true)
  })

  it('builds stub Resumen IA and suggested reply from guía / pedido cues', () => {
    const conv: SoftConversation = {
      recipientId: '506',
      recipientName: 'María Soto',
      socialAccountId: 'acc1',
      platform: 'whatsapp',
      accountLabel: 'WA · PatchHouse',
      status: 'en_curso',
      tags: ['Envío'],
      messages: [
        {
          id: '1',
          direction: 'inbound',
          content: '¿Ya salió el pedido ORDER-992?',
          sentAt: 't1',
          receivedAt: 't1',
        },
        {
          id: '2',
          direction: 'outbound',
          content: 'Sí, hoy a las 3pm.',
          sentAt: 't2',
          receivedAt: null,
        },
        {
          id: '3',
          direction: 'inbound',
          content: 'Perfecto, ¿me mandás la guía?',
          sentAt: 't3',
          receivedAt: 't3',
        },
      ],
    }

    const summary = buildAiSummary(conv)
    assert.match(summary, /guía/i)
    assert.match(summary, /ORDER-992/i)

    const suggestion = buildSuggestedReply(conv)
    assert.match(suggestion.draft, /guía/i)
    assert.match(suggestion.title, /guía/i)
  })

  it('filters by bucket, channel, account and search', () => {
    const base: SoftConversation = {
      recipientId: '1',
      recipientName: 'María Soto',
      lastMessage: 'hola',
      socialAccountId: 'wa1',
      platform: 'whatsapp',
      accountLabel: 'WA · PatchHouse',
      status: 'en_curso',
      tags: ['Envío'],
      messages: [],
    }
    const ig: SoftConversation = {
      ...base,
      recipientId: '2',
      recipientName: '@cliente.ig',
      socialAccountId: 'ig1',
      platform: 'instagram',
      accountLabel: 'IG · @betsy',
      status: 'hecho',
    }

    const open = filterSoftConversations([base, ig], {
      bucket: 'abiertos',
      channel: 'todos',
      accountId: 'all',
      search: '',
    })
    assert.equal(open.length, 1)
    assert.equal(open[0].recipientId, '1')

    const wa = filterSoftConversations([base, ig], {
      bucket: 'tus_chats',
      channel: 'whatsapp',
      accountId: 'all',
      search: '',
    })
    assert.equal(wa.length, 1)

    const search = filterSoftConversations([base, ig], {
      bucket: 'tus_chats',
      channel: 'todos',
      accountId: 'all',
      search: 'maría',
    })
    assert.equal(search.length, 1)
  })
})
