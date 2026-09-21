/**
 * PR-3 — multi-channel send still posts the thread's socialAccountId (routing invariant).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

describe('chat-channel-routing', () => {
  it('SoftCopilotInboxV2 send body includes selected conversation socialAccountId', () => {
    const src = readFileSync(resolve('src/components/chats/SoftCopilotInboxV2.tsx'), 'utf8')
    assert.match(src, /socialAccountId/)
    assert.match(src, /\/api\/chat\/send/)
    // Overlay account identity from /api/chat/accounts poll
    assert.match(src, /accountDisplayLabel\(account\)/)
    assert.match(src, /accountChannelAddress\(account\)/)
  })

  it('send route uses account.accountId as Graph phone_number_id / page target', () => {
    const src = readFileSync(resolve('src/app/api/chat/send/route.ts'), 'utf8')
    assert.match(src, /socialAccountId/)
    assert.match(src, /accountId/)
    // Must not pull staff-bot WHATSAPP_* tokens
    assert.doesNotMatch(src, /WHATSAPP_ACCESS_TOKEN/)
  })

  it('WA exchange persists identity columns', () => {
    const src = readFileSync(resolve('src/app/api/auth/whatsapp/exchange/route.ts'), 'utf8')
    assert.match(src, /identityPersistPayload/)
    assert.match(src, /providerDisplayName/)
    assert.match(src, /displayPhoneNumber/)
    assert.match(src, /wabaId/)
  })

  it('IG complete/callback use shared upsert with username', () => {
    const complete = readFileSync(resolve('src/app/api/auth/instagram/complete/route.ts'), 'utf8')
    const callback = readFileSync(resolve('src/app/api/auth/instagram/callback/route.ts'), 'utf8')
    assert.match(complete, /upsertInstagramSocialAccount/)
    assert.match(complete, /igUsername/)
    assert.match(callback, /upsertInstagramSocialAccount/)
    assert.match(callback, /igUsername/)
  })
})
