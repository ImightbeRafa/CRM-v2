import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHumanSenderSnapshot,
  humanOutboundLabel,
  humanOutboundSender,
  mergeHumanSenderMetadata,
} from '../chat-human-attribution'

describe('chat-human-attribution', () => {
  it('builds snapshot preferring name then username then email', () => {
    assert.deepEqual(
      buildHumanSenderSnapshot({
        userId: 'u1',
        name: 'Rafa',
        username: 'rafa',
        email: 'r@x.com',
        image: 'https://lh3.googleusercontent.com/a/x',
      }),
      {
        senderUserId: 'u1',
        senderName: 'Rafa',
        senderImage: 'https://lh3.googleusercontent.com/a/x',
      },
    )
    assert.equal(
      buildHumanSenderSnapshot({ userId: 'u1', username: 'pedro', email: 'p@x.com' }).senderName,
      'pedro',
    )
    assert.equal(
      buildHumanSenderSnapshot({ userId: 'u1', email: 'p@x.com' }).senderName,
      'p@x.com',
    )
  })

  it('merges sender fields into metadata without dropping prior keys', () => {
    const merged = mergeHumanSenderMetadata(
      { to: '506', platform: 'whatsapp' },
      {
        senderUserId: 'u1',
        senderName: 'Ana',
        senderImage: null,
      },
    )
    assert.equal(merged.to, '506')
    assert.equal(merged.senderUserId, 'u1')
    assert.equal(merged.senderName, 'Ana')
    assert.equal(merged.senderImage, null)
  })

  it('labels human outbound from snapshot', () => {
    assert.equal(humanOutboundLabel({ senderName: 'Ana' }), 'Ana envió')
    assert.equal(humanOutboundLabel({ softAi: true }), null)
    assert.deepEqual(humanOutboundSender({ senderUserId: 'u1', senderName: 'Ana', senderImage: 'http://x' }), {
      userId: 'u1',
      name: 'Ana',
      image: 'http://x',
    })
  })
})
