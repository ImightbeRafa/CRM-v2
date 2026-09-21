/**
 * Deterministic inbound decision: classifier, safety router, verbatim shortcuts.
 * Runs before any model call.
 */

import {
  canSharePaymentFacts,
  type BrandFacts,
  type ReplyStyle,
} from '@/lib/soft-ai/brand-facts'
import { applyFinalOutputPolicy } from '@/lib/soft-ai/llm/output-validator'
import { classifyPaymentText, type PaymentClassification } from '@/lib/soft-ai/payment-classifier'
import { routeInboundSafety } from '@/lib/soft-ai/llm/safety-router'
import {
  matchVerbatimShortcut,
  renderShortcutTemplate,
  reservedShortcutBody,
  shortcutByKey,
  type RuntimeShortcut,
} from '@/lib/soft-ai/shortcuts'

export type DecisionStep = { step: string; outcome: string; reason?: string }

export type InboundDecision = {
  handled: boolean
  text: string
  intent: string
  shortcutKey: string | null
  escalate: boolean
  needsHuman: boolean
  reasons: string[]
  paymentClass: PaymentClassification
  highlightedAmounts: number[]
  decisionTrace: {
    paymentClass: PaymentClassification
    steps: DecisionStep[]
    historyCount?: number
    wouldSend?: boolean
    blockedBy?: string[]
  }
}

function seedShortcut(key: string, shortcuts: RuntimeShortcut[]): RuntimeShortcut {
  const found = shortcutByKey(shortcuts, key)
  if (found) return found
  return {
    key,
    title: key,
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    body: reservedShortcutBody(key as 'sys_handoff_payment'),
    deliveryMode: 'verbatim',
    isActive: true,
    sortOrder: 0,
  }
}

function finish(input: {
  text: string
  intent: string
  shortcutKey: string | null
  escalate: boolean
  paymentClass: PaymentClassification
  steps: DecisionStep[]
  facts: BrandFacts
  replyStyle?: ReplyStyle | null
  shortcuts: RuntimeShortcut[]
  forceNeedsHuman?: boolean
  extraReasons?: string[]
}): InboundDecision {
  const policy = applyFinalOutputPolicy({
    text: input.text,
    intent: input.intent,
    citedToolNames: [],
    brandFacts: input.facts,
    replyStyle: input.replyStyle,
    shortcuts: input.shortcuts,
  })
  const reasons = [...new Set([...(input.extraReasons || []), ...policy.reasons])]
  const needsHuman = input.forceNeedsHuman || policy.needsHuman || input.escalate
  if (policy.needsHuman) {
    input.steps.push({ step: 'validator', outcome: 'needs_human', reason: policy.reasons.join(',') })
  } else {
    input.steps.push({ step: 'validator', outcome: 'passed' })
  }
  return {
    handled: true,
    text: policy.text,
    intent: policy.intent || input.intent,
    shortcutKey: input.shortcutKey,
    escalate: input.escalate,
    needsHuman,
    reasons,
    paymentClass: input.paymentClass,
    highlightedAmounts: policy.highlightedAmounts,
    decisionTrace: {
      paymentClass: input.paymentClass,
      steps: input.steps,
    },
  }
}

export function decideInbound(input: {
  inboundText: string
  messageType?: string | null
  brandFacts: BrandFacts
  replyStyle?: ReplyStyle | null
  shortcuts: RuntimeShortcut[]
}): InboundDecision {
  const paymentClass = classifyPaymentText(input.inboundText)
  const steps: DecisionStep[] = [
    { step: 'payment_class', outcome: paymentClass },
  ]
  const safety = routeInboundSafety({
    inboundText: input.inboundText,
    messageType: input.messageType,
    paymentClass,
  })

  if (safety.escalate) {
    steps.push({ step: 'safety', outcome: 'handoff', reason: safety.reason })
    const shortcut = seedShortcut(safety.shortcutKey, input.shortcuts)
    const text = renderShortcutTemplate(shortcut.body, { facts: input.brandFacts })
    return finish({
      text,
      intent: safety.reason === 'payment_or_sinpe' ? 'payment_proof' : safety.reason === 'opt_out' ? 'human_request' : 'other',
      shortcutKey: safety.shortcutKey,
      escalate: true,
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: true,
    })
  }

  if (paymentClass === 'payment_info_safe') {
    if (canSharePaymentFacts(input.brandFacts)) {
      steps.push({ step: 'payment_info', outcome: 'share' })
      const shortcut = seedShortcut('sys_payment_info', input.shortcuts)
      const text = renderShortcutTemplate(shortcut.body, { facts: input.brandFacts })
      return finish({
        text,
        intent: 'payment_info',
        shortcutKey: 'sys_payment_info',
        escalate: false,
        paymentClass,
        steps,
        facts: input.brandFacts,
        replyStyle: input.replyStyle,
        shortcuts: input.shortcuts,
      })
    }
    steps.push({ step: 'payment_info', outcome: 'handoff', reason: 'payment_info_not_shared' })
    const shortcut = seedShortcut('sys_handoff_payment', input.shortcuts)
    const text = renderShortcutTemplate(shortcut.body, { facts: input.brandFacts })
    return finish({
      text,
      intent: 'payment_info',
      shortcutKey: 'sys_handoff_payment',
      escalate: true,
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: true,
      extraReasons: ['payment_info_not_shared'],
    })
  }

  const verbatim = matchVerbatimShortcut(input.inboundText, input.shortcuts)
  if (verbatim) {
    steps.push({ step: 'verbatim_shortcut', outcome: verbatim.key })
    const text = renderShortcutTemplate(verbatim.body, { facts: input.brandFacts })
    const intent = verbatim.intents[0] || 'other'
    return finish({
      text,
      intent,
      shortcutKey: verbatim.key,
      escalate: verbatim.kind === 'handoff',
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: verbatim.kind === 'handoff',
    })
  }

  steps.push({ step: 'model', outcome: 'continue' })
  return {
    handled: false,
    text: '',
    intent: 'other',
    shortcutKey: null,
    escalate: false,
    needsHuman: false,
    reasons: [],
    paymentClass,
    highlightedAmounts: [],
    decisionTrace: { paymentClass, steps },
  }
}
