import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  IG_HUMAN_AGENT_NOT_APPROVED_MESSAGE,
  IG_HUMAN_AGENT_WINDOW_MS,
  IG_STANDARD_WINDOW_MS,
  IG_WINDOW_CLOSED_MESSAGE,
  igComposerHint,
  igHumanSendFields,
  igReplyWindow,
  instagramHumanAgentEnabled,
  mapInstagramSendError,
} from '../instagram-human-agent'
import { isDemoPeerId } from '../demo-chat'
import { lastInboundTime } from '../chat-soft-copilot'
import { buildWhatsAppEmbeddedSignupLoginOptions, WA_EMBEDDED_SIGNUP_VERSION } from '../whatsapp-embedded-signup'
import { buildDemoPlan, DEMO_NAME_PREFIX, DEMO_ORDER_PREFIX } from '../../../scripts/lib/meta-review-demo'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Code only (comments may name things the code must not use). */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const T0 = Date.parse('2026-10-22T12:00:00Z')

test('IG reply window: 24 h free reply, then HUMAN_AGENT up to 7 days only when enabled', () => {
  assert.equal(igReplyWindow(T0, T0 + IG_STANDARD_WINDOW_MS - 1, true).state, 'open')
  assert.equal(igReplyWindow(T0, T0 + IG_STANDARD_WINDOW_MS, true).state, 'human_agent', 'exactly 24 h: tag needed')
  assert.equal(igReplyWindow(T0, T0 + IG_HUMAN_AGENT_WINDOW_MS - 1, true).state, 'human_agent')
  assert.equal(igReplyWindow(T0, T0 + IG_HUMAN_AGENT_WINDOW_MS, true).state, 'closed', 'exactly 7 days: closed')
  assert.equal(igReplyWindow(T0, T0 + IG_STANDARD_WINDOW_MS, false).state, 'closed', 'flag off: no tag')
  assert.equal(igReplyWindow(null, T0, true).state, 'unknown')
  assert.equal(igReplyWindow(T0, T0, true).humanAgentUntil, new Date(T0 + IG_HUMAN_AGENT_WINDOW_MS).toISOString())
  assert.equal(igReplyWindow(T0, T0, false).humanAgentUntil, null)
  assert.deepEqual(igHumanSendFields('human_agent'), { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  for (const s of ['open', 'closed', 'unknown'] as const) assert.deepEqual(igHumanSendFields(s), { messaging_type: 'RESPONSE' })
  assert.equal(instagramHumanAgentEnabled({}), false, 'inert by default')
  assert.equal(instagramHumanAgentEnabled({ META_IG_HUMAN_AGENT: '1' }), true)
  assert.equal(instagramHumanAgentEnabled({ META_IG_HUMAN_AGENT: 'true' }), false)
})

test('composer hint names the deadline; nothing while the window is open', () => {
  assert.equal(igComposerHint(igReplyWindow(T0, T0 + 3_600_000, true)), null)
  const hint = igComposerHint(igReplyWindow(T0, T0 + 2 * IG_STANDARD_WINDOW_MS, true))!
  assert.match(hint.text, /^Ventana de 24 h cerrada · podés responder como agente humano hasta /)
  assert.equal(hint.tone, 'info')
  assert.equal(igComposerHint(igReplyWindow(T0, T0 + 2 * IG_STANDARD_WINDOW_MS, false))!.tone, 'warn')
  assert.equal(
    lastInboundTime([
      { direction: 'inbound', sentAt: '2026-10-22T10:00:00Z' },
      { direction: 'outbound', sentAt: '2026-10-22T11:00:00Z' },
    ] as never),
    Date.parse('2026-10-22T10:00:00Z'),
  )
})

test('Meta errors on Instagram sends become clean messages', () => {
  assert.equal(mapInstagramSendError({ error: { code: 10, error_subcode: 2018278, message: 'x' } }, false)?.message, IG_WINDOW_CLOSED_MESSAGE)
  assert.equal(mapInstagramSendError({ error: { code: 10, error_subcode: 2534022 } }, true)?.reason, 'window_closed')
  assert.equal(mapInstagramSendError({ error: { code: 10, message: 'Permission denied' } }, true)?.message, IG_HUMAN_AGENT_NOT_APPROVED_MESSAGE)
  assert.equal(mapInstagramSendError({ error: { code: 10, message: 'Permission denied' } }, false), null, 'without the tag: generic handling')
  assert.equal(mapInstagramSendError({ error: { code: 190 } }, true), null, 'token errors keep their own path')
  assert.equal(mapInstagramSendError(null, true), null)
})

test('send route: human only, decided server-side before the claim, demo chats never reach Meta', () => {
  const route = read('src/app/api/chat/send/route.ts')
  assert.ok(route.indexOf('isDemoPeerId(recipient)') < route.indexOf('claimChatSend(tenantId'), 'demo guard before the claim')
  assert.ok(route.indexOf('igReplyWindow(igChat?.lastInboundAt') < route.indexOf('claimChatSend(tenantId'), 'window before the claim')
  assert.match(route, /where: \{ tenantId, socialAccountId: account\.id, peerId: recipient \}/, 'tenant-scoped lookup')
  assert.match(route, /if \(humanAgentOn && igWindowState === 'closed'\) \{/)
  assert.match(route, /\.\.\.igSendFields,\n\s+recipient: \{ id: recipient \},/)
  assert.doesNotMatch(route, /messaging_type: 'RESPONSE'/, 'Instagram fields only from the helper')
  assert.ok(
    route.indexOf('isMetaInvalidTokenError(providerResponse)') < route.indexOf('mapInstagramSendError(providerResponse'),
    'a window / permission error is never treated as a revoked token',
  )
  assert.match(read('src/lib/chat-send-media-core.ts'), /if \(isDemoPeerId\(recipient\)\) \{/)
  // The tag is for people only: no AI / follow-up / automation path may use it.
  for (const f of [
    'src/lib/soft-ai/agent-turn.ts',
    'src/lib/soft-ai/follow-up.ts',
    'src/lib/soft-ai/inbound-hook.ts',
    'src/lib/instagram-media.ts',
    'src/lib/chat-send-media-core.ts',
  ]) {
    assert.doesNotMatch(code(f), /HUMAN_AGENT|MESSAGE_TAG|instagram-human-agent/, f)
  }
  assert.match(read('src/lib/chat-conversation-api.ts'), /igHumanAgentEnabled: platform === 'instagram' && instagramHumanAgentEnabled\(\)/)
  assert.match(read('src/components/chats/SoftThreadPane.tsx'), /data-testid="ig-window-hint"/)
  assert.match(read('src/components/chats/SoftThreadPane.tsx'), /solo texto/)
})

test('Embedded Signup v4: version from the configuration, no sessionInfoVersion, coexistence kept', () => {
  const opts = buildWhatsAppEmbeddedSignupLoginOptions('cfg-v4')
  assert.equal(WA_EMBEDDED_SIGNUP_VERSION, 4)
  assert.deepEqual(opts.extras, { setup: {}, featureType: 'whatsapp_business_app_onboarding' })
  assert.equal(opts.config_id, 'cfg-v4')
  assert.doesNotMatch(read('src/lib/whatsapp-embedded-signup.ts'), /NEXT_PUBLIC_WA_SESSION_INFO_VERSION/)
})

test('super-admin event log: admins only (404), no-store, allowlisted filters, no customer data', () => {
  const route = read('src/app/api/super-admin/meta-events/route.ts')
  assert.ok(route.indexOf('isSuperAdmin(auth.userId)') < route.indexOf('loadMetaEventLog('))
  assert.match(route, /status: 404, headers: NO_STORE/)
  assert.match(route, /logAuditEvent\(/)
  const lib = code('src/lib/meta-attribution/event-log.ts')
  assert.match(lib, /take: filters\.limit/)
  assert.doesNotMatch(lib, /peerName|peerId|content:|phone|customerName|ctwaClid: true/, 'ids, amounts and statuses only')
  assert.match(lib, /orderBy\.get\(`\$\{e\.tenantId\}:\$\{e\.orderId\}`\)/, 'joins never cross businesses')
  const page = read('src/app/super-admin/meta-eventos/page.tsx')
  assert.match(page, /if \(!\(await isSuperAdmin\(userId\)\)\) redirect\('\/dashboard'\)/)
  assert.match(read('src/app/super-admin/meta-eventos/MetaEventLog.tsx'), /fbtrace_id \(soporte Meta\)/)
})

test('event log filters only accept known values', async () => {
  const { parseEventLogFilters } = await import('../meta-attribution/event-log')
  const f = parseEventLogFilters(new URLSearchParams('status=sent&channel=instagram&tenantId=cmabc12345&limit=999'))
  assert.deepEqual(f, { tenantId: 'cmabc12345', status: 'sent', channel: 'instagram', limit: 200 })
  const bad = parseEventLogFilters(new URLSearchParams("status=x'or&channel=sms&tenantId=../x&limit=-1"))
  assert.deepEqual(bad, { tenantId: null, status: null, channel: null, limit: 200 })
})

test('demo plan: everything marked demo, never reportable to Meta, never sendable', () => {
  const plan = buildDemoPlan('cmtenant00000001', [
    { id: 'sa_wa', platform: 'whatsapp' },
    { id: 'sa_ig', platform: 'instagram' },
  ])
  assert.ok(plan.inventory.every((i) => i.name.startsWith(DEMO_NAME_PREFIX) && i.id.startsWith('demo_')))
  assert.ok(plan.clients.every((c) => c.name.startsWith(DEMO_NAME_PREFIX)))
  assert.ok(plan.orders.every((o) => o.orderId.startsWith(DEMO_ORDER_PREFIX)))
  assert.equal(plan.chats.length, 4)
  for (const c of plan.chats) {
    assert.ok(isDemoPeerId(c.peerId), 'send routes refuse it')
    assert.ok(!/^\d{5,30}$/.test(c.peerId), 'not an IGSID: the Instagram sweep skips it')
    assert.ok(c.peerName.startsWith(DEMO_NAME_PREFIX))
  }
  assert.deepEqual(buildDemoPlan('cmtenant00000001', [{ id: 'sa_wa', platform: 'whatsapp' }]).chats.map((c) => c.id), plan.chats.slice(0, 2).map((c) => c.id), 'deterministic ids')
  const script = code('scripts/meta-review-demo-seed.ts')
  assert.match(script, /ctwaClid: null,/, 'no click id: WhatsApp sweep skips demo chats')
  assert.match(script, /process\.env\.META_DEMO_CONFIRM_TENANT/)
  assert.match(script, /realOrders > MAX_REAL_ORDERS_FOR_DEMO/)
  assert.doesNotMatch(script, /socialAccount\.(create|upsert|update)/, 'never creates or changes a line')
  assert.doesNotMatch(script, /lm_|\$executeRawUnsafe|user\.create|tenant\.create/)
  assert.ok(script.indexOf("if (!doApply) {") < script.indexOf('await apply(tenant.id, plan)'), 'dry run by default')
})
