/**
 * PR-2 Phase 2 — chat conversations API helpers (tenant isolation, cursor, filters).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildConversationListWhere,
  conversationListCursorScope,
  parseConversationListQuery,
} from '../chat-conversation-query'
import { parseConversationKey } from '../chat-conversation-api'
import { CHAT_INBOX_V2_FLAG } from '../feature-flags'

describe('chat-conversations-api', () => {
  it('list query parser accepts filters and rejects bad status', () => {
    const params = new URLSearchParams(
      'platform=whatsapp&status=nuevo&assigned=me&tag=VIP&q=ana&socialAccountId=sa1',
    )
    const parsed = parseConversationListQuery(params)
    assert.equal(parsed.platform, 'whatsapp')
    assert.equal(parsed.status, 'nuevo')
    assert.equal(parsed.assigned, 'me')
    assert.throws(() => parseConversationListQuery(new URLSearchParams('status=open')))
  })

  it('cursor scope is stable for identical filter sets', () => {
    const input = parseConversationListQuery(new URLSearchParams('status=hecho&q=Test'))
    const a = conversationListCursorScope('tenant-a', input)
    const b = conversationListCursorScope('tenant-a', input)
    const c = conversationListCursorScope('tenant-b', input)
    assert.equal(a, b)
    assert.notEqual(a, c)
  })

  it('buildConversationListWhere scopes tenant and assigned=me', () => {
    const input = parseConversationListQuery(new URLSearchParams('assigned=me'))
    const where = buildConversationListWhere({
      tenantId: 't1',
      input,
      viewerUserId: 'user-1',
      platformAccountIds: null,
    })
    assert.deepEqual(where, {
      AND: [{ tenantId: 't1' }, { assignedUserId: 'user-1' }],
    })
  })

  it('conversationKey parses socialAccountId::peerId', () => {
    assert.deepEqual(parseConversationKey('sa1::50688880001'), {
      socialAccountId: 'sa1',
      peerId: '50688880001',
    })
    assert.equal(parseConversationKey('bad'), null)
  })

  it('routes authenticate with update_sales and return 404 cross-tenant', () => {
    const patchRoute = readFileSync(
      resolve('src/app/api/chat/conversations/[id]/route.ts'),
      'utf8',
    )
    assert.match(patchRoute, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(patchRoute, /status: 404/)
    const listRoute = readFileSync(resolve('src/app/api/chat/conversations/route.ts'), 'utf8')
    assert.match(listRoute, /tenantId: auth\.tenantId/)
  })

  it('chat_inbox_v2 is not preview-unlocked', () => {
    const src = readFileSync(resolve('src/lib/feature-flags.ts'), 'utf8')
    assert.match(src, /CHAT_INBOX_V2_FLAG = 'chat_inbox_v2'/)
    assert.match(src, /shouldUseChatInboxV2/)
    const previewBlock = src.slice(src.indexOf('PREVIEW_UNLOCKED_KEYS'), src.indexOf('function isMissingFeatureFlagTable'))
    assert.doesNotMatch(previewBlock, /chat_inbox_v2/)
    assert.equal(CHAT_INBOX_V2_FLAG, 'chat_inbox_v2')
  })
})
