import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mapConversationToListDto } from '@/lib/chat-conversation-api'

test('GET /api/chat/assignees: inbox permission, tenant-scoped, no email or role in the payload', () => {
  const src = readFileSync('src/app/api/chat/assignees/route.ts', 'utf8')
  assert.match(src, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  assert.match(src, /where: \{ tenantId: auth\.tenantId, isActive: true, user: \{ active: true \} \}/)
  assert.doesNotMatch(src, /email: true|role: true/)
  assert.match(readFileSync('src/lib/rbac.ts', 'utf8'), /'GET \/api\/chat\/assignees': 'update_sales'/)
})

test('conversation DTO owner: email-as-name trimmed, only https photos', () => {
  const base = {
    id: 'c1', tenantId: 't', socialAccountId: 's1', peerId: '5068', peerName: null, peerAvatarUrl: null,
    clientId: null, status: 'abierto', assignedUserId: 'u1', aiMode: null, tags: [], lastMessageId: null,
    lastMessageAt: new Date(), lastMessagePreview: null, lastMessageDirection: null, lastInboundAt: null,
    inboundCount: 0, readInboundCount: 0, revision: BigInt(1),
    socialAccount: { id: 's1', platform: 'whatsapp', accountId: 'x', displayName: 'L', accountName: null, username: null, displayPhoneNumber: null, isActive: true },
  }
  const dto = mapConversationToListDto({
    ...base,
    assignedUser: { id: 'u1', name: 'ana@betsy.cr', image: 'javascript:alert(1)' },
  } as never)
  assert.deepEqual(dto.assignedUser, { id: 'u1', name: 'ana', image: null })
  const ok = mapConversationToListDto({
    ...base,
    assignedUser: { id: 'u1', name: 'Ana Mora', image: 'https://lh3.googleusercontent.com/a/x' },
  } as never)
  assert.equal(ok.assignedUser?.image, 'https://lh3.googleusercontent.com/a/x')
})

test('thread header renders the owner picker and the inbox PATCHes assignedUserId', () => {
  assert.match(readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8'), /<ChatAssigneePicker/)
  assert.match(readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8'), /patchConversation\(\{ assignedUserId: userId \}\)/)
})
