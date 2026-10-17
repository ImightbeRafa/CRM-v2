/**
 * Burst = one reply — the one decision live (executeAgentLayerTurn) and Probar (runAgentTestTurnInner) both make for a
 * burst: the planned text's decision, then every other bubble on its own (a TRUE hand-off wins; a question that needs
 * the model is never dropped for a code reply; reviews owed by other bubbles are kept), plus the trace step that
 * records the plan, the owed review and any opt-out (the later waiting ack reads it). Pure: no DB, no clock.
 */

import { continueBurstToModel, decideInbound, type InboundDecision } from '@/lib/soft-ai/inbound-decision'
import { mediaAwaitingReceipt } from '@/lib/soft-ai/sales-state'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import type { TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'
import {
  burstOptOut,
  burstOtherTexts,
  burstReviewFor,
  burstTraceStep,
  resolveBurstDecision,
  type BurstInboundPlan,
  type BurstMessage,
} from '@/lib/soft-ai/inbound-burst'

type DecideInboundInput = Parameters<typeof decideInbound>[0]

export function decideBurstTurn(input: {
  burst: BurstInboundPlan
  burstEarlier: BurstMessage[]
  trigger: { content: string | null; messageType?: string | null }
  history: SoftAiHistoryMessage[]
  mediaSalesContext: Parameters<typeof mediaAwaitingReceipt>[2]
  /** The claim check's earlier customer texts (live / Probar: earlierCustomerTexts(history)). */
  earlierCustomerTexts: string[]
  decisionBase: Omit<DecideInboundInput, 'inboundText' | 'messageType' | 'awaitingReceipt' | 'earlierCustomerTexts'>
}): { decision: InboundDecision; burstReview: TurnHandoff | null; optOut: boolean } {
  const { burst, history } = input
  const others = burstOtherTexts(input.burstEarlier, burst, { content: input.trigger.content, messageType: input.trigger.messageType }).map(
    (other) => ({
      text: other.text,
      decision: decideInbound({ ...input.decisionBase, inboundText: other.text, messageType: other.messageType, awaitingReceipt: false, earlierCustomerTexts: [] }),
    }),
  )
  const main = decideInbound({
    ...input.decisionBase,
    inboundText: burst.inboundText,
    messageType: burst.messageType,
    awaitingReceipt: mediaAwaitingReceipt(burst.messageType, history, input.mediaSalesContext),
    earlierCustomerTexts: input.earlierCustomerTexts,
  })
  const { decision, carriedReview } = resolveBurstDecision(main, others, (d) => continueBurstToModel(d, 'other_bubble_needs_model'))
  // A review the burst still owes after the reply — kept apart from `handoff` (images + repeat guard stay).
  const burstReview = burstReviewFor({ decision, others, mediaReview: burst.mediaReview, carried: carriedReview })
  const optOut = burstOptOut({ content: input.trigger.content }, input.burstEarlier)
  if (burst.reason !== 'single' || burstReview || optOut || decision !== main) {
    decision.decisionTrace.steps.unshift(burstTraceStep(burst, burstReview, optOut))
  }
  return { decision, burstReview, optOut }
}
