/**
 * Support emails (SPEC §5, §9). All addresses come from env (config.ts).
 * Rules (Advisor/SecureDog):
 *  - the customer auto-ack holds ONLY the ref and fixed text (no subject/body: the public form
 *    takes any address, so echoing text would make Betsy a spam relay);
 *  - the notification to the support inbox never sets Reply-To to the customer (the agent answers
 *    through MCP so the draft rule applies);
 *  - subjects are single-line; every user value is HTML-escaped.
 */
import 'server-only'
import { Resend } from 'resend'
import { escapeHtml } from '@/lib/validation'
import { getSupportEmailConfig, supportBaseUrl } from './config'
import type { SupportEventPayload } from './events'
import { sanitizeHeaderText } from './spam'

export type MailMessage = {
  from: string
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

export type MailSender = (msg: MailMessage) => Promise<{ ok: true; id: string | null } | { ok: false; error: string }>

let resendClient: Resend | null = null

export const resendSender: MailSender = async (msg) => {
  const key = (process.env.RESEND_API_KEY || '').trim()
  if (!key) return { ok: false, error: 'RESEND_API_KEY missing' }
  try {
    resendClient ||= new Resend(key)
    const res = await resendClient.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    })
    if (res.error) return { ok: false, error: String(res.error.message || 'resend_error').slice(0, 200) }
    return { ok: true, id: res.data?.id ?? null }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || 'resend_throw').slice(0, 200) }
  }
}

function paragraphs(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;white-space:pre-wrap;">${p}</p>`)
    .join('')
}

function wrap(inner: string): string {
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;font-size:14px;line-height:1.5;">${inner}</div>`
}

/** `https://evil.com/x` → `hxxps://evil[.]com/x`: customer text in staff mail is never clickable. */
export function defangLinks(text: string): string {
  return text
    .replace(/\bhttp(s?):\/\//gi, 'hxxp$1://')
    .replace(/\b((?:[a-z0-9-]+\.)+)([a-z]{2,24})\b/gi, (m, labels: string, tld: string) =>
      m.includes('@') ? m : `${labels.slice(0, -1)}[.]${tld}`,
    )
}

/** Notification for the support inbox (agent) or Rafael (escalations), built from the redacted payload. */
export function buildNotificationEmail(payload: SupportEventPayload, env: Record<string, string | undefined> = process.env): MailMessage {
  const cfg = getSupportEmailConfig(env)
  const ref = payload.betsy.ref
  const tenantName = payload.betsy.tenant?.name || 'sin negocio'
  const subjectText = sanitizeHeaderText(payload.ticket.subject, 120)
  let subject: string
  if (payload.event === 'ticket.escalated') subject = `[${ref}] Escalado — ${subjectText}`
  else if (payload.ticket.category === 'agent_request')
    subject = `[${ref}] Lead agente IA — ${sanitizeHeaderText(tenantName, 80)}`
  else if (payload.event === 'ticket.customer_replied') subject = `[${ref}] Respuesta del cliente — ${subjectText}`
  else subject = `[${ref}] ${subjectText}`
  const to = payload.event === 'ticket.escalated' ? cfg.escalation : cfg.agentInbox
  const lines = [
    `Evento: ${payload.event}`,
    `Ticket: ${ref} (${payload.ticket.id})`,
    `Canal: ${payload.betsy.channel}`,
    `Categoría: ${payload.ticket.category} · Prioridad: ${payload.ticket.priority} · Estado: ${payload.ticket.status}`,
    `Negocio: ${tenantName}${payload.betsy.tenant?.plan ? ` (${payload.betsy.tenant.plan})` : ''}`,
    `Contacto: ${payload.betsy.contact_name || '—'} <${payload.ticket.user_email || '—'}>`,
    '',
    '--- Texto del cliente (NO verificado; enlaces desactivados) ---',
    defangLinks(payload.ticket.description),
    '--- Fin del texto del cliente ---',
    '',
    `Responder vía MCP (${payload.betsy.mcp_url}) con support_get_ticket / support_reply.`,
    ...(payload.betsy.reply_token && to === cfg.agentInbox ? [`reply_token: ${payload.betsy.reply_token}`] : []),
    `Panel: ${payload.betsy.admin_url}`,
  ]
  const text = lines.join('\n')
  return {
    from: cfg.from,
    to,
    subject: sanitizeHeaderText(subject, 200),
    text,
    html: wrap(
      `<h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(ref)} · ${escapeHtml(subjectText)}</h2>${paragraphs(text)}`,
    ),
  }
}

/** Fixed-text acknowledgement: only the ref is variable. */
export function buildCustomerAckEmail(to: string, ref: string, env: Record<string, string | undefined> = process.env): MailMessage {
  const cfg = getSupportEmailConfig(env)
  const base = supportBaseUrl(env)
  const text = [
    `Recibimos tu mensaje. Tu número de caso es ${ref}.`,
    'Te respondemos por este medio lo antes posible.',
    `Si tenés cuenta en Betsy, también podés ver tus casos en ${base}/soporte.`,
    '',
    'Si no escribiste a Betsy, podés ignorar este correo.',
  ].join('\n')
  return {
    from: cfg.from,
    to,
    replyTo: cfg.replyTo,
    subject: `[${ref}] Recibimos tu mensaje`,
    text,
    html: wrap(paragraphs(text)),
  }
}

/** Public reply from support (agent or Rafael) to the ticket's own contact email. */
export function buildCustomerReplyEmail(to: string, ref: string, body: string, env: Record<string, string | undefined> = process.env): MailMessage {
  const cfg = getSupportEmailConfig(env)
  const base = supportBaseUrl(env)
  const text = `${body}\n\n—\nSoporte Betsy · ${ref}\n${base}/soporte`
  return {
    from: cfg.from,
    to,
    replyTo: cfg.replyTo,
    subject: `[${ref}] Respuesta de soporte Betsy`,
    text,
    html: wrap(paragraphs(text)),
  }
}

export function buildAgentEnabledEmail(to: string, tenantName: string, env: Record<string, string | undefined> = process.env): MailMessage {
  const cfg = getSupportEmailConfig(env)
  const base = supportBaseUrl(env)
  const name = String(tenantName || 'tu negocio').slice(0, 80)
  const text = [
    `¡Tu agente de IA para ${name} está activo!`,
    `Lo podés ver y ajustar en ${base}/config?tab=agentes.`,
    'Si tenés dudas, respondé este correo.',
  ].join('\n')
  return {
    from: cfg.from,
    to,
    replyTo: cfg.replyTo,
    subject: 'Tu agente está activo',
    text,
    html: wrap(paragraphs(text)),
  }
}

/**
 * Legacy /api/contact behavior (kill switch off, or 059 not applied): one email to the
 * escalation inbox with Reply-To the sender — exactly what the old route did, now escaped.
 */
export function buildLegacyContactEmail(
  input: { name: string; email: string; subject: string; message: string },
  env: Record<string, string | undefined> = process.env,
): MailMessage {
  const cfg = getSupportEmailConfig(env)
  const subject = sanitizeHeaderText(input.subject, 150)
  const text = `Nombre: ${input.name}\nEmail: ${input.email}\nAsunto: ${input.subject}\n\n${input.message}`
  return {
    from: 'Betsy Contact Form <noreply@betsycrm.com>',
    to: cfg.escalation,
    replyTo: input.email,
    subject: `Contact Form: ${subject}`,
    text,
    html: wrap(`<h2 style="font-size:18px;margin:0 0 12px;">Nuevo mensaje de contacto</h2>${paragraphs(text)}`),
  }
}
