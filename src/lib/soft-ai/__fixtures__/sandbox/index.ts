/**
 * Synthetic order/shipping rows for Probar. Never a live tenant.
 */

export type SandboxOrder = {
  id: string
  orderId: string
  status: string
  clientId: string
  customerName: string
  phone: string
  shipping: {
    guiaNumber: string
    status: string
    carrier: string
  }
}

export const SANDBOX_ORDERS: SandboxOrder[] = [
  {
    id: 'sandbox-order-1',
    orderId: 'ORD-1',
    status: 'en_proceso',
    clientId: 'sandbox-client',
    customerName: 'Cliente de prueba',
    phone: '88880000',
    shipping: {
      guiaNumber: 'GUIA-1',
      status: 'en_transito',
      carrier: 'correos',
    },
  },
]
