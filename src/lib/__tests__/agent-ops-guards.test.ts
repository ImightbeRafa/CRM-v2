import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSlotQueue, SlotQueueFullError } from '@/lib/soft-ai/slot-queue'
import { phoneOwnershipMatch } from '@/lib/soft-ai/phone-ownership'

describe('analytics slot queue (INT-48)', () => {
  it('runs at most N at once, hands slots over FIFO, and refuses when the line is full', async () => {
    const q = createSlotQueue(2, 1)
    await q.acquire()
    await q.acquire()
    assert.deepEqual(q.stats(), { active: 2, waiting: 0 })
    let thirdRan = false
    const third = q.acquire().then(() => {
      thirdRan = true
    })
    await assert.rejects(q.acquire(), SlotQueueFullError)
    assert.equal(thirdRan, false)
    q.release() // hands the slot to the waiter
    await third
    assert.equal(thirdRan, true)
    assert.deepEqual(q.stats(), { active: 2, waiting: 0 })
    q.release()
    q.release()
    assert.deepEqual(q.stats(), { active: 0, waiting: 0 })
  })
})

describe('phone ownership for order/guía lookups (INT-51)', () => {
  it('matches on the last 8 digits, with or without country code', () => {
    assert.equal(phoneOwnershipMatch(['50688887777'], '8888-7777'), true)
    assert.equal(phoneOwnershipMatch(['88887777'], '+506 8888 7777'), true)
  })
  it('never matches short or placeholder phones, or a different number', () => {
    assert.equal(phoneOwnershipMatch(['50688887777'], '0'), false)
    assert.equal(phoneOwnershipMatch(['50688887777'], '7777'), false)
    assert.equal(phoneOwnershipMatch(['5'], '88887777'), false)
    assert.equal(phoneOwnershipMatch(['50688887777'], '88887770'), false)
  })
})
