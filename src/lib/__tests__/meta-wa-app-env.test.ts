import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getMetaWhatsAppAppId,
  getMetaWhatsAppAppSecret,
  getPublicMetaWhatsAppAppId,
  generateAppSecretProof,
  metaEnvFingerprint,
} from '../meta-api'

describe('CRM WhatsApp Meta app env selection', () => {
  it('prefers META_WA_APP_ID / SECRET over META_APP_*', () => {
    assert.equal(
      getMetaWhatsAppAppId({ META_WA_APP_ID: '1038331905909624', META_APP_ID: '9999999999999999' }),
      '1038331905909624',
    )
    assert.equal(
      getMetaWhatsAppAppSecret({
        META_WA_APP_SECRET: 'wa-secret-value-16',
        META_APP_SECRET: 'shared-secret-16xx',
      }),
      'wa-secret-value-16',
    )
  })

  it('falls back to META_APP_* when WA-specific unset', () => {
    assert.equal(getMetaWhatsAppAppId({ META_APP_ID: '1038331905909624' }), '1038331905909624')
    assert.equal(getMetaWhatsAppAppSecret({ META_APP_SECRET: 'shared-secret-16xx' }), 'shared-secret-16xx')
    assert.equal(getMetaWhatsAppAppId({}), '')
  })

  it('public WA app id prefers NEXT_PUBLIC_META_WA_APP_ID', () => {
    assert.equal(
      getPublicMetaWhatsAppAppId({
        NEXT_PUBLIC_META_WA_APP_ID: '1038331905909624',
        NEXT_PUBLIC_META_APP_ID: '9999999999999999',
        META_APP_ID: '8888888888888888',
      }),
      '1038331905909624',
    )
    assert.equal(
      getPublicMetaWhatsAppAppId({
        NEXT_PUBLIC_META_APP_ID: '9999999999999999',
        META_APP_ID: '8888888888888888',
      }),
      '9999999999999999',
    )
  })

  it('whatsapp purpose appsecret_proof uses META_WA_APP_SECRET', () => {
    const token = 'user-token'
    const waProof = generateAppSecretProof(token, {
      purpose: 'whatsapp',
      appSecret: 'wa-only-secret-16',
    })
    const metaProof = generateAppSecretProof(token, {
      purpose: 'default',
      appSecret: 'meta-only-secret16',
    })
    assert.notEqual(waProof, '')
    assert.notEqual(metaProof, '')
    assert.notEqual(waProof, metaProof)
  })

  it('skips [SENSITIVE] META_WA_APP_ID and uses numeric META_APP_ID', () => {
    assert.equal(
      getMetaWhatsAppAppId({
        META_WA_APP_ID: '[SENSITIVE]',
        META_APP_ID: '1038331905909624',
      }),
      '1038331905909624',
    )
  })

  it('skips [SENSITIVE] secrets and reports unusable when only placeholders', () => {
    assert.equal(
      getMetaWhatsAppAppSecret({
        META_WA_APP_SECRET: '[SENSITIVE]',
        META_APP_SECRET: '[SENSITIVE]',
      }),
      '',
    )
    const fp = metaEnvFingerprint({
      META_WA_APP_ID: '[SENSITIVE]',
      META_WA_APP_SECRET: '[SENSITIVE]',
      META_APP_ID: '1038331905909624',
      META_APP_SECRET: '[SENSITIVE]',
      ENCRYPTION_KEY: '[SENSITIVE]',
      NEXT_PUBLIC_META_WA_APP_ID: '1038331905909624',
    })
    assert.equal(fp.waAppIdUsable, true)
    assert.equal(fp.waAppIdLast4, '9624')
    assert.equal(fp.waSecretUsable, false)
    assert.ok(fp.placeholderKeys.includes('META_APP_SECRET'))
    assert.ok(fp.placeholderKeys.includes('ENCRYPTION_KEY'))
    assert.equal(fp.encryptionKeyUsable, false)
  })
})
