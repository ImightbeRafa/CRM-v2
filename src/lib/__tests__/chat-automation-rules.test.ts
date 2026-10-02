import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  IDLE_MAX_MINUTES,
  idleDedupeKey,
  isAwaitingReply,
  matchesKeyword,
  normalizeText,
  parseRuleInput,
} from '@/lib/chat-automation-rules'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const base = {
  name: 'Precio',
  triggerKind: 'keyword',
  triggerConfig: { keywords: ['precio', 'Cuánto sale'] },
  actionKind: 'tag',
  actionConfig: { tag: 'precio' },
}

describe('rule validation', () => {
  it('accepts a valid keyword/tag rule, starts disabled unless asked, and dedupes keywords', () => {
    const r = parseRuleInput({ ...base, triggerConfig: { keywords: ['precio', 'precio', ' x ', 'ab'] } })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.rule.enabled, false)
      assert.deepEqual(r.rule.triggerConfig.keywords, ['precio', 'ab'])
    }
  })
  it('only allows internal actions (no message action exists)', () => {
    for (const actionKind of ['send_message', 'send_template', 'reply', 'notify_customer']) {
      assert.equal(parseRuleInput({ ...base, actionKind }).ok, false, actionKind)
    }
  })
  it('validates each trigger and action config', () => {
    assert.equal(parseRuleInput({ ...base, triggerKind: 'idle', triggerConfig: { minutes: 4 } }).ok, false)
    assert.equal(parseRuleInput({ ...base, triggerKind: 'idle', triggerConfig: { minutes: IDLE_MAX_MINUTES + 1 } }).ok, false)
    assert.equal(parseRuleInput({ ...base, triggerKind: 'idle', triggerConfig: { minutes: 30 } }).ok, true)
    assert.equal(parseRuleInput({ ...base, triggerKind: 'keyword', triggerConfig: { keywords: [] } }).ok, false)
    assert.equal(parseRuleInput({ ...base, triggerKind: 'new_chat', triggerConfig: {} }).ok, true)
    assert.equal(parseRuleInput({ ...base, actionConfig: { tag: '' } }).ok, false)
    assert.equal(parseRuleInput({ ...base, actionConfig: { tag: 'x'.repeat(31) } }).ok, false)
    assert.equal(parseRuleInput({ ...base, actionKind: 'assign', actionConfig: {} }).ok, false)
    assert.equal(parseRuleInput({ ...base, actionKind: 'task', actionConfig: { title: 'Llamar', dueInMinutes: 60 } }).ok, true)
    assert.equal(parseRuleInput({ ...base, actionKind: 'task', actionConfig: { title: 'Llamar', dueInMinutes: -1 } }).ok, false)
    assert.equal(parseRuleInput({ ...base, name: '' }).ok, false)
    assert.equal(parseRuleInput(null).ok, false)
  })
  it('strips commas/newlines from tags so they cannot break the tag list', () => {
    const r = parseRuleInput({ ...base, actionConfig: { tag: 'a,b\nc' } })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.rule.actionConfig.tag, 'a b c')
  })
})

describe('matching', () => {
  it('ignores accents, case and extra spaces', () => {
    assert.equal(normalizeText('  ¿CUÁNTO   sale? '), '¿cuanto sale?')
    assert.equal(matchesKeyword('Hola, ¿cuánto SALE el kit?', ['Cuanto sale']), true)
    assert.equal(matchesKeyword('buenas tardes', ['precio']), false)
    assert.equal(matchesKeyword('', ['precio']), false)
    assert.equal(matchesKeyword('precio', ['p']), false) // one-letter needles never match
  })
  it('idle only counts a chat where the customer wrote last', () => {
    const t = (n: number) => new Date(n)
    assert.equal(isAwaitingReply({ lastInboundAt: t(10), lastOutboundAt: null }), true)
    assert.equal(isAwaitingReply({ lastInboundAt: t(10), lastOutboundAt: t(5) }), true)
    assert.equal(isAwaitingReply({ lastInboundAt: t(10), lastOutboundAt: t(20) }), false)
    assert.equal(isAwaitingReply({ lastInboundAt: null, lastOutboundAt: null }), false)
  })
  it('an idle rule fires once per customer message', () => {
    assert.equal(idleDedupeKey(new Date(1000)), 'idle:1000')
    assert.notEqual(idleDedupeKey(new Date(1000)), idleDedupeKey(new Date(2000)))
  })
})

describe('safety by construction (static)', () => {
  const server = read('src/lib/chat-automation-rules-server.ts')
  it('no action can message a customer and no trigger reacts to an action (no loops)', () => {
    assert.doesNotMatch(server, /sendMessage|deliverOnce|graph\.facebook|dualWriteChatMessage|\/api\/chat\/send/)
    const pure = read('src/lib/chat-automation-rules.ts')
    assert.match(pure, /TRIGGER_KINDS = \['new_chat', 'idle', 'keyword'\]/)
    assert.doesNotMatch(pure, /'tag_added'|'assigned'|'task_created'/)
  })
  it('every rule query and action is scoped by the rule tenant and fires once per event', () => {
    assert.match(server, /WHERE "id" = \$\{id\} AND "tenantId" = \$\{tenantId\}/)
    assert.match(server, /ON CONFLICT \("ruleId", "conversationId", "dedupeKey"\) DO NOTHING/)
    assert.match(server, /where: \{ id: c\.conversationId, tenantId \}/)
    assert.match(server, /assignedUserId: null/) // never takes a chat from someone
  })
  it('assign validates the member and caps/limits exist', () => {
    assert.match(server, /isAssignableChatMember\(tenantId, userId\)/)
    assert.match(read('src/lib/chat-automation-rules.ts'), /MAX_RULES_PER_TENANT = 20/)
    assert.match(read('src/lib/chat-automation-rules.ts'), /MAX_ACTIONS_PER_TENANT_PER_RUN = 100/)
  })
  it('routes: update_config to write, tenant from the session, audited', () => {
    for (const p of ['src/app/api/config/chat-automations/route.ts', 'src/app/api/config/chat-automations/[id]/route.ts']) {
      const src = read(p)
      assert.match(src, /'update_config'/)
      assert.match(src, /auth\.tenantId/)
      assert.match(src, /logAuditEvent/)
    }
    assert.match(read('src/app/api/config/chat-automations/route.ts'), /'view_config'/)
  })
  it('the cron runs the rules without letting them fail the workspace sweep', () => {
    const cron = read('src/app/api/cron/chat-workspace/route.ts')
    assert.match(cron, /runChatAutomationRules/)
    assert.match(cron, /\.catch\(/)
  })
})

describe('SQL 043', () => {
  const sql = read('supabase/migrations/043_chat_automation_rules.sql')
  it('is additive, FK-free, RLS-enabled, constrained and registered', () => {
    for (const t of ['ChatAutomationRule', 'ChatAutomationRuleRun']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\."${t}"`))
      assert.match(sql, new RegExp(`ALTER TABLE public\\."${t}" ENABLE ROW LEVEL SECURITY`))
    }
    assert.doesNotMatch(sql, /REFERENCES|DROP |TRUNCATE/i)
    assert.match(sql, /UNIQUE \("ruleId", "conversationId", "dedupeKey"\)/)
    assert.match(sql, /"actionKind" IN \('tag', 'assign', 'task'\)/)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'043': '043_chat_automation_rules\.sql'/)
  })
})

describe('evaluator review fixes (static)', () => {
  const server = read('src/lib/chat-automation-rules-server.ts')
  it('retention uses an int-typed make_interval', () => {
    assert.match(server, /make_interval\(days => \$\{RETENTION_DAYS\}::int\)/)
  })
  it('idle ignores every closed stage (+ legacy hecho) and snoozed chats like the sweep', () => {
    assert.match(server, /'hecho'/)
    assert.match(server, /chatConversationWorkState\.findMany/)
    assert.match(server, /snoozedUntil: \{ gt: now \}/)
  })
  it('a task keyword rule fires once per chat per day and checks the creator is still on the team', () => {
    assert.match(server, /kw-day:/)
    assert.match(server, /creator_inactive/)
  })
  it('keyword scan is bounded by createdAt so the tenant index is used', () => {
    assert.match(server, /createdAt: \{ gte: new Date\(now\.getTime\(\) - 2 \* KEYWORD_WINDOW_MS\) \}/)
  })
  it('a rules failure is reported as rules_failed, not as missing tables', () => {
    assert.match(read('src/app/api/cron/chat-workspace/route.ts'), /error: 'rules_failed'/)
  })
})
