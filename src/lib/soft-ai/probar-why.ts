/**
 * One short line per reason, shown under each reply in the test chat ("why it answered that"). Pure; only product
 * names / prices / stock and reason codes — never customer or order data.
 */

// Real codes from the turn (agent-claim-gates / runtime / tool-runner); anything unknown shows as a generic phrase.
const ESCALATE: Record<string, string> = {
  payment_or_sinpe: 'pago o comprobante SINPE (lo confirma una persona)',
  media_inbound: 'mandó foto, audio o archivo',
  opt_out: 'pidió no hablar con la IA',
  llm_unavailable: 'la IA no respondió a tiempo',
  ownership: 'pregunta por un pedido de otra persona o negocio',
  provenance: 'la respuesta tenía un dato que no salió de tus datos (precio, número…)',
  human_requested: 'pidió una persona',
  complaint: 'queja',
  other: 'otro motivo',
}

const BLOCKED: Record<string, string> = {
  flag_off: 'la IA no está encendida para este negocio',
  not_bound_to_channel: 'el agente no atiende esta línea',
  window_closed: 'pasaron más de 24 h desde el último mensaje del cliente',
  account_not_allowlisted: 'esta línea no está activada (falta “Activar”)',
  ai_full_not_unlocked: 'falta “Activar” en esta línea',
  agent_not_live: 'el agente está en borrador (falta “Activar”)',
  human_only: 'el agente está en modo solo personas',
  paused_before_send: 'el chat se pausó antes de enviar',
  human_before_send: 'una persona tomó el chat antes de enviar',
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
  if (input.escalate) out.push(`pasó a una persona: ${ESCALATE[input.escalateReason || 'other'] || 'otro motivo'}`)
  // Codes are internal; the owner only needs to know the AI's own answer was replaced by a safe one.
  if (input.fallbackUsed) out.push('respuesta de respaldo: la IA falló o su respuesta no pasó las reglas')
  for (const b of input.blockedBy ?? []) out.push(`un cliente real no recibiría respuesta: ${BLOCKED[b] || 'una regla del canal lo bloquea'}`)
  return [...new Set(out)].slice(0, 6)
}
