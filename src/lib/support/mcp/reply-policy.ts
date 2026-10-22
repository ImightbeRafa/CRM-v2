/**
 * When may the support agent email a customer directly? (SPEC §13 Q4 + Advisor/SecureDog hardening). Pure.
 *
 * Ticket text is attacker-controlled and the agent can read every ticket, so a prompt injection
 * could make it mail other customers' data or phishing. Betsy therefore decides, not the LLM:
 *
 *  - SUPPORT_AGENT_AUTOSEND (default `off`): `off` = every agent "public" reply is a DRAFT that
 *    Rafael sends from /super-admin/soporte; `signed_in` = auto-send only on tickets from a logged-in
 *    user; `all` = also anonymous contact-form tickets.
 *  - Even when auto-send is on, a reply is held as a draft when the ticket category is in
 *    SUPPORT_AGENT_DRAFT_CATEGORIES (default billing, agent_request), the ticket is escalated, or the
 *    body carries anything that should not leave without a human look: any link other than Betsy's own
 *    contact URLs, any domain-looking text, any e-mail address, a phone-length number other than
 *    Betsy's WhatsApp, or another BETSY-n ref.
 *  - Spam tickets never get a reply.
 */

export type AutosendMode = 'off' | 'signed_in' | 'all'

export function parseAutosendMode(raw: string | undefined | null): AutosendMode {
  const v = (raw || '').trim().toLowerCase()
  return v === 'signed_in' || v === 'all' ? v : 'off'
}

export type OwnContact = { whatsappDigits: string | null; instagramHandle: string | null }

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi
// "label.tld" with or without a path (pagos-betsy.com, evil.site/login), Unicode-aware so lookalike
// letters (betsу.com with a Cyrillic у) still count. Emails are caught separately.
const DOMAIN_RE = /(?<![@\p{L}\p{N}_.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?\.)+\p{L}{2,24}(?:\/[^\s<>()"']*)?/giu
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/giu
// Long opaque strings (keys, tokens) that should never be mailed out.
const OPAQUE_RE = /[A-Za-z0-9_\-+/=]{24,}/g

function isOwnUrl(raw: string, own: OwnContact): boolean {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return false
  }
  const host = u.hostname.toLowerCase()
  const path = u.pathname.replace(/\/+$/, '')
  if (host === 'betsycrm.com' || host === 'www.betsycrm.com') return true
  if (host === 'wa.me') return Boolean(own.whatsappDigits) && path === `/${own.whatsappDigits}`
  if (host === 'instagram.com' || host === 'www.instagram.com') {
    return Boolean(own.instagramHandle) && path.toLowerCase() === `/${own.instagramHandle!.toLowerCase()}`
  }
  return false
}

/** Links / domain-looking text that are not Betsy's own contact URLs. */
export function externalLinks(text: string, own: OwnContact = { whatsappDigits: null, instagramHandle: null }): string[] {
  const out: string[] = []
  const withoutEmails = text.replace(EMAIL_RE, ' ')
  for (const m of withoutEmails.matchAll(URL_RE)) if (!isOwnUrl(m[0], own)) out.push(m[0])
  const withoutUrls = withoutEmails.replace(URL_RE, ' ')
  for (const m of withoutUrls.matchAll(DOMAIN_RE)) if (!isOwnUrl(m[0], own)) out.push(m[0])
  return out
}

/** Reasons a reply body must get a human look before it leaves Betsy. */
export function sensitiveContent(raw: string, own: OwnContact, ownRef: string): string[] {
  const reasons: string[] = []
  // NFKC folds full-width digits / compatibility letters before matching.
  const body = raw.normalize('NFKC')
  if (body.match(EMAIL_RE)) reasons.push('correo electrónico')
  if (externalLinks(body, own).length) reasons.push('enlace o dominio externo')
  for (const m of body.matchAll(/\+?\d[\d\s().\-/_,]{5,}\d/g)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 7 && digits !== own.whatsappDigits && `506${digits}` !== own.whatsappDigits) {
      reasons.push('número de teléfono o cuenta')
      break
    }
  }
  const ownNumber = /(\d+)$/.exec(ownRef)?.[1] ?? ''
  for (const m of body.matchAll(/(?:\bBETSY[\s_#-]*|#)(\d+)\b/gi)) {
    if (m[1] !== ownNumber) {
      reasons.push('referencia a otro ticket')
      break
    }
  }
  if ([...body.matchAll(OPAQUE_RE)].some((m) => /[A-Za-z]/.test(m[0]) && /\d/.test(m[0]))) {
    reasons.push('código o clave')
  }
  return reasons
}

/**
 * support_update_ticket limits, so the agent cannot undo what makes a reply a draft:
 * no moving a ticket out of a draft category, no un-spamming, no touching a ticket escalated to
 * Rafael. Returns the refusal reason, or null when allowed.
 */
export function agentUpdateRefusal(
  current: { status: string; category: string; assignee: string },
  patch: { status?: string; category?: string },
  draftCategories: Set<string>,
): string | null {
  if (current.assignee === 'rafael' || current.status === 'escalated') {
    return 'Ticket escalado: solo Rafael lo cambia.'
  }
  if (current.status === 'spam' && patch.status && patch.status !== 'spam') {
    return 'Solo Rafael saca un ticket de spam.'
  }
  if (patch.category && draftCategories.has(current.category) && !draftCategories.has(patch.category)) {
    return `Solo Rafael cambia la categoría de un ticket ${current.category}.`
  }
  if (patch.status === 'escalated') return 'Usá support_escalate para escalar.'
  return null
}

export type ReplyDecision =
  | { action: 'refuse'; reason: string }
  | { action: 'draft'; reason: string }
  | { action: 'send' }

export function decidePublicReply(input: {
  status: string
  category: string
  assignee: string
  body: string
  draftCategories: Set<string>
  autosend?: AutosendMode
  /**
   * The reply goes to a VERIFIED account address: an in-app ticket (not the public form, where any address
   * can be typed) from a user whose email is verified and equals the ticket contact (SecureDog R1).
   */
  signedIn?: boolean
  ref?: string
  own?: OwnContact
}): ReplyDecision {
  if (input.status === 'spam') return { action: 'refuse', reason: 'Ticket marcado como spam.' }
  const autosend = input.autosend ?? 'off'
  // Always computed, so Rafael sees the specific warning even when everything is a draft anyway.
  const sensitive = sensitiveContent(input.body, input.own ?? { whatsappDigits: null, instagramHandle: null }, input.ref ?? '')
  const warn = sensitive.length ? ` ¡Ojo! Incluye ${sensitive.join(', ')}.` : ''
  if (autosend === 'off') return { action: 'draft', reason: `Envío automático apagado: borrador para Rafael.${warn}` }
  if (autosend === 'signed_in' && !input.signedIn) {
    return { action: 'draft', reason: `Destino no verificado (formulario o correo sin verificar): borrador para Rafael.${warn}` }
  }
  if (input.draftCategories.has(input.category)) {
    return { action: 'draft', reason: `Categoría ${input.category}: borrador para Rafael.${warn}` }
  }
  if (input.assignee === 'rafael' || input.status === 'escalated') {
    return { action: 'draft', reason: `Ticket escalado: borrador para Rafael.${warn}` }
  }
  if (sensitive.length) {
    return { action: 'draft', reason: `La respuesta incluye ${sensitive.join(', ')}: borrador para Rafael.` }
  }
  return { action: 'send' }
}
