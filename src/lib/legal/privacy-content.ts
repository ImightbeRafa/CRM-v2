/**
 * Shared facts for the public privacy pages (English /privacy and Spanish /privacy/es) and for the AI opt-in.
 * One place to edit: the list of providers that can process data, and the policy version/date.
 * Keep in sync with docs/compliance/ (provider table + retention table).
 */

export const POLICY_VERSION = '8.0'
/** Draft prepared 2026-10-02. Update both when the policy is published. */
export const POLICY_DATE_EN = 'October 2, 2026'
export const POLICY_DATE_ES = '2 de octubre de 2026'
export const PRIVACY_EMAIL = 'privacy@betsycrm.com'

export type Subprocessor = {
  name: string
  purposeEn: string
  purposeEs: string
  dataEn: string
  dataEs: string
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'OpenAI (United States)',
    purposeEn: 'Generates replies for AI agents and transcribes voice notes for the internal team assistant.',
    purposeEs: 'Genera las respuestas de los agentes de IA y transcribe notas de voz del asistente interno del equipo.',
    dataEn: 'Message text, display name, recent conversation context, order status; voice audio (team assistant).',
    dataEs: 'Texto de mensajes, nombre visible, contexto reciente de la conversación, estado de pedidos; audio de voz (asistente interno).',
  },
  {
    name: 'xAI (United States)',
    purposeEn: 'Generates replies for AI agents (while configured), powers the internal team assistant and the customer-paste helper.',
    purposeEs: 'Genera respuestas de los agentes de IA (mientras esté configurado), y alimenta al asistente interno del equipo y al ayudante de pegado de clientes.',
    dataEn: 'Message text and, for the team tools, order and customer details the team enters.',
    dataEs: 'Texto de mensajes y, en las herramientas del equipo, datos de pedidos y clientes que el equipo ingresa.',
  },
  {
    name: 'Meta Platforms (WhatsApp, Instagram)',
    purposeEn: 'Delivers and receives messages; optional ad sales measurement when a business turns it on.',
    purposeEs: 'Entrega y recibe mensajes; medición opcional de ventas por anuncios cuando el negocio la activa.',
    dataEn: 'Messages, contact identifiers, media; ad click identifier, amount and currency (measurement only).',
    dataEs: 'Mensajes, identificadores de contacto, archivos; identificador del clic del anuncio, monto y moneda (solo medición).',
  },
  {
    name: 'Cloudflare',
    purposeEn: 'Hosts the application and stores encrypted backups.',
    purposeEs: 'Aloja la aplicación y guarda copias de seguridad.',
    dataEn: 'All application data in transit and in backups.',
    dataEs: 'Todos los datos de la aplicación, en tránsito y en copias de seguridad.',
  },
  {
    name: 'Railway',
    purposeEn: 'Hosts a restricted preview environment used by our team.',
    purposeEs: 'Aloja un entorno de pruebas restringido usado por nuestro equipo.',
    dataEn: 'Same data as production, accessible to authorized staff only.',
    dataEs: 'Los mismos datos de producción, accesibles solo a personal autorizado.',
  },
  {
    name: 'Supabase',
    purposeEn: 'Managed database.',
    purposeEs: 'Base de datos administrada.',
    dataEn: 'All application data.',
    dataEs: 'Todos los datos de la aplicación.',
  },
  {
    name: 'Vercel (Blob storage)',
    purposeEn: 'Stores media files attached to conversations.',
    purposeEs: 'Guarda archivos multimedia adjuntos a las conversaciones.',
    dataEn: 'Photos, audio, documents.',
    dataEs: 'Fotos, audios, documentos.',
  },
  {
    name: 'Upstash',
    purposeEn: 'Rate limiting (abuse protection).',
    purposeEs: 'Limitación de solicitudes (protección contra abuso).',
    dataEn: 'Request counters keyed by account; no message content.',
    dataEs: 'Contadores de solicitudes por cuenta; sin contenido de mensajes.',
  },
  {
    name: 'Resend',
    purposeEn: 'Transactional email (verification, resets, alerts).',
    purposeEs: 'Correo transaccional (verificación, restablecimiento, alertas).',
    dataEn: 'Email address and the message sent.',
    dataEs: 'Correo electrónico y el mensaje enviado.',
  },
  {
    name: 'Tilopay',
    purposeEn: 'Processes subscription payments.',
    purposeEs: 'Procesa los pagos de la suscripción.',
    dataEn: 'Billing details handled by the payment provider.',
    dataEs: 'Datos de facturación tratados por el proveedor de pagos.',
  },
  {
    name: 'Correos de Costa Rica',
    purposeEn: 'Creates and tracks shipping labels when a business uses that feature.',
    purposeEs: 'Crea y rastrea guías de envío cuando un negocio usa esa función.',
    dataEn: 'Recipient name, phone and address.',
    dataEs: 'Nombre, teléfono y dirección del destinatario.',
  },
  {
    name: 'Google',
    purposeEn: 'Sign-in with Google (basic profile only).',
    purposeEs: 'Inicio de sesión con Google (solo perfil básico).',
    dataEn: 'Name, email, profile picture.',
    dataEs: 'Nombre, correo, foto de perfil.',
  },
  {
    name: 'Telegram',
    purposeEn: 'Channel for the internal team assistant, only if the business uses it.',
    purposeEs: 'Canal del asistente interno del equipo, solo si el negocio lo usa.',
    dataEn: 'Messages exchanged with the team assistant.',
    dataEs: 'Mensajes intercambiados con el asistente del equipo.',
  },
]
