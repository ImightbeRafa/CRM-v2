/** Phase 2b S6: tasks / reminders / follow-ups + "Mis tareas". 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeTaskTitle, parseDueAt, parseTaskKind, sortTasks, TASK_TITLE_MAX } from '../crm-tasks'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const NOW = new Date('2026-09-29T15:00:00Z')
const H = 60 * 60 * 1000

test('title / kind / due validation', () => {
  assert.equal(normalizeTaskTitle('  Llamar   al cliente '), 'Llamar al cliente')
  assert.equal(normalizeTaskTitle(''), null)
  assert.equal(normalizeTaskTitle('x'.repeat(TASK_TITLE_MAX + 1)), null)
  assert.equal(normalizeTaskTitle(5), null)
  assert.equal(parseTaskKind('follow_up'), 'follow_up')
  assert.equal(parseTaskKind('meeting'), null)
  assert.equal(parseDueAt(undefined, NOW), null)
  assert.equal(parseDueAt('', NOW), null)
  assert.ok(parseDueAt(new Date(NOW.getTime() + H).toISOString(), NOW) instanceof Date)
  assert.equal(parseDueAt('nunca', NOW), 'invalid')
  assert.equal(parseDueAt(new Date(NOW.getTime() + 3 * 365 * 24 * H).toISOString(), NOW), 'invalid')
})

test('open overdue first, then by due time, undated after, done last', () => {
  const t = (id: string, status: string, dueOffsetH: number | null, createdH = 0) => ({
    id,
    status,
    dueAt: dueOffsetH === null ? null : new Date(NOW.getTime() + dueOffsetH * H),
    createdAt: new Date(NOW.getTime() - createdH * H),
  })
  const sorted = sortTasks([t('done', 'done', -5), t('undated', 'open', null), t('later', 'open', 5), t('soon', 'open', 1), t('late', 'open', -2)], NOW)
  assert.deepEqual(sorted.map((x) => x.id), ['late', 'soon', 'later', 'undated', 'done'])
})

test('server: tenant-scoped, assignee must be a chat member, client from the chat, cancel not delete', () => {
  const lib = read('src/lib/crm-tasks.ts')
  assert.match(lib, /const ok = await filterChatMembers\(tenantId, \[raw\]\)/)
  assert.match(lib, /prisma\.chatConversation\.findFirst\(\{ where: \{ id: args\.conversationId, tenantId: args\.tenantId \}/)
  assert.match(lib, /prisma\.client\.findFirst\(\{ where: \{ id: args\.clientId, tenantId: args\.tenantId \}/)
  assert.match(lib, /updateMany\(\{ where: \{ id: existing\.id, tenantId: args\.tenantId, status: \{ not: 'canceled' \} \}, data \}\)/)
  assert.doesNotMatch(lib, /crmTask\.delete/)
  assert.match(lib, /kind: 'task_assigned'/)
  const route = read('src/app/api/crm/tasks/route.ts')
  assert.match(route, /conversationId: conversation\.id,\n\s*clientId: conversation\.clientId,/)
  assert.match(route, /assigneeUserId: auth\.userId, includeDone/)
  for (const f of ['src/app/api/crm/tasks/route.ts', 'src/app/api/crm/tasks/[id]/route.ts']) {
    const src = read(f)
    assert.match(src, /authenticateAPIWithPermission\(request, 'update_sales'\)/, f)
    assert.match(src, /workspaceWriteRateLimit\(/, f)
  }
})

test('"Mis tareas" page: gated like the inbox, in the nav and the app frame; bell counts overdue', () => {
  assert.match(read('src/app/tareas/page.tsx'), /requirePermission\('update_sales'\)/)
  assert.match(read('src/lib/rbac.ts'), /'\/tareas': 'update_sales'/)
  assert.match(read('src/components/aurora/aurora-frame-routes.ts'), /'\/tareas'/)
  assert.match(read('src/app/api/workspace/notifications/route.ts'), /countOverdueForUser\(auth\.tenantId, auth\.userId\)/)
  assert.match(read('src/components/aurora/shell/AuroraBell.tsx'), /href="\/tareas"/)
})
