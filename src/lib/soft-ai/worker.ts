/**
 * Soft Tenant AI worker — inbound → context+KB → tools → full reply.
 * Feature-flagged at the API boundary; DEMO always runs when agentMode allows.
 * Deterministic heuristic agent (no staff-bot dual-router). Full replies, not drafts.
 */

import { isPaymentSensitiveText, isToolAllowed } from '@/lib/soft-ai/config'
import {
  extractOrderHint,
  runCorreosGuia,
  runCreateOrLinkOrder,
  runEscalateToHuman,
  runGetOrderStatus,
  runTagChat,
  type SoftAiToolDeps,
  type SoftAiToolContext,
} from '@/lib/soft-ai/tools'
import type { SoftAiTurnInput, SoftAiTurnResult, SoftAiToolLogEntry } from '@/lib/soft-ai/types'
import type { SoftTag } from '@/lib/chat-soft-copilot'

const TRACKING_RE = /\b(gu[ií]a|tracking|rastreo|n[uú]mero de gu[ií]a)\b/i
const PRICE_RE = /\b(precio|cu[aá]nto|costo|kit|info|informaci[oó]n|env[ií]o)\b/i
const ORDER_STATUS_RE = /\b(pedido|estado|sali[oó]|despach|preparaci[oó]n)\b/i

function lastInbound(input: SoftAiTurnInput): string {
  if (input.inboundText?.trim()) return input.inboundText.trim()
  const msg = [...input.messages].reverse().find((m) => m.direction === 'inbound')
  return (msg?.content || '').trim()
}

function firstName(input: SoftAiTurnInput): string {
  const raw = (input.recipientName || 'hola').trim().replace(/^Demo\s·\s/i, '')
  const part = raw.split(/\s+/)[0] || 'hola'
  return part.replace(/^@/, '')
}

function kbHint(input: SoftAiTurnInput): string | null {
  const text = lastInbound(input).toLowerCase()
  for (const snip of input.config.kb) {
    const key = snip.slice(0, 24).toLowerCase()
    if (text.includes('env') && /env[ií]o|correos/i.test(snip)) return snip
    if (text.includes('kit') && /kit/i.test(snip)) return snip
    if (key && text.includes(key.split(' ')[0] || '')) return snip
  }
  return input.config.kb[0] || null
}

function composeReply(opts: {
  input: SoftAiTurnInput
  hints: string[]
  escalated: boolean
  paymentBlocked: boolean
}): string {
  const name = firstName(opts.input)
  const personalityLead = opts.input.config.personality.split('.')[0]
  const body = opts.hints.filter(Boolean).join(' ')
  const kb = kbHint(opts.input)

  if (opts.paymentBlocked) {
    return `Hola ${name}, para temas de pago / SINPE te paso con una persona del equipo (no lo manejo automático). ${kb ? `Nota: ${kb}` : ''}`.trim()
  }

  if (opts.escalated) {
    return body || `Hola ${name}, te paso con un humano del equipo.`
  }

  const lead = `Hola ${name},`
  const mid = body || '¿En qué más te puedo ayudar?'
  const tone = personalityLead ? '' : ''
  void tone
  const kbLine = kb && !body.includes(kb.slice(0, 20)) ? ` ${kb}` : ''
  return `${lead} ${mid}${kbLine}`.replace(/\s+/g, ' ').trim()
}

/**
 * Run one Soft AI turn. Caller enforces feature flag for non-demo tenants.
 */
export async function runSoftAiTurn(
  input: SoftAiTurnInput,
  deps?: SoftAiToolDeps,
): Promise<SoftAiTurnResult> {
  const nowMs = input.nowMs ?? Date.now()

  if (input.agentMode === 'paused') {
    return {
      skipped: true,
      skipReason: 'paused',
      reply: null,
      toolLog: [],
      agentMode: 'paused',
      tags: input.tags,
      orderId: input.orderId || null,
      paymentBlocked: false,
    }
  }

  if (input.agentMode === 'human') {
    return {
      skipped: true,
      skipReason: 'human',
      reply: null,
      toolLog: [],
      agentMode: 'human',
      tags: input.tags,
      orderId: input.orderId || null,
      paymentBlocked: false,
    }
  }

  const inbound = lastInbound(input)
  if (!inbound) {
    return {
      skipped: true,
      skipReason: 'empty',
      reply: null,
      toolLog: [],
      agentMode: input.agentMode,
      tags: input.tags,
      orderId: input.orderId || null,
      paymentBlocked: false,
    }
  }

  let tags: SoftTag[] = [...input.tags]
  let orderId: string | null = input.orderId || null
  const toolLog: SoftAiToolLogEntry[] = []
  const hints: string[] = []
  let agentMode: SoftAiTurnResult['agentMode'] = input.agentMode
  let paymentBlocked = false

  const ctx = (): SoftAiToolContext => ({
    input: { ...input, tags, orderId },
    config: input.config,
    tags,
    orderId,
    deps,
    nowMs,
  })

  // Payment / SINPE always human when configured
  if (input.config.paymentAlwaysHuman && isPaymentSensitiveText(inbound)) {
    paymentBlocked = true
    if (isToolAllowed(input.config, 'escalate_to_human')) {
      const esc = await runEscalateToHuman(ctx(), 'payment_or_sinpe')
      toolLog.push(esc.log)
      tags = esc.tags
      orderId = esc.orderId
      agentMode = 'human'
      if (esc.replyHint) hints.push(esc.replyHint)
    } else {
      agentMode = 'human'
    }
    return {
      skipped: false,
      reply: composeReply({ input, hints, escalated: true, paymentBlocked: true }),
      toolLog,
      agentMode,
      tags,
      orderId,
      paymentBlocked: true,
    }
  }

  // Intent routing → tools → full reply
  const wantsGuia = TRACKING_RE.test(inbound) || /gu[ií]a/i.test(inbound)
  const wantsPrice = PRICE_RE.test(inbound)
  const wantsStatus = ORDER_STATUS_RE.test(inbound) || Boolean(extractOrderHint(inbound))
  const needsOrder = wantsGuia || wantsStatus || Boolean(extractOrderHint(inbound))

  if (needsOrder && isToolAllowed(input.config, 'create_or_link_order')) {
    const linked = await runCreateOrLinkOrder(ctx())
    toolLog.push(linked.log)
    tags = linked.tags
    orderId = linked.orderId
    if (linked.replyHint) hints.push(linked.replyHint)
  }

  if (wantsStatus && isToolAllowed(input.config, 'get_order_status')) {
    const st = await runGetOrderStatus(ctx())
    toolLog.push(st.log)
    tags = st.tags
    orderId = st.orderId
    if (st.replyHint) hints.push(st.replyHint)
  }

  if (wantsGuia && isToolAllowed(input.config, 'correos_guia')) {
    const guia = await runCorreosGuia(ctx())
    toolLog.push(guia.log)
    tags = guia.tags
    orderId = guia.orderId
    if (guia.replyHint) hints.push(guia.replyHint)
  }

  if (wantsGuia && isToolAllowed(input.config, 'tag_chat')) {
    const tagged = await runTagChat(ctx(), 'Envío')
    toolLog.push(tagged.log)
    tags = tagged.tags
  } else if (wantsPrice && isToolAllowed(input.config, 'tag_chat')) {
    const tagged = await runTagChat(ctx(), 'Nuevo')
    toolLog.push(tagged.log)
    tags = tagged.tags
  }

  if (wantsPrice && !wantsGuia) {
    hints.push(
      'Con gusto te oriento: el kit se cotiza según provincia. Un humano confirma precio final — no cobro automático.',
    )
  }

  if (!hints.length) {
    hints.push('Gracias por escribirnos. Contame un poco más y te ayudo con el pedido o el envío.')
  }

  return {
    skipped: false,
    reply: composeReply({ input, hints, escalated: false, paymentBlocked: false }),
    toolLog,
    agentMode,
    tags,
    orderId,
    paymentBlocked: false,
  }
}
