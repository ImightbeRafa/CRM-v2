/**
 * In-chat order flow (Chats › Cliente): pedido → guía → guía enviada al cliente.
 * Pure helpers shared by the rail UI and the send-guía route.
 */

export type ChatFlowOrder = {
  id: string
  orderId: string
  orderType: string | null
  status: string
  total: number
  product: string | null
  timestamp: string
  guia: { id: string; number: string | null; createdAt: string } | null
  guiaSentAt: string | null
}

export type ChatOrderStep = 'guia' | 'enviar-guia' | 'listo' | 'retiro'

/** Next action for an order created from a chat. Retiro (RA) orders never need a guía. */
export function nextOrderStep(order: Pick<ChatFlowOrder, 'orderType' | 'guia' | 'guiaSentAt'>): ChatOrderStep {
  if (String(order.orderType || '').toUpperCase() === 'RA') return 'retiro'
  if (!order.guia) return 'guia'
  if (!order.guiaSentAt) return 'enviar-guia'
  return 'listo'
}

export function guiaPdfFilename(guiaNumber: string | null | undefined, orderNumber: string): string {
  const base = String(guiaNumber || orderNumber || 'guia')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40)
  return `guia-${base || 'correos'}.pdf`
}

export function guiaCaption(args: {
  customerName?: string | null
  orderNumber: string
  guiaNumber?: string | null
}): string {
  const first = String(args.customerName || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}'-]/gu, '')
  const hello = first ? `¡Hola ${first}! ` : '¡Hola! '
  const guia = args.guiaNumber ? ` Número de guía de Correos: ${args.guiaNumber}.` : ''
  return `${hello}Tu pedido ${args.orderNumber} ya va en camino 📦${guia}`
}
