/**
 * Business opt-in for AI features (client-safe constants). A business must accept these terms before its agents
 * send customer messages to an AI provider. Single source for the card in /config/agentes, the API and the docs
 * (docs/compliance/). Bump AI_TERMS_VERSION whenever the wording changes: everyone must accept the new version.
 */

export const AI_TERMS_VERSION = 'ia-2026-10-v1'

export const AI_TERMS_TITLE = 'Antes de activar agentes con IA: autorización de su negocio'

export const AI_TERMS_POINTS: readonly string[] = [
  'Su negocio es el responsable de los datos de sus clientes. Betsy CRM actúa como encargada del tratamiento y los trata únicamente siguiendo sus instrucciones.',
  'Cuando un agente de IA está activo, el texto de los mensajes de sus clientes, su nombre visible, el contexto reciente de la conversación y, si corresponde, el estado de un pedido se envían a un proveedor de IA (hoy OpenAI y/o xAI, en Estados Unidos) solo para generar la respuesta.',
  'Esos datos no se usan para entrenar ni mejorar modelos de IA, no se venden y no se comparten con otros fines. El proveedor puede conservarlos hasta 30 días únicamente por seguridad y prevención de abusos.',
  'Las pruebas del agente (Probar) usan solo mensajes que su equipo escribe; nunca conversaciones reales de clientes.',
  'Su negocio debe informar a sus clientes que los atiende un asistente de inteligencia artificial y contar con su permiso para escribirles. En el Anexo de tratamiento de datos hay un aviso sugerido.',
  'Puede revocar esta autorización en cualquier momento: los agentes dejan de generar respuestas y sugerencias de inmediato.',
]

export const AI_TERMS_CHECKBOX =
  'Leí y acepto, en nombre de mi negocio, el uso de proveedores de inteligencia artificial descrito arriba, la Política de Privacidad y el Anexo de tratamiento de datos.'

export const AI_TERMS_LINKS = {
  privacy: '/privacy/es',
  privacyEn: '/privacy',
} as const

export type AiTermsAcceptance = {
  version: string
  acceptedAt: string
  acceptedByUserId: string
  acceptedByName: string
}

export function isCurrentAiTerms(record: AiTermsAcceptance | null | undefined): boolean {
  return Boolean(record && record.version === AI_TERMS_VERSION)
}
