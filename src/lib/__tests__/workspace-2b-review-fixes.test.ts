/** Phase 2b review round (Verifier + SecureDog, 2026-09-29): regressions for each fix. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateBusinessHours } from '../chat-assignment-rules'
import { canManageTask } from '../crm-tasks'
import { buildConversationListWhere, parseConversationListQuery } from '../chat-conversation-query'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('N3: hours on with every day closed is refused (it would mean "always open")', () => {
  assert.equal(validateBusinessHours({ mon: [], tue: [] }).ok, false)
  const ok = validateBusinessHours({ mon: [['08:00', '17:00']], tue: [] })
  assert.ok(ok.ok && Object.keys(ok.hours).join() === 'mon')
  assert.equal(validateBusinessHours({}).ok, true)
})

test('AUTH-39: tasks — complete for all; cancel / edit / reassign for creator, assignee, OWNER, ADMIN', () => {
  const task = { createdByUserId: 'creator', assigneeUserId: 'assignee' }
  assert.equal(canManageTask({ userId: 'creator', role: 'SALES' }, task), true)
  assert.equal(canManageTask({ userId: 'assignee', role: 'SALES' }, task), true)
  assert.equal(canManageTask({ userId: 'x', role: 'ADMIN' }, task), true)
  assert.equal(canManageTask({ userId: 'x', role: 'SALES' }, task), false)
  const lib = read('src/lib/crm-tasks.ts')
  assert.match(lib, /const needsManage = args\.status === 'canceled' \|\| args\.title !== undefined \|\| args\.dueAt !== undefined \|\| args\.assigneeUserId !== undefined/)
  assert.match(read('src/app/api/crm/tasks/[id]/route.ts'), /role: auth\.role,/)
})

test('M2 / S5: list can fetch one chat by id or the snoozed set — always inside the session tenant', () => {
  const q = parseConversationListQuery(new URLSearchParams('id=cmudui36a0001gt04md09vd55&snoozed=1'))
  assert.equal(q.id, 'cmudui36a0001gt04md09vd55')
  assert.equal(q.snoozed, true)
  assert.throws(() => parseConversationListQuery(new URLSearchParams('id=../../x')))
  const where = buildConversationListWhere({ tenantId: 't1', input: q, viewerUserId: 'u', restrictIds: ['a', 'b'] })
  assert.deepEqual(where, { AND: [{ tenantId: 't1' }, { id: 'cmudui36a0001gt04md09vd55' }, { id: { in: ['a', 'b'] } }] })
  const route = read('src/app/api/chat/conversations/route.ts')
  assert.match(route, /const restrictIds = input\.snoozed \? await listSnoozedConversationIds\(auth\.tenantId\) : null/)
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /const searchParams = useSearchParams\(\)/, 'reactive: works when already on /chats')
  assert.match(inbox, /pinRows\(new URLSearchParams\(\{ id: deepLinkId, limit: '1' \}\)\.toString\(\)\)/)
  assert.match(inbox, /if \(bucket === 'pospuestos' && snoozeAvailable\) void pinRows\('snoozed=1&limit=50'\)/)
  assert.match(inbox, /\[\.\.\.searchHitsRef\.current, \.\.\.pinnedDtosRef\.current\]/, 'pinned rows survive a first-page reload')
})

test('DATA-12 / DATA-13: chat deletion never fails on a task and takes chat-only notes / tasks with it', () => {
  const sql = read('supabase/migrations/036_crm_workspace_2b.sql').replace(/--[^\n]*/g, '')
  assert.doesNotMatch(sql, /CrmTask_target_check/)
  assert.match(sql, /"CrmTask_conversationId_fkey" FOREIGN KEY \("conversationId"\) REFERENCES public\."ChatConversation"\("id"\) ON DELETE SET NULL/)
  const purge = read('src/lib/workspace-purge.ts')
  assert.match(purge, /crmNote\.deleteMany\(\{ where: \{ conversationId: \{ in: ids \}, clientId: null \} \}\)/)
  assert.match(purge, /crmTask\.deleteMany\(\{ where: \{ conversationId: \{ in: ids \}, clientId: null \} \}\)/)
  const del = read('src/app/api/auth/instagram/data-deletion/route.ts')
  assert.ok(del.indexOf('purgeChatOnlyWorkspaceData(') < del.indexOf('socialAccount.deleteMany('), 'purge runs before the chats are deleted')
})

test('DATA-14 / INFRA-13 / presence split / reopen backlog guard', () => {
  assert.match(read('src/lib/workspace-notifications.ts'), /const userIds = await filterChatMembers\(input\.tenantId, wanted\)/)
  const sweep = read('src/lib/chat-workspace-sweep.ts')
  assert.match(sweep, /skipped: 'already_running' \}/)
  assert.match(sweep, /const offset = rows\.length \? Math\.floor\(now\.getTime\(\) \/ 60_000\) % rows\.length : 0/)
  assert.match(sweep, /wakeExpiredSnoozes\(now\)/)
  assert.match(read('src/lib/chat-presence.ts'), /^import 'server-only'/m)
  assert.doesNotMatch(read('src/components/chats/useChatPresence.ts'), /@\/lib\/chat-presence'/)
  assert.match(read('src/lib/chat-workspace-settings.ts'), /const reopenEnabledAt = input\.reopenOnInbound \?/)
  assert.match(read('supabase/migrations/036_crm_workspace_2b.sql'), /"reopenEnabledAt" timestamp\(3\) without time zone NULL/)
})

test('re-verify round: S-B fail-safe reopen, S-C metric not settled early, N-1 stale run guard, N-2 / N-4', () => {
  const sweep = read('src/lib/chat-workspace-sweep.ts')
  assert.match(sweep, /verb: \{ in: \['chat\.stage\.set', 'chat\.auto_close'\] \}/, 'missing closedAt falls back to the close event')
  assert.match(sweep, /if \(at && c\.lastInboundAt && c\.lastInboundAt\.getTime\(\) <= at\.getTime\(\)\) continue/)
  assert.match(sweep, /Date\.now\(\) - runningSince < RUN_STALE_MS/)
  assert.match(read('src/app/api/chat/conversations/[id]/route.ts'), /await markClosed\(auth\.tenantId, existing\.id, closedNow \? 'human' : null\)/)
  assert.match(read('src/app/api/chat/conversations/import-local-state/route.ts'), /await markClosed\(auth\.tenantId, existing\.id, 'human'\)/)
  const metrics = read('src/lib/chat-send-metrics.ts')
  assert.match(metrics, /if \(!firstInbound\) return\n/, 'agent-first chats are measured once the customer replies')
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /router\.replace\('\/chats', \{ scroll: false \}\)/)
  assert.match(inbox, /if \(rows === null\) \{\n\s*deepLinkFetched\.current = null/)
  assert.match(read('src/app/api/auth/instagram/data-deletion/route.ts'), /purgeChatOnlyWorkspaceData\(doomedChats\.map\(\(c\) => c\.id\)\)\.catch\(/)
})
