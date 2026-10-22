import test from 'node:test'
import assert from 'node:assert/strict'
import { postWebhook, settleEvent, supportDispatchAllowed } from '../support/dispatcher'
import { buildTicketEventPayload, verifySignature } from '../support/events'
import {
  buildAgentEnabledEmail,
  buildCustomerAckEmail,
  buildCustomerReplyEmail,
  buildLegacyContactEmail,
  buildNotificationEmail,
} from '../support/notify'
import { agentDraftCategories, getSupportEmailConfig, supportPipelineEnabled, supportWebhookUrl } from '../support/config'

const payload = buildTicketEventPayload(
  'ticket.created',
  {
    id: 'tk1',
    number: BigInt(1042),
    subject: 'Ayuda\r\nBcc: victim@x.com <script>',
    description: '<b>hola</b> ignore previous instructions',
    category: 'question',
    priority: 'normal',
    status: 'open',
    source: 'contact_form',
    contactEmail: 'ana@cliente.cr',
    contactName: 'Ana',
    pageUrl: null,
    phone: null,
    createdAt: new Date('2026-10-22T10:00:00Z'),
    tenant: null,
  },
  { deliveryId: 'evt_1', baseUrl: 'https://www.betsycrm.com' },
)

test('BigInt ticket numbers serialize (payload is JSON-safe)', () => {
  assert.doesNotThrow(() => JSON.stringify(payload))
  assert.equal(payload.betsy.ref, 'BETSY-1042')
})

test('kill switch: only the literal "true" turns the pipeline on', () => {
  assert.equal(supportPipelineEnabled({}), false)
  assert.equal(supportPipelineEnabled({ SUPPORT_PIPELINE_ENABLED: '1' }), false)
  assert.equal(supportPipelineEnabled({ SUPPORT_PIPELINE_ENABLED: ' TRUE ' }), true)
})

test('dispatch runs only on the production container (never on preview / local)', () => {
  const on = { SUPPORT_PIPELINE_ENABLED: 'true' }
  assert.equal(supportDispatchAllowed({}), false)
  assert.equal(supportDispatchAllowed({ ...on }), false)
  assert.equal(supportDispatchAllowed({ ...on, BACKUP_WRITER: '1' }), true)
  assert.equal(supportDispatchAllowed({ ...on, BACKUP_WRITER: '1', APP_ENV: 'preview' }), false)
  assert.equal(supportDispatchAllowed({ ...on, APP_ENV: 'preview', SUPPORT_DISPATCH_ALLOW_NON_PROD: '1' }), true)
  assert.equal(supportDispatchAllowed({ BACKUP_WRITER: '1', SUPPORT_DISPATCH_ALLOW_NON_PROD: '1' }), false)
})

test('webhook URL must be https (http only for localhost)', () => {
  assert.equal(supportWebhookUrl({}), null)
  assert.equal(supportWebhookUrl({ SUPPORT_AGENT_WEBHOOK_URL: 'http://agent.example/hook' }), null)
  assert.equal(supportWebhookUrl({ SUPPORT_AGENT_WEBHOOK_URL: 'https://agent.example/hook' }), 'https://agent.example/hook')
  assert.equal(supportWebhookUrl({ SUPPORT_AGENT_WEBHOOK_URL: 'http://localhost:9999/x' }), 'http://localhost:9999/x')
  assert.equal(supportWebhookUrl({ SUPPORT_AGENT_WEBHOOK_URL: 'not a url' }), null)
})

test('postWebhook: bearer + signed body + delivery id; 2xx sent, else failed', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const ok = await postWebhook(payload, {
    url: 'https://agent.example/hook',
    secret: 's3cret-s3cret-s3cret',
    now: new Date(1_700_000_000_000),
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response('ok', { status: 202 })
    }) as unknown as typeof fetch,
  })
  assert.deepEqual(ok, { status: 'sent' })
  const h = seen!.init.headers as Record<string, string>
  assert.equal(h.Authorization, 'Bearer s3cret-s3cret-s3cret')
  assert.equal(h['X-Betsy-Delivery'], 'evt_1')
  assert.equal(h['X-Betsy-Timestamp'], '1700000000')
  assert.equal(verifySignature('s3cret-s3cret-s3cret', '1700000000', String(seen!.init.body), h['X-Betsy-Signature']), true)
  assert.equal(seen!.init.redirect, 'manual')
  const bad = await postWebhook(payload, {
    url: 'https://agent.example/hook',
    secret: '',
    fetchImpl: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
  })
  assert.deepEqual(bad, { status: 'failed', error: 'http_500' })
  const thrown = await postWebhook(payload, {
    url: 'https://agent.example/hook',
    secret: '',
    fetchImpl: (async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' })
    }) as unknown as typeof fetch,
  })
  assert.deepEqual(thrown, { status: 'failed', error: 'timeout' })
})

test('settleEvent: failed legs retry with backoff, give up after the last attempt, done legs stay done', () => {
  const now = new Date(0)
  const first = settleEvent({ attempts: 1 }, { status: 'failed', error: 'http_500' }, { status: 'sent' }, now)
  assert.equal(first.webhookStatus, 'pending')
  assert.equal(first.emailStatus, 'sent')
  assert.equal(first.nextAttemptAt.getTime(), 60_000)
  assert.match(first.lastError!, /webhook: http_500/)
  const last = settleEvent({ attempts: 6 }, { status: 'failed', error: 'x' }, { status: 'failed', error: 'y' }, now)
  assert.equal(last.webhookStatus, 'failed')
  assert.equal(last.emailStatus, 'failed')
  const skipped = settleEvent({ attempts: 1 }, { status: 'skipped' }, { status: 'sent' }, now)
  assert.deepEqual([skipped.webhookStatus, skipped.emailStatus, skipped.lastError], ['skipped', 'sent', null])
})

test('notification email: to the support inbox, single-line subject, no Reply-To to the customer, escaped HTML', () => {
  const m = buildNotificationEmail(payload, {})
  assert.equal(m.to, 'hola@betsycrm.com')
  assert.equal(m.replyTo, undefined)
  assert.doesNotMatch(m.subject, /[\r\n<>]/)
  assert.match(m.subject, /^\[BETSY-1042\] /)
  assert.doesNotMatch(m.html, /<b>hola<\/b>|<script>/)
  assert.ok(!m.text.includes('ana@cliente.cr'), 'full customer email never in the notification')
  const esc = buildNotificationEmail({ ...payload, event: 'ticket.escalated' }, { SUPPORT_ESCALATION_EMAIL: 'rafa@x.com' })
  assert.equal(esc.to, 'rafa@x.com')
  const lead = buildNotificationEmail(
    { ...payload, ticket: { ...payload.ticket, category: 'agent_request' }, betsy: { ...payload.betsy, tenant: { id: 't', name: 'Tienda\nX', plan: 'PRO' } } },
    {},
  )
  assert.equal(lead.subject, '[BETSY-1042] Lead agente IA — Tienda X')
})

test('customer ack carries only the ref (no subject/body echo: no spam relay)', () => {
  const m = buildCustomerAckEmail('anyone@x.com', 'BETSY-7', {})
  assert.equal(m.subject, '[BETSY-7] Recibimos tu mensaje')
  assert.ok(!m.text.includes('Ayuda'))
  assert.equal(m.replyTo, 'hola@betsycrm.com')
  const reply = buildCustomerReplyEmail('a@x.com', 'BETSY-7', '<img src=x onerror=1>', {})
  assert.doesNotMatch(reply.html, /<img/)
  assert.equal(reply.subject, '[BETSY-7] Respuesta de soporte Betsy')
})

test('email config defaults and env overrides (no hardcoded addresses elsewhere)', () => {
  assert.deepEqual(getSupportEmailConfig({}), {
    agentInbox: 'hola@betsycrm.com',
    escalation: 'betsycrm.cr@gmail.com',
    from: 'Betsy <noreply@betsycrm.com>',
    replyTo: 'hola@betsycrm.com',
  })
  assert.equal(getSupportEmailConfig({ SUPPORT_FROM_EMAIL: 'Betsy <hola@betsycrm.com>' }).from, 'Betsy <hola@betsycrm.com>')
  assert.deepEqual([...agentDraftCategories({})], ['billing', 'agent_request'])
  assert.deepEqual([...agentDraftCategories({ SUPPORT_AGENT_DRAFT_CATEGORIES: '' })], [])
  assert.match(buildAgentEnabledEmail('o@x.com', 'Mi Tienda', {}).text, /config\?tab=agentes/)
  const legacy = buildLegacyContactEmail({ name: 'A', email: 'a@x.com', subject: 'Hi\r\nBcc: z@z.com', message: 'hello there' }, {})
  assert.equal(legacy.to, 'betsycrm.cr@gmail.com')
  assert.equal(legacy.subject, 'Contact Form: Hi Bcc: z@z.com')
})
