/**
 * When may the support agent email a customer directly? (SPEC §13 Q4 default + Advisor hardening). Pure.
 * A "public" reply is held as an internal DRAFT (Rafael sends it from /super-admin/soporte) when:
 *  - the ticket category is in SUPPORT_AGENT_DRAFT_CATEGORIES (default billing, agent_request);
 *  - the ticket was escalated to Rafael;
 *  - the reply links outside betsycrm.com / wa.me / instagram.com (prompt-injected phishing);
 * Spam tickets never get a reply.
 */

const ALLOWED_LINK_HOSTS = [/(^|\.)betsycrm\.com$/i, /^wa\.me$/i, /(^|\.)instagram\.com$/i]

export function externalLinks(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi)) {
    const raw = m[0].startsWith('www.') ? `https://${m[0]}` : m[0]
    let host = ''
    try {
      host = new URL(raw).hostname
    } catch {
      out.push(m[0])
      continue
    }
    if (!ALLOWED_LINK_HOSTS.some((re) => re.test(host))) out.push(m[0])
  }
  // Bare domains like "evil.co/login" also count.
  for (const m of text.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|cr|xyz|app|link|info|biz|me|ly)\/\S*/gi)) {
    const host = m[0].split('/')[0]
    if (!ALLOWED_LINK_HOSTS.some((re) => re.test(host)) && !out.some((o) => o.includes(m[0]))) out.push(m[0])
  }
  return out
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
}): ReplyDecision {
  if (input.status === 'spam') return { action: 'refuse', reason: 'Ticket marcado como spam.' }
  if (input.draftCategories.has(input.category)) {
    return { action: 'draft', reason: `Categoría ${input.category}: queda como borrador para Rafael.` }
  }
  if (input.assignee === 'rafael' || input.status === 'escalated') {
    return { action: 'draft', reason: 'Ticket escalado: queda como borrador para Rafael.' }
  }
  if (externalLinks(input.body).length) {
    return { action: 'draft', reason: 'La respuesta tiene enlaces externos: queda como borrador para Rafael.' }
  }
  return { action: 'send' }
}
