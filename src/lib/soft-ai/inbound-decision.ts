/**
 * Deterministic inbound decision: classifier, safety router, verbatim shortcuts.
 * Runs before any model call.
 */

import {
  canSharePaymentFacts,
  paymentMethodsOf,
  type BrandFacts,
  type ReplyStyle,
} from '@/lib/soft-ai/brand-facts'
import { applyFinalOutputPolicy } from '@/lib/soft-ai/llm/output-validator'
import {
  classifyPaymentText,
  isCueFreePaymentChoiceText,
  isPlainPaymentLinkQuestion,
  paymentHandoffReason,
  pendingMethodMention,
  type PaymentClassification,
} from '@/lib/soft-ai/payment-classifier'
import {
  customerAskedPaymentDetails,
  paymentDetailsText,
  paymentMethodBlock,
  paymentMethodsQuestion,
  PAYMENT_METHOD_TOKENS,
} from '@/lib/soft-ai/payment-guard'
import { parsePaymentMethodChoice, paymentMethodPick, type ChosenPaymentMethod } from '@/lib/soft-ai/sales-state'
import { isOptOutText, mediaInboundPlan, routeInboundSafety } from '@/lib/soft-ai/llm/safety-router'
import { HANDOFF_REASON, type TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'
import {
  matchVerbatimShortcut,
  PAYMENT_INFO_BODY,
  renderShortcutTemplate,
  reservedShortcutBody,
  shortcutByKey,
  type RuntimeShortcut,
} from '@/lib/soft-ai/shortcuts'

export type DecisionStep = { step: string; outcome: string; reason?: string }

export { HANDOFF_REASON, type TurnHandoff }

export type InboundDecision = {
  handled: boolean
  text: string
  intent: string
  shortcutKey: string | null
  escalate: boolean
  needsHuman: boolean
  /** The reply text itself passed the output checks (it can be sent even when a person must also look). */
  textOk: boolean
  handoff: TurnHandoff | null
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
  handoff?: TurnHandoff | null
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
    textOk: !policy.needsHuman,
    // A reply that failed the checks is never sent as-is: a person reviews it (the customer gets the safe line).
    handoff: input.handoff ?? (policy.needsHuman ? { kind: 'review', reason: HANDOFF_REASON.review } : null),
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
  /** Keyword replies not sent as-is this turn (their image would not go out): the model answers instead. */
  skipVerbatimIds?: ReadonlySet<string>
  /** The sale already gave the payment details: a photo / file now is treated as the receipt (B6). */
  awaitingReceipt?: boolean
  /**
   * agents2-format: the store just asked "¿Cómo preferís pagar?" (sales-state awaitingPaymentMethodChoice): a short,
   * cue-free reply naming a method is the customer's choice, answered with that method's details only.
   */
  awaitingPaymentMethod?: boolean
}): InboundDecision {
  const paymentClass = classifyPaymentText(input.inboundText, {
    awaitingPaymentMethod: input.awaitingPaymentMethod === true && (!input.messageType || input.messageType === 'text'),
  })
  const steps: DecisionStep[] = [
    { step: 'payment_class', outcome: paymentClass },
  ]
  const safety = routeInboundSafety({
    inboundText: input.inboundText,
    messageType: input.messageType,
    paymentClass,
  })

  // B6: media never reaches the model. A receipt (payment details already given, or a payment cue in the caption)
  // is a TRUE hand-off; anything else is answered "¿Me contás por escrito…?" and the chat stays on IA (a person is
  // asked to look at photos / files / audios; a sticker needs nobody).
  // MEDIA-14: a photo / audio captioned "quiero hablar con una persona" or "STOP" is an opt-out first.
  const captionOptOut = isOptOutText(input.inboundText || '')
  const mediaPlan = captionOptOut
    ? null
    : mediaInboundPlan({
        messageType: input.messageType,
        caption: input.inboundText,
        awaitingReceipt: input.awaitingReceipt,
      })
  if (captionOptOut && input.messageType && input.messageType !== 'text') {
    steps.push({ step: 'safety', outcome: 'handoff', reason: 'opt_out' })
    const shortcut = seedShortcut('sys_handoff_optout', input.shortcuts)
    return finish({
      text: renderShortcutTemplate(shortcut.body, { facts: input.brandFacts }),
      intent: 'human_request',
      shortcutKey: 'sys_handoff_optout',
      escalate: true,
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: true,
      handoff: { kind: 'handoff', reason: HANDOFF_REASON.optOut },
    })
  }
  if (mediaPlan === 'ask_in_writing') {
    steps.push({ step: 'safety', outcome: 'media_ask', reason: 'media_inbound' })
    const shortcut = seedShortcut('sys_media_ask', input.shortcuts)
    return finish({
      text: renderShortcutTemplate(shortcut.body, { facts: input.brandFacts }),
      intent: 'other',
      shortcutKey: 'sys_media_ask',
      escalate: false,
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      handoff: input.messageType === 'sticker' ? null : { kind: 'review', reason: HANDOFF_REASON.review },
    })
  }
  if (mediaPlan === 'receipt') {
    steps.push({ step: 'safety', outcome: 'handoff', reason: 'media_inbound' })
    const shortcut = seedShortcut('sys_handoff_media', input.shortcuts)
    return finish({
      text: renderShortcutTemplate(shortcut.body, { facts: input.brandFacts }),
      intent: 'payment_proof',
      shortcutKey: 'sys_handoff_media',
      escalate: true,
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: true,
      handoff: { kind: 'handoff', reason: HANDOFF_REASON.payment },
    })
  }

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
      handoff: {
        kind: 'handoff',
        reason:
          safety.reason === 'opt_out'
            ? HANDOFF_REASON.optOut
            : safety.reason === 'media_inbound'
              ? HANDOFF_REASON.payment
              : paymentHandoffReason(input.inboundText),
      },
    })
  }

  // agents2-format: the customer picked a method — after the store's question ("SINPE"), or naming one while asking
  // for its details ("Quiero pagar por SINPE, ¿me pasás el número?"). A bare "SINPE" used to fail closed as a payment
  // message (→ "ya lo reviso"); with no proof / claim / confirm / refund cue at all it is a choice.
  // SecureDog INT-114: only a message matching the choice ALLOWLIST GRAMMAR (paymentChoiceGrammar) is a choice — the
  // same gate for every branch (code reply and contra entrega / efectivo → model). Anything else ("hecho por sinpe",
  // "sinpe ✅", "sinpe de 25 mil", "sinpe, ¿cuándo me llega?") keeps the classifier / safety path below (a person).
  // STRUCTURAL RULE (SecureDog INT-114 reopened): this runs only AFTER the safety hand-off above and never for a
  // message the classifier calls payment_proof_or_risk — no choice / mention route can override a hand-off.
  const textMessage =
    (!input.messageType || input.messageType === 'text') &&
    !isOptOutText(input.inboundText || '') &&
    paymentClass !== 'payment_proof_or_risk'
  const choice = textMessage
    ? paymentMethodPick(input.inboundText, input.awaitingPaymentMethod === true, offeredMethods(input.brandFacts))
    : null
  if (choice === 'contra_entrega' || choice === 'efectivo') {
    // Contra entrega / efectivo: the model checks the zone and the order details, then a person takes the order.
    steps.push({ step: 'payment_choice', outcome: 'model', reason: choice })
    return continueToModel(paymentClass, steps)
  }
  if (!choice && textMessage && input.awaitingPaymentMethod) {
    // N4 (narrowed): the method question is pending and the message is an exact choice + an explicit logistics phrase
    // ("Por sinpe y retiro en tienda"): the model answers with that method chosen.
    const mention = pendingMethodMention(input.inboundText)
    if (mention) {
      steps.push({ step: 'payment_choice', outcome: 'model', reason: mention })
      return continueToModel(paymentClass, steps)
    }
  }
  if (choice) {
    const reply = paymentChoiceReply(choice, input.awaitingPaymentMethod ? 'Perfecto 🙌' : 'Claro 🙌')
    if (!canSharePaymentFacts(input.brandFacts)) {
      steps.push({ step: 'payment_choice', outcome: 'handoff', reason: 'payment_info_not_shared' })
      const shortcut = seedShortcut('sys_payment_soon', input.shortcuts)
      return finish({
        text: renderShortcutTemplate(shortcut.body, { facts: input.brandFacts }),
        intent: 'payment_info',
        shortcutKey: 'sys_payment_soon',
        escalate: true,
        paymentClass,
        steps,
        facts: input.brandFacts,
        replyStyle: input.replyStyle,
        shortcuts: input.shortcuts,
        forceNeedsHuman: true,
        extraReasons: ['payment_info_not_shared'],
        handoff: { kind: 'review', reason: HANDOFF_REASON.paymentData },
      })
    }
    // A method the store does not offer (or without its data): the model answers.
    if (reply && paymentMethodBlock(input.brandFacts, choice)) {
      steps.push({ step: 'payment_choice', outcome: choice })
      return finish({
        text: reply,
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
    steps.push({ step: 'payment_choice', outcome: 'model', reason: choice })
    return continueToModel(paymentClass, steps)
  }


  if (paymentClass === 'payment_info_safe' && input.awaitingPaymentMethod && canSharePaymentFacts(input.brandFacts)) {
    // N4: never the method list again while the store's method question is pending — the model answers.
    steps.push({ step: 'payment_info', outcome: 'model', reason: 'method_question_pending' })
    return continueToModel(paymentClass, steps)
  }
  if (paymentClass === 'payment_info_safe') {
    if (canSharePaymentFacts(input.brandFacts)) {
      // agents2-format: one method named ("¿cuál es el número de SINPE?", "¿aceptan tarjeta?") → that method only.
      // luna-10 exam round 2: "¿Tienes link de pago? ¿Para la ansiedad cuál me recomendás?" also asks about products —
      // the model answers both (it fills [[PAGO_TARJETA]]); a plain link ask = the card block; "¿se puede pagar con
      // tarjeta?" (exactly one method named) = that method only. Never every account for a one-method question.
      const linkAsk = isPlainPaymentLinkQuestion(input.inboundText)
      if (linkAsk && /recom(?:end|iend)/iu.test(input.inboundText)) {
        steps.push({ step: 'payment_info', outcome: 'model', reason: 'link_plus_product_question' })
        return continueToModel(paymentClass, steps)
      }
      const named = linkAsk
        ? 'tarjeta'
        : isCueFreePaymentChoiceText(input.inboundText)
          ? parsePaymentMethodChoice(input.inboundText) ?? singleMethodNamed(input.inboundText)
          : singleMethodNamed(input.inboundText)
      const namedReply = named && named !== 'contra_entrega' && paymentMethodBlock(input.brandFacts, named) ? paymentChoiceReply(named, 'Claro 🙌') : null
      if (namedReply) {
        steps.push({ step: 'payment_info', outcome: 'share', reason: named! })
        return finish({
          text: namedReply,
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
      steps.push({ step: 'payment_info', outcome: 'share' })
      // "¿Cómo pago?": the method names and the question (sys_payment_info); the details go out once they pick one.
      // luna-10 exam round 2: a saved reply built on {{brand.payment.summary}} pasted every account and the raw method
      // keys ("contra_entrega") to "¿se puede con tarjeta?". That dump is never the method question: the default list
      // body is used instead, and the details go out only when the customer asked for them.
      const shortcut = seedShortcut('sys_payment_info', input.shortcuts)
      const dumpsDetails = /brand\.payment\.summary/.test(shortcut.body)
      const text = dumpsDetails
        ? customerAskedPaymentDetails(input.inboundText)
          ? paymentDetailsText(input.brandFacts) || renderShortcutTemplate(PAYMENT_INFO_BODY, { facts: input.brandFacts })
          : renderShortcutTemplate(PAYMENT_INFO_BODY, { facts: input.brandFacts }) || paymentMethodsQuestion(input.brandFacts)
        : renderShortcutTemplate(shortcut.body, { facts: input.brandFacts })
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
    // A how-to-pay QUESTION is not a payment claim: "Enseguida te paso cómo pagar 😊" (same line as the model path),
    // never "¡Gracias! … ya lo reviso" (Rafael 2026-10-09; Verifier 2026-10-15 F3).
    const shortcut = seedShortcut('sys_payment_soon', input.shortcuts)
    const text = renderShortcutTemplate(shortcut.body, { facts: input.brandFacts })
    return finish({
      text,
      intent: 'payment_info',
      shortcutKey: 'sys_payment_soon',
      escalate: true,
      paymentClass,
      steps,
      facts: input.brandFacts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: true,
      extraReasons: ['payment_info_not_shared'],
      // B7: nobody can share the payment data by chat: the team sends it, the chat stays on IA.
      handoff: { kind: 'review', reason: HANDOFF_REASON.paymentData },
    })
  }

  const verbatim = matchVerbatimShortcut(
    input.inboundText,
    input.skipVerbatimIds?.size ? input.shortcuts.filter((row) => !row.id || !input.skipVerbatimIds!.has(row.id)) : input.shortcuts,
  )
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
      handoff: verbatim.kind === 'handoff' ? { kind: 'handoff', reason: HANDOFF_REASON.ownerReply } : undefined,
    })
  }

  return continueToModel(paymentClass, steps)
}

/** Methods this store offers (configured + contra entrega from its shipping facts). */
function offeredMethods(facts: BrandFacts): string[] {
  return paymentMethodsOf(facts)
}

function continueToModel(paymentClass: PaymentClassification, steps: DecisionStep[]): InboundDecision {
  steps.push({ step: 'model', outcome: 'continue' })
  return {
    handled: false,
    text: '',
    intent: 'other',
    shortcutKey: null,
    escalate: false,
    needsHuman: false,
    textOk: false,
    handoff: null,
    reasons: [],
    paymentClass,
    highlightedAmounts: [],
    decisionTrace: { paymentClass, steps },
  }
}

/**
 * agents2-format: what code sends when the customer picks a method — that method's token (filled by payment-guard
 * with the configured details, vertical) and, in a second message, what to do next. Null for contra entrega (the
 * model confirms zone + order, then a person takes it).
 */
export function paymentChoiceReply(method: ChosenPaymentMethod, opener = 'Perfecto 🙌'): string | null {
  switch (method) {
    case 'sinpe':
    case 'transferencia':
      return `${opener}\n${PAYMENT_METHOD_TOKENS[method]}\n\nCuando lo hagás, mandame el comprobante por aquí y lo revisamos 😊`
    case 'tarjeta':
      return `${opener}\n${PAYMENT_METHOD_TOKENS.tarjeta}\n\nCualquier duda con el pago, me escribís por aquí 😊`
    default:
      return null
  }
}

const SINGLE_METHOD_WORDS: Array<[ChosenPaymentMethod, RegExp]> = [
  ['sinpe', /(?<![\p{L}])sinpe(?![\p{L}])/iu],
  ['transferencia', /(?<![\p{L}])(?:transfer\p{L}*|iban|cuenta\s+bancaria)(?![\p{L}])/iu],
  ['tarjeta', /(?<![\p{L}])tarjetas?(?![\p{L}])/iu],
  ['contra_entrega', /contra\s*entrega|al\s+recibir|efectivo/iu],
]
/** "¿Se puede pagar con tarjeta?" → 'tarjeta': exactly one method named in a payment-info question, else null. */
function singleMethodNamed(text: string): ChosenPaymentMethod | null {
  const hits = SINGLE_METHOD_WORDS.filter(([, re]) => re.test(text || '')).map(([m]) => m)
  return hits.length === 1 ? hits[0] : null
}
