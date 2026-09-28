import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  filterLineAccounts,
  lineHealth,
  lineIsDown,
  summarizeLineCounts,
} from '../chat-line-filter'
import { filterSoftConversations } from '../chat-soft-copilot'
import type { SoftConversation, SoftSocialAccount } from '../chat-soft-copilot'

function acct(over: Partial<SoftSocialAccount> & { id: string }): SoftSocialAccount {
  return { platform: 'whatsapp', accountId: over.id, isActive: true, tokenStatus: 'valid', ...over }
}

function conv(over: Partial<SoftConversation> & { socialAccountId: string }): SoftConversation {
  return {
    recipientId: 'r1',
    recipientName: 'Cliente',
    platform: 'whatsapp',
    accountLabel: 'Línea',
    lastMessage: 'hola',
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
    messages: [],
    status: 'en_curso',
    tags: [],
    ...over,
  } as unknown as SoftConversation
}

describe('chat line filter', () => {
  it('classifies down lines (inactive / disconnected / dead token)', () => {
    assert.equal(lineIsDown(acct({ id: 'a' })), false)
    assert.equal(lineIsDown(acct({ id: 'b', isActive: false })), true)
    assert.equal(lineIsDown(acct({ id: 'c', disconnectedAt: '2026-01-01T00:00:00Z' })), true)
    assert.equal(lineIsDown(acct({ id: 'd', tokenStatus: 'expired' })), true)
    assert.equal(lineHealth(acct({ id: 'b', isActive: false })).action, 'repair')
  })

  it('counts open + unread per concrete SocialAccount', () => {
    const { total, byAccount } = summarizeLineCounts([
      conv({ socialAccountId: 'a', unreadCount: 2 }),
      conv({ socialAccountId: 'a', status: 'hecho', unreadCount: 0 }),
      conv({ socialAccountId: 'b', unreadCount: 1 }),
    ])
    assert.deepEqual(byAccount.get('a'), { open: 1, unread: 2 })
    assert.deepEqual(byAccount.get('b'), { open: 1, unread: 1 })
    assert.deepEqual(total, { open: 2, unread: 3 })
  })

  it('searches lines by name / number', () => {
    const list = [
      acct({ id: 'a', displayName: 'PatchHouse CR', displayPhoneNumber: '+50660000001' }),
      acct({ id: 'b', displayName: 'Bloom CR', displayPhoneNumber: '+50660000003' }),
    ]
    assert.deepEqual(filterLineAccounts(list, 'bloom').map((a) => a.id), ['b'])
    assert.deepEqual(filterLineAccounts(list, '0001').map((a) => a.id), ['a'])
    assert.equal(filterLineAccounts(list, '  ').length, 2)
  })

  it('conversation list filters by the selected SocialAccount id, not just platform', () => {
    const list = [
      conv({ socialAccountId: 'a', recipientId: '1' }),
      conv({ socialAccountId: 'b', recipientId: '2' }),
      conv({ socialAccountId: 'c', platform: 'instagram', recipientId: '3' }),
    ]
    const only = filterSoftConversations(list, {
      bucket: 'abiertos',
      channel: 'todos',
      accountId: 'b',
      search: '',
    })
    assert.deepEqual(only.map((c) => c.socialAccountId), ['b'])
  })

  it('Aurora /chats mounts V2 only and never a Legacy inbox', () => {
    const page = readFileSync(resolve('src/app/chats/page.tsx'), 'utf8')
    assert.doesNotMatch(page, /shouldUseChatInboxV2/)
    const wrapper = readFileSync(resolve('src/components/chats/SoftCopilotInbox.tsx'), 'utf8')
    assert.match(wrapper, /<SoftCopilotInboxV2 \/>/)
    assert.doesNotMatch(wrapper, /import .*SoftCopilotInboxLegacy/)
  })
})
