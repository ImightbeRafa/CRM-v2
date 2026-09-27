/**
 * Classifies the status message the Cuentas conectadas page sets while / after a connect,
 * reconnect or repair, so the Aurora modals can show a result step without touching the flow.
 */
export type ConnectOutcome = 'success' | 'waiting' | 'cancelled' | 'error'

export function classifyConnectOutcome(message: string): ConnectOutcome {
  const text = (message || '').trim()
  if (!text) return 'error'
  if (/cancelad/i.test(text)) return 'cancelled'
  if (/completa el registro/i.test(text)) return 'waiting'
  if (/no se pudo|error|bloque[oó]|no se recibi|falta|no est[aá] conectada/i.test(text)) return 'error'
  if (/conectado|vinculado|suscrito|re-suscripci[oó]n realizada|sincronizando|actualizando cuentas/i.test(text)) {
    return 'success'
  }
  return 'error'
}
