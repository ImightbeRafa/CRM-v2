import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { staffDisplayName } from '@/lib/display-name'

test('DATA-P3: staff names never show an email', () => {
  assert.equal(staffDisplayName('Ana <ana@x.com>'), 'Ana')
  assert.equal(staffDisplayName('ana@x.com'), 'ana')
  assert.equal(staffDisplayName('', 'pedro@x.com'), 'pedro')
  assert.equal(staffDisplayName('  Ana Mora  '), 'Ana Mora')
  assert.equal(staffDisplayName(null, null), null)
})

test('INFRA-P2: worker strips cf-container-target-port but keeps other headers', () => {
  const src = readFileSync('src/cf-container-worker.ts', 'utf8')
  assert.match(src, /headers\.delete\("cf-container-target-port"\)/)
  assert.match(src, /new Request\(request, \{ headers \}\)/)
})

test('DATA-P1: chat send only links orders / clients of the same business', () => {
  const src = readFileSync('src/app/api/chat/send/route.ts', 'utf8')
  assert.match(src, /order\.findFirst\(\{ where: \{ id: orderId, tenantId \}/)
  assert.match(src, /client\.findFirst\(\{ where: \{ id: clientId, tenantId \}/)
})

test('AUTH-P5: assignment needs an inbox-capable member and is audited', () => {
  const route = readFileSync('src/app/api/chat/conversations/[id]/route.ts', 'utf8')
  assert.match(route, /isAssignableChatMember\(auth\.tenantId, body\.assignedUserId\)/)
  assert.match(route, /logAuditEvent\(\{[\s\S]*?entityType: 'ChatConversation'/)
  const helpers = readFileSync('src/lib/chat-conversation-route-helpers.ts', 'utf8')
  assert.match(helpers, /hasPermission\(membership\.role as Role, 'update_sales'\)/)
  assert.match(readFileSync('src/app/api/chat/assignees/route.ts', 'utf8'), /hasPermission\(m\.role as Role, 'update_sales'\)/)
})

test('DATA-P2: linked-order chips ignore archived orders', () => {
  assert.match(readFileSync('src/lib/chat-linked-orders.ts', 'utf8'), /order: \{ tenantId, deletedAt: null \}/)
})
