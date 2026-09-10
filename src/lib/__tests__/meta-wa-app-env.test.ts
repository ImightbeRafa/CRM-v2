import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getMetaWhatsAppAppId,
  getMetaWhatsAppAppSecret,
  getPublicMetaWhatsAppAppId,
  generateAppSecretProof,
} from '../meta-api'

describe('CRM WhatsApp Meta app env selection', () => {
  it('prefers META_WA_APP_ID / SECRET over META_APP_*', () => {
    assert.equal(
      getMetaWhatsAppAppId({ META_WA_APP_ID: 'wa-app', META_APP_ID: 'shared-app' }),
      'wa-app',
    )
    assert.equal(
      getMetaWhatsAppAppSecret({
        META_WA_APP_SECRET: 'wa-secret',
        META_APP_SECRET: 'shared-secret',
      }),
      'wa-secret',
    )
  })

  it('falls back to META_APP_* when WA-specific unset', () => {
    assert.equal(getMetaWhatsAppAppId({ META_APP_ID: 'shared-app' }), 'shared-app')
    assert.equal(getMetaWhatsAppAppSecret({ META_APP_SECRET: 'shared-secret' }), 'shared-secret')
    assert.equal(getMetaWhatsAppAppId({}), '')
  })

  it('public WA app id prefers NEXT_PUBLIC_META_WA_APP_ID', () => {
    assert.equal(
      getPublicMetaWhatsAppAppId({
        NEXT_PUBLIC_META_WA_APP_ID: 'pub-wa',
        NEXT_PUBLIC_META_APP_ID: 'pub-shared',
        META_APP_ID: 'server-shared',
      }),
      'pub-wa',
    )
    assert.equal(
      getPublicMetaWhatsAppAppId({
        NEXT_PUBLIC_META_APP_ID: 'pub-shared',
        META_APP_ID: 'server-shared',
      }),
      'pub-shared',
    )
  })

  it('whatsapp purpose appsecret_proof uses META_WA_APP_SECRET', () => {
    const token = 'user-token'
    const waProof = generateAppSecretProof(token, {
      purpose: 'whatsapp',
      appSecret: 'wa-only-secret',
    })
    const metaProof = generateAppSecretProof(token, {
      purpose: 'default',
      appSecret: 'meta-only-secret',
    })
    assert.notEqual(waProof, '')
    assert.notEqual(metaProof, '')
    assert.notEqual(waProof, metaProof)
  })
})
