/** INFRA-12: workspace log retention. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACTIVITY_RETENTION_DAYS, NOTIFICATION_READ_DAYS, NOTIFICATION_UNREAD_DAYS, retentionCutoffs } from '../workspace-retention'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('cutoffs: activity 13 months, notifications 90 days read / 180 days unread', () => {
  const now = new Date('2026-09-29T00:00:00Z')
  const c = retentionCutoffs(now)
  const days = (d: Date) => Math.round((now.getTime() - d.getTime()) / 86_400_000)
  assert.equal(days(c.activity), ACTIVITY_RETENTION_DAYS)
  assert.ok(ACTIVITY_RETENTION_DAYS >= 365, 'keeps at least a full year for year-over-year stats')
  assert.equal(days(c.notificationRead), NOTIFICATION_READ_DAYS)
  assert.equal(days(c.notificationUnread), NOTIFICATION_UNREAD_DAYS)
})

test('only logs are purged, in bounded batches; business data untouched; cron gated', () => {
  const lib = read('src/lib/workspace-retention.ts')
  const deletes = [...lib.matchAll(/prisma\.(\w+)\.deleteMany/g)].map((m) => m[1])
  assert.deepEqual(deletes.sort(), ['activityEvent', 'workspaceNotification'])
  assert.doesNotMatch(lib, /crmNote|crmTask|crmStage|chatConversation|client\./)
  assert.match(lib, /take: size/)
  assert.match(lib, /Date\.now\(\) < deadline/)
  const route = read('src/app/api/cron/workspace-retention/route.ts')
  assert.match(route, /timingSafeEqualString\(/)
  assert.match(route, /cronsDisabled\(process\.env\)/)
  assert.match(read('src/cf-container-worker.ts'), /"30 3 \* \* \*": \["\/api\/cron\/chat-agent-retention", "\/api\/cron\/workspace-retention"\]/)
})
