import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { filterSoftConversations } from '@/lib/chat-soft-copilot'

const conv = (id: string, status: string, assignee: string | null) =>
  ({
    recipientId: id, socialAccountId: 's', platform: 'whatsapp', accountLabel: 'L', status, tags: [], messages: [],
    lastMessageAt: '2026-09-28T00:00:00Z', unreadCount: 0,
    assignee: assignee ? { id: assignee, name: assignee, image: null } : null,
  }) as any
const base = { channel: 'all', accountId: 'all', search: '' } as const
const list = [conv('a', 'nuevo', null), conv('b', 'nuevo', 'ana'), conv('c', 'en_curso', 'me'), conv('d', 'hecho', 'me')]
const ids = (r: any[]) => r.map((c) => c.recipientId)

test('"Tus chats" = open chats owned by the viewer; "Sin asignar" = open chats with no owner', () => {
  assert.deepEqual(ids(filterSoftConversations(list, { ...base, bucket: 'tus_chats', viewerUserId: 'me' } as any)), ['c'])
  assert.deepEqual(ids(filterSoftConversations(list, { ...base, bucket: 'sin_asignar', viewerUserId: 'me' } as any)), ['a'])
})

test('without a known viewer the legacy status buckets are unchanged', () => {
  assert.deepEqual(ids(filterSoftConversations(list, { ...base, bucket: 'sin_asignar' } as any)), ['a', 'b'])
  assert.deepEqual(ids(filterSoftConversations(list, { ...base, bucket: 'tus_chats' } as any)), ['a', 'b', 'c'])
})

test('Upstash timeout uses the memory limiter (no fail-open for auth limits)', () => {
  assert.match(readFileSync('src/lib/rate-limit.ts', 'utf8'), /reason === 'timeout'\) \{\s*return memoryRateLimit/)
})

test('mobile owner row renders outside the desktop header branch', () => {
  const src = readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8')
  assert.match(src, /\{compact && assignment && !conversation\.isDemo \? \(\s*<div[\s\S]*?data-testid="soft-thread-mobile-owner"/)
})

test('feedback FAB follows AuroraShell mount/unmount (no hydration race)', () => {
  assert.match(readFileSync('src/components/aurora/AuroraShell.tsx', 'utf8'), /root\.dataset\.auroraShell = '1'/)
  assert.match(readFileSync('src/app/components/FeedbackWidget.tsx', 'utf8'), /addEventListener\('betsy:aurora-shell'/)
})

test('PATCH merge keeps linkedOrder and agent labels; first load fetches fresh accounts', () => {
  const src = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
  assert.match(src, /linkedOrder: incoming\.linkedOrder \?\? before\.linkedOrder/)
  assert.match(src, /await fetchAccounts\(\{ force: true \}\)\s*\n\s*await runLocalImportOnce/)
})
