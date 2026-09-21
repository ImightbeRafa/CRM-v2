/**
 * Fixture replay for Probar. Deterministic expects (classifier + safety) by default.
 * Tokens from optional turn runners count against the test cap, not the live cap.
 */

import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import type { BrandFacts, ReplyStyle } from '@/lib/soft-ai/brand-facts'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import {
  FORGE_WA_V2_FIXTURES,
  FORGE_WA_V2_FIXTURE_SET_HASH,
  type ReplayFixtureV2,
} from '@/lib/soft-ai/__fixtures__/forge-wa-v2'

export const REPLAY_FIXTURE_CAP = 60

export type ReplayRow = {
  id: string
  tag: string
  expectedHandoff: boolean
  actualHandoff: boolean
  paymentClass: string
  pass: boolean
  policyViolation: boolean
  text: string
}

export function replayFixtures(input: {
  fixtures?: ReplayFixtureV2[]
  brandFacts: BrandFacts
  replyStyle?: ReplyStyle | null
  shortcuts: RuntimeShortcut[]
  sharePaymentFacts?: boolean
  cap?: number
}): {
  fixtureSetHash: string
  passRate: number
  policyViolations: number
  rows: ReplayRow[]
  capped: boolean
  examined: number
} {
  const cap = input.cap ?? REPLAY_FIXTURE_CAP
  const all = input.fixtures ?? FORGE_WA_V2_FIXTURES
  const capped = all.length > cap
  const fixtures = all.slice(0, cap)
  const rows: ReplayRow[] = fixtures.map((fixture) => {
    const decision = decideInbound({
      inboundText: fixture.text,
      messageType: fixture.messageType || fixture.expect.messageType || 'text',
      brandFacts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
    })
    const expectedHandoff =
      fixture.expect.handoffWhenShared === false && input.sharePaymentFacts
        ? false
        : fixture.expect.handoff
    const actualHandoff = decision.escalate || decision.shortcutKey?.startsWith('sys_handoff') === true
    const classOk = decision.paymentClass === fixture.expect.paymentClass
    const handoffOk = actualHandoff === expectedHandoff
    const policyViolation = hasConfirmationWording(decision.text) && decision.handled && !decision.needsHuman
    return {
      id: fixture.id,
      tag: fixture.tag,
      expectedHandoff,
      actualHandoff,
      paymentClass: decision.paymentClass,
      pass: classOk && handoffOk && !policyViolation,
      policyViolation,
      text: decision.text,
    }
  })
  const passed = rows.filter((row) => row.pass).length
  return {
    fixtureSetHash: FORGE_WA_V2_FIXTURE_SET_HASH,
    passRate: rows.length === 0 ? 0 : passed / rows.length,
    policyViolations: rows.filter((row) => row.policyViolation).length,
    rows,
    capped,
    examined: rows.length,
  }
}
