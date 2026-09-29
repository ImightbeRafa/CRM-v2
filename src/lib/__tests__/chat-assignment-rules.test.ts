/** Phase 2b S7: assignment rules, business hours, auto-close + reopen. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isValidTimezone,
  isWithinBusinessHours,
  localDayAndTime,
  pickByWorkload,
  pickRoundRobin,
  validateBusinessHours,
  validateWorkspaceSettings,
} from '../chat-assignment-rules'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const TZ = 'America/Costa_Rica' // UTC-6, no DST

test('round-robin wraps in list order; workload picks the least busy (ties → list order)', () => {
  const people = ['ana', 'luis', 'sofi']
  assert.equal(pickRoundRobin(people, null), 'ana')
  assert.equal(pickRoundRobin(people, 'ana'), 'luis')
  assert.equal(pickRoundRobin(people, 'sofi'), 'ana')
  assert.equal(pickRoundRobin(people, 'gone'), 'ana', 'removed teammate: start over')
  assert.equal(pickRoundRobin([], null), null)
  assert.equal(pickByWorkload(people, new Map([['ana', 3], ['luis', 1], ['sofi', 1]])), 'luis')
  assert.equal(pickByWorkload(people, new Map()), 'ana')
})

test('business hours in Costa Rica time; empty = always open', () => {
  // Tuesday 2026-09-29 15:00Z = 09:00 in Costa Rica.
  const tue9 = new Date('2026-09-29T15:00:00Z')
  assert.deepEqual(localDayAndTime(tue9, TZ), { day: 'tue', time: '09:00' })
  const hours = { tue: [['08:00', '17:00']] as Array<[string, string]> }
  assert.equal(isWithinBusinessHours(hours, TZ, tue9), true)
  assert.equal(isWithinBusinessHours(hours, TZ, new Date('2026-09-30T00:00:00Z')), false, 'Tue 18:00 CR is after closing')
  assert.equal(isWithinBusinessHours(hours, TZ, new Date('2026-09-27T15:00:00Z')), false, 'Sunday has no hours')
  assert.equal(isWithinBusinessHours({}, TZ, tue9), true)
  assert.equal(isValidTimezone('America/Costa_Rica'), true)
  assert.equal(isValidTimezone('Mars/Base'), false)
})

test('hours validation', () => {
  assert.equal(validateBusinessHours({ mon: [['09:00', '18:00']] }).ok, true)
  assert.equal(validateBusinessHours({ funday: [['09:00', '18:00']] }).ok, false)
  assert.equal(validateBusinessHours({ mon: [['18:00', '09:00']] }).ok, false)
  assert.equal(validateBusinessHours({ mon: [['9:00', '18:00']] }).ok, false)
})

test('settings: off by default, people required when on, auto-close needs a closed stage and forces reopen', () => {
  const off = validateWorkspaceSettings({}, ['hecho'])
  assert.ok(off.ok && off.settings.assignmentMode === 'off' && off.settings.autoCloseDays === null && !off.settings.reopenOnInbound)
  assert.equal(validateWorkspaceSettings({ assignmentMode: 'round_robin', assigneeUserIds: [] }, ['hecho']).ok, false)
  const rr = validateWorkspaceSettings({ assignmentMode: 'round_robin', assigneeUserIds: ['user_ana_000001', 'user_ana_000001', 'bad id!'] }, ['hecho'])
  assert.ok(rr.ok && rr.settings.assigneeUserIds.length === 1 && rr.settings.skipAiActive === true)
  assert.equal(validateWorkspaceSettings({ autoCloseDays: 7, autoCloseStageKey: 'en_curso' }, ['hecho']).ok, false, 'must be a closed stage')
  const ac = validateWorkspaceSettings({ autoCloseDays: '7' }, ['hecho'])
  assert.ok(ac.ok && ac.settings.autoCloseDays === 7 && ac.settings.autoCloseStageKey === 'hecho' && ac.settings.reopenOnInbound === true)
  assert.equal(validateWorkspaceSettings({ autoCloseDays: 0 }, ['hecho']).ok, false)
  assert.equal(validateWorkspaceSettings({ assignmentMode: 'random' }, ['hecho']).ok, false)
})

test('sweep: conditional writes only, never the backlog, bounded, no-op before 036', () => {
  const src = read('src/lib/chat-workspace-sweep.ts')
  assert.match(src, /where: \{ id: chat\.id, tenantId, assignedUserId: null \},/, 'never takes a chat from someone')
  assert.match(src, /lastInboundAt: \{ gte: s\.assignmentEnabledAt \}/, 'only chats written after rules were enabled')
  assert.match(src, /if \(!isWithinBusinessHours\(s\.businessHours, s\.timezone, now\)\) return 0/)
  assert.match(src, /\.\.\.\(s\.skipAiActive \? NOT_AI_ACTIVE : \{\}\)/)
  assert.match(src, /where: \{ id: chat\.id, tenantId, status: chat\.status, lastMessageAt: \{ lt: cutoff \} \},/, 'auto-close only if unchanged')
  assert.match(src, /where: \{ id: c\.id, tenantId, status: c\.status \},/, 'reopen only if still closed')
  assert.match(src, /lastInboundAt: \{ gte: s\.reopenEnabledAt \}/, 'reopen never touches the backlog')
  assert.match(src, /return \{ \.\.\.summary, skipped: 'tables_missing' \}/)
  assert.match(src, /const ASSIGN_CAP = 50/)
  assert.match(src, /filterChatMembers\(tenantId, s\.assigneeUserIds\)/, 'inactive teammates stop receiving chats')
  // Exempt chats are excluded in the query itself (they can never starve the queue).
  assert.match(src, /\.\.\.\(exempt\.size \? \{ id: \{ notIn: \[\.\.\.exempt\] \} \} : \{\}\)/)
  assert.match(src, /\.\.\.\(snoozed\.size \? \{ id: \{ notIn: \[\.\.\.snoozed\] \} \} : \{\}\)/)
  // Snooze rule identical to the inbox (customer writing wakes it).
  assert.match(src, /isSnoozedNow\(r, inbound\.get\(r\.conversationId\) \?\? null, now\)/)
})

test('M1: "not handled by the AI" keeps chats whose aiMode is NULL (most chats)', async () => {
  const { NOT_AI_ACTIVE } = await import('../chat-workspace-sweep')
  assert.deepEqual(NOT_AI_ACTIVE, { OR: [{ aiMode: null }, { aiMode: { not: 'ai_active' } }] })
})

test('guard: the webhook / inbound path never imports the rules or the sweep', () => {
  for (const f of [
    'src/lib/chat-conversation-write.ts',
    'src/app/api/chat/webhook/route.ts',
    'src/app/api/cron/chat-automation/route.ts',
    'src/lib/soft-ai/automation-processor.ts',
  ]) {
    assert.doesNotMatch(read(f), /chat-assignment-rules|chat-workspace-sweep|chat-workspace-settings/, f)
  }
})

test('cron + settings API: authenticated, kill switch, admin-only writes, audited', () => {
  const cron = read('src/app/api/cron/chat-workspace/route.ts')
  // Constant-time secret comparison, like the other retention crons.
  assert.match(cron, /timingSafeEqualString\(request\.headers\.get\('authorization'\) \|\| '', `Bearer \$\{secret\}`\)/)
  assert.match(cron, /cronsDisabled\(process\.env\)/)
  assert.match(read('src/cf-container-worker.ts'), /"\/api\/cron\/chat-automation", "\/api\/cron\/chat-workspace"/)
  const api = read('src/app/api/config/chat-workspace/route.ts')
  assert.match(api, /authenticateAPIWithPermission\(request, 'view_config'\)/)
  assert.match(api, /authenticateAPIWithPermission\(request, 'update_config'\)/)
  assert.match(api, /logAuditEvent\(/)
  // Assignees re-filtered to chat members of this business on save.
  assert.match(read('src/lib/chat-workspace-settings.ts'), /const members = await filterChatMembers\(tenantId, input\.assigneeUserIds\)/)
})
