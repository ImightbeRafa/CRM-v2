/**
 * Soft Agent Layer LLM failure fallback — bound accounts never use legacy sales template.
 */

import { classifyPaymentText } from '@/lib/soft-ai/payment-classifier'
import { reservedShortcutBody } from '@/lib/soft-ai/shortcuts'
import type { SoftAiToolRunContext } from '@/lib/soft-ai/llm/tool-runner'
import { runA1Tool } from '@/lib/soft-ai/llm/tool-runner'

export type FallbackResult = {
  text: string
  escalate: boolean
  escalateReason: string
  toolTrace: unknown[]
}

export async function runAgentFallback(input: {
  inboundText: string
  toolCtx: SoftAiToolRunContext
  linkedOrderId?: string | null
}): Promise<FallbackResult> {
  if (classifyPaymentText(input.inboundText) === 'payment_proof_or_risk') {
    return {
      text: reservedShortcutBody('sys_handoff_payment'),
      escalate: true,
      escalateReason: 'payment_or_sinpe',
      toolTrace: [{ tool: 'escalate_to_human', reason: 'payment_or_sinpe', source: 'fallback' }],
    }
  }

  const statusAsk = /estado|pedido|gu[ií]a|tracking|env[ií]o/i.test(input.inboundText)
  if (statusAsk && input.linkedOrderId) {
    const order = await runA1Tool(
      input.toolCtx,
      'get_order_status',
      JSON.stringify({ orderNumberHint: input.linkedOrderId }),
    )
    if (order.ok) {
      const shipping = await runA1Tool(
        input.toolCtx,
        'get_shipping_status',
        JSON.stringify({ orderNumberHint: input.linkedOrderId }),
      )
      const orderNumber = String(order.result.orderNumber || input.linkedOrderId)
      const status = String(order.result.status || 'en proceso')
      const guia =
        shipping.ok && shipping.result.guiaNumber
          ? ` Guía: ${shipping.result.guiaNumber}.`
          : ''
      return {
        text: `Tu pedido ${orderNumber} está en estado: ${status}.${guia}`,
        escalate: false,
        escalateReason: '',
        toolTrace: [
          { tool: 'get_order_status', result: order.result, source: 'fallback' },
          ...(shipping.ok
            ? [{ tool: 'get_shipping_status', result: shipping.result, source: 'fallback' }]
            : []),
        ],
      }
    }
  }

  return {
    text: reservedShortcutBody('sys_handoff_unavailable'),
    escalate: true,
    escalateReason: 'llm_unavailable',
    toolTrace: [{ tool: 'escalate_to_human', reason: 'llm_unavailable', source: 'fallback' }],
  }
}
