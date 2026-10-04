import assert from 'node:assert/strict'
import test from 'node:test'
import crypto from 'node:crypto'
import { parseMetaSignedRequest, readSignedRequestFromBody } from '../meta-signed-request'

function sign(payload: object, secret: string): string {
  const segment = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(segment).digest('base64url')
  return `${sig}.${segment}`
}

const inbox = 'inbox-app-secret-0123456789'
const staff = 'staff-app-secret-0123456789'

test('accepts a signed_request from the Inbox app even when the Staff secret is tried first', () => {
  const sr = sign({ algorithm: 'HMAC-SHA256', user_id: '123456', issued_at: 1 }, inbox)
  assert.equal(parseMetaSignedRequest(sr, [staff, inbox])?.user_id, '123456')
})

test('rejects bad signatures, wrong algorithm and malformed input without throwing', () => {
  const forged = sign({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'attacker-secret-000000000')
  assert.equal(parseMetaSignedRequest(forged, [inbox, staff]), null)
  assert.equal(parseMetaSignedRequest(sign({ algorithm: 'none', user_id: '1' }, inbox), [inbox]), null)
  assert.equal(parseMetaSignedRequest('x.y', [inbox]), null)
  assert.equal(parseMetaSignedRequest('nodot', [inbox]), null)
  assert.equal(parseMetaSignedRequest('', [inbox]), null)
})

test('reads signed_request from form-encoded (Meta default) and JSON bodies', () => {
  assert.equal(readSignedRequestFromBody('signed_request=a.b', 'application/x-www-form-urlencoded'), 'a.b')
  assert.equal(readSignedRequestFromBody('{"signed_request":"a.b"}', 'application/json'), 'a.b')
  assert.equal(readSignedRequestFromBody('{bad', 'application/json'), null)
  assert.equal(readSignedRequestFromBody('', null), null)
})
