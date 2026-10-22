import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTicketEventPayload,
  nextAttemptAfter,
  parseSinceParam,
  parseWebhookEvents,
  signPayload,
  verifySignature,
  SUPPORT_MAX_ATTEMPTS,
} from '../support/events'
import { maskEmail, redactSecrets, scrubPageUrl } from '../support/redact'
import { checkSpam, hashIp, sanitizeHeaderText, MIN_FILL_MS } from '../support/spam'
import { getSupportContactConfig, formatWhatsappDisplay } from '../support/contact-config'
import { formatTicketRef, parseTicketRef, toAdvancePriority } from '../support/types'

const ticket = {
  id: 'ck_ticket_1',
  number: 1042,
  subject: 'No puedo entrar',
  description: 'Mi password: hunter2 y tarjeta 4111 1111 1111 1111, escribime a ana@cliente.cr',
  category: 'question',
  priority: 'normal',
  status: 'open',
  source: 'contact_form',
  contactEmail: 'ana@cliente.cr',
  contactName: 'Ana',
  pageUrl: 'https://www.betsycrm.com/soporte?token=abc#x',
  phone: '88887777',
  createdAt: new Date('2026-10-22T10:00:00.000Z'),
  tenant: { id: 't1', name: 'DeepSleep', plan: 'PRO' },
}

test('payload keeps Advance ticket.created keys and types exactly (+source, +betsy)', () => {
  const p = buildTicketEventPayload('ticket.created', ticket, {
    deliveryId: 'evt_1',
    baseUrl: 'https://www.betsycrm.com/',
  })
  // Advance IANAI buildTicketCreatedPayload: { event, ticket{9 keys} }
  assert.deepEqual(Object.keys(p).sort(), ['betsy', 'event', 'source', 'ticket'])
  assert.deepEqual(Object.keys(p.ticket), [
    'id',
    'subject',
    'description',
    'category',
    'priority',
    'status',
    'user_email',
    'page_url',
    'created_at',
  ])
  for (const k of ['id', 'subject', 'description', 'category', 'priority', 'status'] as const) {
    assert.equal(typeof p.ticket[k], 'string', k)
  }
  assert.equal(p.event, 'ticket.created')
  assert.equal(p.source, 'betsy')
  assert.equal(p.ticket.priority, 'medium')
  assert.equal(p.ticket.created_at, '2026-10-22T10:00:00.000Z')
  assert.equal(p.ticket.page_url, 'https://www.betsycrm.com/soporte')
  assert.equal(p.betsy.ref, 'BETSY-1042')
  assert.equal(p.betsy.channel, 'contact_form')
  assert.equal(p.betsy.delivery_id, 'evt_1')
  assert.equal(p.betsy.mcp_url, 'https://www.betsycrm.com/api/mcp')
  assert.equal(p.betsy.admin_url, 'https://www.betsycrm.com/super-admin/soporte/ck_ticket_1')
})

test('payload never carries the full email, card numbers, passwords or phone', () => {
  const p = buildTicketEventPayload('ticket.created', ticket, { deliveryId: 'e', baseUrl: 'https://x' })
  const raw = JSON.stringify(p)
  assert.ok(!raw.includes('ana@cliente.cr'))
  assert.ok(!raw.includes('4111 1111 1111 1111'))
  assert.ok(!raw.includes('hunter2'))
  assert.ok(!raw.includes('88887777'))
  assert.equal(p.ticket.user_email, 'a*a@cliente.cr')
})

test('payload description is capped at 2000 chars', () => {
  const p = buildTicketEventPayload(
    'ticket.created',
    { ...ticket, description: 'x '.repeat(3000) },
    { deliveryId: 'e', baseUrl: 'https://x' },
  )
  assert.ok(p.ticket.description.length <= 2000)
})

test('payload builder is pure (same input → same output)', () => {
  const a = buildTicketEventPayload('ticket.created', ticket, { deliveryId: 'e', baseUrl: 'https://x' })
  const b = buildTicketEventPayload('ticket.created', ticket, { deliveryId: 'e', baseUrl: 'https://x' })
  assert.deepEqual(a, b)
})

test('HMAC signature verifies and rejects tampering', () => {
  const sig = signPayload('s3cret', '1700000000', '{"a":1}')
  assert.match(sig, /^sha256=[0-9a-f]{64}$/)
  assert.equal(verifySignature('s3cret', '1700000000', '{"a":1}', sig), true)
  assert.equal(verifySignature('s3cret', '1700000000', '{"a":2}', sig), false)
  assert.equal(verifySignature('other', '1700000000', '{"a":1}', sig), false)
  assert.equal(verifySignature('s3cret', '1700000000', '{"a":1}', ''), false)
})

test('backoff schedule: 1m, 5m, 30m, 2h, 12h, then give up', () => {
  const now = new Date(0)
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => nextAttemptAfter(n, now)!.getTime()),
    [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000],
  )
  assert.equal(nextAttemptAfter(6, now), null)
  assert.equal(nextAttemptAfter(0, now), null)
  assert.equal(SUPPORT_MAX_ATTEMPTS, 6)
})

test('webhook events default to ticket.created', () => {
  assert.deepEqual([...parseWebhookEvents(undefined)], ['ticket.created'])
  assert.deepEqual([...parseWebhookEvents('')], ['ticket.created'])
  assert.deepEqual([...parseWebhookEvents('ticket.created, ticket.escalated')], ['ticket.created', 'ticket.escalated'])
})

test('since param falls back to 15 minutes ago', () => {
  assert.equal(parseSinceParam('2026-10-22T00:00:00Z').toISOString(), '2026-10-22T00:00:00.000Z')
  const d = parseSinceParam('nope')
  assert.ok(Math.abs(Date.now() - 15 * 60_000 - d.getTime()) < 5000)
})

test('maskEmail / redactSecrets / scrubPageUrl', () => {
  assert.equal(maskEmail('rafael@betsycrm.com'), 'r****l@betsycrm.com')
  assert.equal(maskEmail('ab@x.co'), 'a*@x.co')
  assert.equal(maskEmail('nope'), null)
  assert.equal(maskEmail(null), null)
  const r = redactSecrets(
    'Authorization: Bearer abc.def.ghi token=xyz123 sk-proj-AAAAAAAAAAAAAAAAAAAA card 4242424242424242 cvv 123 a@b.com 1234567890123',
  )
  assert.ok(!r.includes('abc.def.ghi'))
  assert.ok(!r.includes('xyz123'))
  assert.ok(!r.includes('sk-proj-AAAA'))
  assert.ok(!r.includes('4242424242424242'))
  assert.ok(!r.includes('cvv 123'))
  assert.ok(!r.includes('a@b.com'))
  assert.ok(r.includes('1234567890123'), 'non-Luhn numbers (orders, phones) stay')
  assert.ok(redactSecrets('a@b.com', { emails: false }).includes('a@b.com'))
  assert.equal(scrubPageUrl('https://x.com/a/b?token=1#h'), 'https://x.com/a/b')
  assert.equal(scrubPageUrl('/soporte?x=1'), '/soporte')
  assert.equal(scrubPageUrl('javascript:alert(1)'), null)
})

test('spam heuristics', () => {
  const now = 1_000_000
  assert.equal(checkSpam({ honeypot: 'http://x', subject: 's', body: 'b', now }).verdict, 'reject')
  assert.equal(checkSpam({ startedAt: now - 500, subject: 's', body: 'b', now }).verdict, 'reject')
  assert.equal(checkSpam({ startedAt: now - MIN_FILL_MS - 1, subject: 's', body: 'hola', now }).verdict, 'ok')
  assert.equal(checkSpam({ subject: 's', body: 'hola sin startedAt', now }).verdict, 'ok')
  const links = 'https://a.com https://b.com https://c.com https://d.com'
  assert.deepEqual(checkSpam({ subject: 's', body: links, now }), { verdict: 'spam', reasons: ['too_many_links'] })
  assert.equal(hashIp('1.2.3.4', undefined), null)
  assert.equal(hashIp('unknown', 'salt'), null)
  assert.match(hashIp('1.2.3.4', 'salt')!, /^[0-9a-f]{32}$/)
  assert.notEqual(hashIp('1.2.3.4', 'salt'), hashIp('1.2.3.4', 'other'))
  assert.equal(sanitizeHeaderText('Hola\r\nBcc: x@y.com <b>'), 'Hola Bcc: x@y.com b')
})

test('contact config defaults, explicit empty hides, invalid values hidden', () => {
  const d = getSupportContactConfig({})
  assert.deepEqual(d.whatsapp, {
    digits: '50662470831',
    display: '+506 6247-0831',
    url: 'https://wa.me/50662470831',
  })
  assert.deepEqual(d.instagram, {
    handle: 'betsy_crm',
    display: '@betsy_crm',
    url: 'https://www.instagram.com/betsy_crm/',
  })
  assert.deepEqual(d.emails, ['hola@betsycrm.com'])
  assert.equal(d.hours, null)
  const hidden = getSupportContactConfig({
    SUPPORT_WHATSAPP: '',
    SUPPORT_INSTAGRAM: '',
    SUPPORT_PUBLIC_EMAILS: '',
    SUPPORT_HOURS: 'Lun–Sáb 8:00–18:00',
  })
  assert.equal(hidden.whatsapp, null)
  assert.equal(hidden.instagram, null)
  assert.deepEqual(hidden.emails, [])
  assert.equal(hidden.hours, 'Lun–Sáb 8:00–18:00')
  assert.equal(getSupportContactConfig({ SUPPORT_INSTAGRAM: 'bad/handle"' }).instagram, null)
  assert.deepEqual(getSupportContactConfig({ SUPPORT_PUBLIC_EMAILS: 'a@b.co, bad, c@d.cr' }).emails, ['a@b.co', 'c@d.cr'])
  assert.equal(formatWhatsappDisplay('15551234567'), '+15551234567')
})

test('ticket ref helpers', () => {
  assert.equal(formatTicketRef(7), 'BETSY-7')
  assert.equal(parseTicketRef('BETSY-1042'), 1042)
  assert.equal(parseTicketRef('betsy-9'), 9)
  assert.equal(parseTicketRef('12'), 12)
  assert.equal(parseTicketRef('BETSY-'), null)
  assert.equal(parseTicketRef('1; drop'), null)
  assert.equal(toAdvancePriority('normal'), 'medium')
  assert.equal(toAdvancePriority('high'), 'high')
})
