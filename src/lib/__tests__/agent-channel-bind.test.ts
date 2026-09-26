import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { channelIdentity, summarizeBind, type BindChannelLike } from '../agent-channel-bind'

function row(over: Partial<BindChannelLike>): BindChannelLike {
  return {
    id: 'sa1',
    platform: 'whatsapp',
    displayName: null,
    displayPhoneNumber: null,
    providerUsername: null,
    attendedByThisAgent: false,
    aiAllowed: false,
    ...over,
  }
}

describe('channelIdentity', () => {
  it('shows concrete phone under a custom WhatsApp name', () => {
    const id = channelIdentity(row({ displayName: 'Ventas', displayPhoneNumber: '+506 6000 0001' }))
    assert.equal(id.title, 'Ventas')
    assert.equal(id.detail, '+506 6000 0001')
    assert.equal(id.platformLabel, 'WhatsApp')
  })

  it('uses the phone as title when there is no custom name', () => {
    const id = channelIdentity(row({ displayPhoneNumber: '+506 6000 0001' }))
    assert.equal(id.title, '+506 6000 0001')
    assert.equal(id.detail, null)
  })

  it('formats Instagram as @username and ignores numeric ids', () => {
    const ig = channelIdentity(row({ platform: 'instagram', providerUsername: 'patchhouse.cr' }))
    assert.equal(ig.title, '@patchhouse.cr')
    assert.equal(ig.platformLabel, 'Instagram')
    const numeric = channelIdentity(row({ platform: 'instagram', providerUsername: '17841400' }))
    assert.equal(numeric.title, 'Instagram · canal')
  })

  it('never renders a fake "Principal" label', () => {
    assert.doesNotMatch(channelIdentity(row({})).title, /principal/i)
  })
})

describe('summarizeBind', () => {
  it('empty bind list attends nobody', () => {
    assert.equal(summarizeBind([]).attendsNobody, true)
    assert.equal(summarizeBind([row({ id: 'a' }), row({ id: 'b' })]).attendsNobody, true)
  })

  it('counts each SocialAccount independently', () => {
    const s = summarizeBind([
      row({ id: 'wa1', attendedByThisAgent: true, aiAllowed: true }),
      row({ id: 'wa2', attendedByThisAgent: false, aiAllowed: true }),
      row({ id: 'ig1', platform: 'instagram', attendedByThisAgent: true }),
    ])
    assert.equal(s.total, 3)
    assert.equal(s.attending, 2)
    assert.equal(s.aiAllowed, 1)
    assert.equal(s.attendsNobody, false)
  })
})
