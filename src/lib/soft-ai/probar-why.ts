/**
 * One short line per reason, shown under each reply in the test chat ("why it answered that"). Pure; only product
 * names / prices / stock and reason codes — never customer or order data.
 */

const ESCALATE: Record<string, string> = {
  payment: 'pago',
  payment_proof: 'comprobante de pago',
  complaint: 'queja',
  human_requested: 'pidió una persona',
  order: 'pedido',
  out_of_scope: 'fuera de tema',
  low_confidence: 'no estaba seguro',
  other: 'otro motivo',
}

const BLOCKED: Record<string, string> = {
  not_bound_to_channel: 'el agente no atiende esta línea',
  flag_off: 'la IA no está encendida para este negocio',
  agent_off: 'el agente está apagado',
  window_closed: 'pasaron más de 24 h desde el último mensaje del cliente',
  human_mode: 'el chat está en modo humano',
  kill_switch: 'la IA está en pausa',
  not_activated: 'no está activado en esta línea (falta “Activar”)',
}

const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `₡${Math.round(n).toLocaleString('es-CR')}` : '')

export function probarWhy(input: {
  toolTrace: unknown
  escalate?: boolean
  escalateReason?: string | null
  fallbackUsed?: boolean
  validationReasons?: string[]
  shortcutKey?: string | null
  blockedBy?: string[]
}): string[] {
  const out: string[] = []
  const steps = Array.isArray(input.toolTrace) ? (input.toolTrace as Array<Record<string, unknown>>) : []
  for (const s of steps) {
    const name = typeof s.name === 'string' ? s.name : ''
    if (!name) continue
    if (name === 'search_inventory') {
      const items = ((s.result as { items?: unknown[] } | undefined)?.items ?? []) as Array<Record<string, unknown>>
      if (s.ok === false) out.push('buscó en inventario: falló la búsqueda')
      else if (!items.length) out.push('buscó en inventario: no encontró productos')
      else {
        const shown = items
          .slice(0, 3)
          .map((i) => [String(i.name ?? '').slice(0, 60), money(i.sellingPrice), typeof i.currentStock === 'number' ? `stock ${i.currentStock}` : ''].filter(Boolean).join(' '))
        out.push(`usó inventario: ${shown.join(' · ')}${items.length > 3 ? ` (+${items.length - 3})` : ''}`)
      }
    } else if (name === 'search_approved_knowledge') out.push('usó el conocimiento del negocio')
    else if (name === 'get_order_status') out.push('consultó el estado de un pedido')
    else if (name === 'get_shipping_status') out.push('consultó el estado de un envío')
    else if (name === 'use_shortcut') out.push('usó una respuesta rápida')
  }
  if (input.shortcutKey && !out.includes('usó una respuesta rápida')) out.push('usó una respuesta rápida')
  if (input.escalate) out.push(`pasó a una persona: ${ESCALATE[input.escalateReason || 'other'] || input.escalateReason || 'otro motivo'}`)
  if (input.fallbackUsed) {
    const reasons = (input.validationReasons ?? []).slice(0, 3).join(', ')
    out.push(`respuesta de respaldo${reasons ? ` (no pasó las reglas: ${reasons})` : ''}`)
  }
  for (const b of input.blockedBy ?? []) out.push(`un cliente real no recibiría respuesta: ${BLOCKED[b] || b}`)
  return [...new Set(out)].slice(0, 6)
}
