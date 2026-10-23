import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { betsySignalsForChange } from '../chat-betsy-signals'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

describe('Betsy mark signals from the inbox (Lane I API, Lane A wiring)', () => {
  const quiet = { lastMessageAt: '2026-10-23T10:00:00Z', lastMessageDirection: 'outbound', pendingSuggestionText: null }

  it('a new customer message: listen, plus think when the agent will answer', () => {
    const next = { ...quiet, lastMessageAt: '2026-10-23T10:05:00Z', lastMessageDirection: 'inbound' }
    assert.deepEqual(betsySignalsForChange(quiet, next, true), ['listen', 'think'])
    assert.deepEqual(betsySignalsForChange(quiet, next, false), ['listen'])
  })

  it('the agent replied after the customer, or a suggestion arrived: done', () => {
    const waiting = { ...quiet, lastMessageDirection: 'inbound' }
    assert.deepEqual(betsySignalsForChange(waiting, { ...waiting, lastMessageAt: '2026-10-23T10:01:00Z', lastMessageDirection: 'outbound' }, true), ['done'])
    assert.deepEqual(betsySignalsForChange(waiting, { ...waiting, pendingSuggestionText: 'Hola!' }, true), ['done'])
  })

  it('nothing new (or first sight of the row): no signal', () => {
    assert.deepEqual(betsySignalsForChange(quiet, { ...quiet }, true), [])
    assert.deepEqual(betsySignalsForChange(undefined, { ...quiet, lastMessageDirection: 'inbound' }, true), [])
  })

  it('the inbox emits read (only when something was unread), replied, yes on Pago verificado, and the change signals', () => {
    const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
    assert.match(inbox, /import \{ emitBetsySignal \} from '@\/components\/brand\/betsy-signals'/)
    assert.match(inbox, /if \(res\.ok && hadUnread\) emitBetsySignal\('read'\)/)
    assert.match(inbox, /if \(!json\.alreadyAnswered\) emitBetsySignal\('replied'\)/)
    assert.match(inbox, /if \(tag === PAYMENT_REVIEW_TAG\) emitBetsySignal\('yes'\)/)
    assert.match(inbox, /betsySignalsForChange\(dtoMapRef\.current\.get\(openRow\.id\), openRow, aiHandles\)\) emitBetsySignal\(signal\)/)
    // Never a customer-facing send: the signals only touch window events.
    assert.doesNotMatch(read('src/lib/chat-betsy-signals.ts'), /fetch\(|\/api\//)
  })
})
