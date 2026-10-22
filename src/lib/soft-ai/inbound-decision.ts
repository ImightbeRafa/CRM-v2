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
  asksMoreThanPayment,
  isCardByChatOffer,
  classifyPaymentText,
  embeddedPaymentChoice,
  hasHardPaymentClaim,
  hasHardPaymentClaimLabelMasked,
  hasPaymentStatusHint,
  isBareOrderConfirmAsk,
  isCourtesyText,
  isCueFreePaymentChoiceText,
  isPlainPaymentLinkQuestion,
  isShortDoneBubble,
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
import { parsePaymentMethodChoice, paymentMethodPick, resolvePaymentChoice, type ChosenPaymentMethod } from '@/lib/soft-ai/sales-state'
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
  /** Lane C D1: the amounts the sales turn may say (bundle / catalog prices, shipping): a saved reply may say them too. */
  allowedAmounts?: number[]
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
    quoteAmounts: input.allowedAmounts,
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
  /**
   * SecureDog round 6: the customer's earlier messages since the store last wrote. A burst ("Ya les pagué la mitad" +
   * "¿Cómo pago el resto?") is answered by ONE job for the newest message; a claim in any of them is a payment hand-off.
   */
  earlierCustomerTexts?: string[]
  /**
   * luna-10 D2: the "¿ya pagó?" model check said claim (or failed) in enforce mode — the message is treated exactly like
   * a regex payment claim (same hand-off, same notification). Can only force toward a person.
   */
  forcePaymentRisk?: true
  /**
   * Sleeping exam C2: nothing about paying happened in this chat yet (sales-state noPaymentYet — no payment details
   * sent, no photo / file from the customer, no payment words or web order from them). A bare "Para confirmar el
   * pedido" / "¿me confirmás?" is then an ordinary sales message, not a payment claim. Undefined = old behaviour.
   */
  noPaymentYet?: boolean
  /**
   * Rafael 2026-10-18: sales-state orderDataChoice — nothing about PAYING happened in this chat yet AND the whole
   * unanswered burst is one order-data message with a method choice ("… Envío a domicilio. Pago por SINPE 🙌"). That
   * choice is then a choice, not a payment claim. Undefined / null = old behaviour.
   */
  orderDataChoice?: ChosenPaymentMethod | null
  /** SecureDog wave D final: the store already sent its payment details (sales-state paymentDetailsIn on its messages). */
  paymentDetailsSent?: boolean
  /** Lane C D1: sales-state salesAllowedAmounts of this agent (live + Probar), for verbatim saved replies with a ₡ total. */
  allowedAmounts?: number[]
}): InboundDecision {
  // SecureDog r1 INT-159: the relaxation needs a text message AND no bubble of the burst (this one included) hinting at
  // a payment's state ("¿Me confirmás?" + "¿Les llegó?" stays a payment hand-off).
  const isText = !input.messageType || input.messageType === 'text'
  const noPaymentYet =
    input.noPaymentYet === true &&
    isText &&
    // SecureDog r2: every bubble of the burst is courtesy only or the bare ask itself (an allowlist, not a word list).
    [input.inboundText, ...(input.earlierCustomerTexts || [])].every((t) => !hasPaymentStatusHint(t || '') && (isCourtesyText(t || '') || isBareOrderConfirmAsk(t || '')))
  // A text message only (also while the store's method question is pending: the close asks it with the data list).
  const orderDataChoice = input.orderDataChoice && isText && input.awaitingReceipt !== true ? input.orderDataChoice : null
  const nothingPaidYet = orderDataChoice !== null
  const latestClass = classifyPaymentText(input.inboundText, {
    awaitingPaymentMethod: input.awaitingPaymentMethod === true && isText,
    noPaymentYet,
    nothingPaidYet,
  })
  // Verifier round 10: only a real claim in an earlier bubble counts ("Sinpe" + "gracias" is an answer).
  // Verifier r2 (pay-choice-in-data F1) / SecureDog r3 INT-G: an earlier order-data bubble is forgiven only the store's
  // own list labels ("Nombre completo" ≠ "completo") — it must still pass every hard-claim check with those masked.
  // SecureDog wave D final (INT-206 statement form): after the store's payment details, a short done-bubble with no
  // question ("Listo", "Listo ✅", "Hecho", "Ya quedó", "Ahí va", "ya pagúe") is a payment message.
  // Every unanswered bubble counts ("Listo" then "Gracias").
  const doneAfterDetails =
    input.paymentDetailsSent === true &&
    isText &&
    [input.inboundText, ...(input.earlierCustomerTexts || [])].some((t) => isShortDoneBubble(t || ''))
  const burstClaim = doneAfterDetails || (input.earlierCustomerTexts || []).some(
    (t) => hasHardPaymentClaim(t, { noPaymentYet }) && !(embeddedPaymentChoice(t) && !hasHardPaymentClaimLabelMasked(t)),
  )
  const forced = input.forcePaymentRisk === true
  const paymentClass: PaymentClassification = burstClaim || forced ? 'payment_proof_or_risk' : latestClass
  const why = forced ? `payment_llm_check (regex: ${latestClass})` : burstClaim ? `earlier_message (latest: ${latestClass})` : null
  const steps: DecisionStep[] = [
    { step: 'payment_class', outcome: paymentClass, ...(why ? { reason: why } : {}) },
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
      allowedAmounts: input.allowedAmounts,
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
      allowedAmounts: input.allowedAmounts,
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
      allowedAmounts: input.allowedAmounts,
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
      allowedAmounts: input.allowedAmounts,
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
  const pick = textMessage
    ? paymentMethodPick(input.inboundText, input.awaitingPaymentMethod === true, offeredMethods(input.brandFacts))
    : null
  // Rafael 2026-10-18: the choice written inside the order data (only when the classifier itself said choice).
  // (textMessage already excludes payment_proof_or_risk: the claim checks always win.)
  const dataChoice = !pick && textMessage && orderDataChoice ? resolvePaymentChoice(orderDataChoice, offeredMethods(input.brandFacts)) : null
  const choice = pick ?? dataChoice
  if (choice === 'contra_entrega' || choice === 'efectivo') {
    // Contra entrega / efectivo: the model checks the zone and the order details, then a person takes the order.
    // Verifier r2 F5 / SecureDog r2 INT-F: inside the order data it is tagged so sales-state learns the choice.
    steps.push({ step: 'payment_choice', outcome: 'model', reason: dataChoice && !pick ? `order_data_${choice}` : choice })
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
        allowedAmounts: input.allowedAmounts,
        replyStyle: input.replyStyle,
        shortcuts: input.shortcuts,
        forceNeedsHuman: true,
        extraReasons: ['payment_info_not_shared'],
        handoff: { kind: 'review', reason: HANDOFF_REASON.paymentData },
      })
    }
    // A choice inside the order data: the model answers (total with shipping, then the method's token — sales-state).
    if (dataChoice && !pick) {
      steps.push({ step: 'payment_choice', outcome: 'model', reason: `order_data_${choice}` })
      return continueToModel(paymentClass, steps)
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
        allowedAmounts: input.allowedAmounts,
        replyStyle: input.replyStyle,
        shortcuts: input.shortcuts,
      })
    }
    steps.push({ step: 'payment_choice', outcome: 'model', reason: choice })
    return continueToModel(paymentClass, steps)
  }


  // SecureDog r3: a card number offered by chat ("te paso el número de mi tarjeta por acá?") is never left to the model,
  // whatever is pending or also asked: the store's card link, or without one the payment-data review.
  if (paymentClass === 'payment_info_safe' && isCardByChatOffer(input.inboundText)) {
    const cardReply =
      canSharePaymentFacts(input.brandFacts) && paymentMethodBlock(input.brandFacts, 'tarjeta')
        ? paymentChoiceReply('tarjeta', 'Claro 🙌 Por seguridad no mandés los datos de tu tarjeta por chat:')
        : null
    if (cardReply) {
      steps.push({ step: 'payment_info', outcome: 'share', reason: 'card_by_chat' })
      return finish({
        text: cardReply,
        intent: 'payment_info',
        shortcutKey: 'sys_payment_info',
        escalate: false,
        paymentClass,
        steps,
        facts: input.brandFacts,
        allowedAmounts: input.allowedAmounts,
        replyStyle: input.replyStyle,
        shortcuts: input.shortcuts,
      })
    }
    steps.push({ step: 'payment_info', outcome: 'handoff', reason: 'card_by_chat' })
    const soon = seedShortcut('sys_payment_soon', input.shortcuts)
    return finish({
      text: renderShortcutTemplate(soon.body, { facts: input.brandFacts }),
      intent: 'payment_info',
      shortcutKey: 'sys_payment_soon',
      escalate: true,
      paymentClass,
      steps,
      facts: input.brandFacts,
      allowedAmounts: input.allowedAmounts,
      replyStyle: input.replyStyle,
      shortcuts: input.shortcuts,
      forceNeedsHuman: true,
      extraReasons: ['card_by_chat'],
      handoff: { kind: 'review', reason: HANDOFF_REASON.paymentData },
    })
  }
  if (paymentClass === 'payment_info_safe' && input.awaitingPaymentMethod && canSharePaymentFacts(input.brandFacts)) {
    // N4: never the method list again while the store's method question is pending — the model answers.
    steps.push({ step: 'payment_info', outcome: 'model', reason: 'method_question_pending' })
    return continueToModel(paymentClass, steps)
  }
  if (paymentClass === 'payment_info_safe') {
    if (canSharePaymentFacts(input.brandFacts)) {
      // Lane C D8: it asks more than which methods there are (total, size, an opinion): the model answers all of it.
      // Not for order data (a choice, not a question).
      if (!nothingPaidYet && asksMoreThanPayment(input.inboundText)) {
        steps.push({ step: 'payment_info', outcome: 'model', reason: 'asks_more_than_payment' })
        return continueToModel(paymentClass, steps)
      }
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
          allowedAmounts: input.allowedAmounts,
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
        allowedAmounts: input.allowedAmounts,
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
      allowedAmounts: input.allowedAmounts,
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
      allowedAmounts: input.allowedAmounts,
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

/**
 * Burst = one reply (Verifier r3 #1): the newest bubble got a code reply ("¿Cómo pago?" → the method list) but an
 * earlier bubble of the burst needs the model ("Quiero 2 del kit grande con envío a Limón"). The model answers the
 * whole burst instead, so no question is left without an answer (same precedent: link_plus_product_question).
 */
export function continueBurstToModel(decision: InboundDecision, reason: string): InboundDecision {
  // The code step that would have answered stays in the trace; the model step is added after it.
  const steps: DecisionStep[] = [...decision.decisionTrace.steps, { step: 'burst_model', outcome: 'continue', reason }]
  return continueToModel(decision.paymentClass, steps)
}

/** The method the decision routed as a choice inside the order data (sales-state nextStep reads it), else null. */
export function decisionOrderDataChoice(decision: Pick<InboundDecision, 'decisionTrace'>): ChosenPaymentMethod | null {
  const step = decision.decisionTrace.steps.find((s) => s.step === 'payment_choice' && typeof s.reason === 'string' && s.reason.startsWith('order_data_'))
  const m = step?.reason?.slice('order_data_'.length)
  return m === 'sinpe' || m === 'transferencia' || m === 'tarjeta' || m === 'contra_entrega' || m === 'efectivo' ? m : null
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
  // Verifier round 8: "No uso SINPE, ¿qué otras formas…?", "Sin tarjeta, ¿cómo pago?" ask for the OTHER methods.
  if (/(?<![\p{L}])(?:no|sin|ni|otras?|otros?|aparte|adem[aá]s|excepto|menos)(?![\p{L}])/iu.test(text || '')) return null
  const hits = SINGLE_METHOD_WORDS.filter(([, re]) => re.test(text || '')).map(([m]) => m)
  return hits.length === 1 ? hits[0] : null
}
