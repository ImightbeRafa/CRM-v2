/**
 * Support pipeline env (SPEC §8). Pure: reads the env object it is given.
 * Secrets (SUPPORT_WEBHOOK_SECRET, SUPPORT_MCP_TOKEN) are only read where used.
 */

type EnvLike = Record<string, string | undefined>

/** Kill switch. Anything but the literal `true` keeps the legacy behavior. */
export function supportPipelineEnabled(env: EnvLike = process.env): boolean {
  return (env.SUPPORT_PIPELINE_ENABLED || '').trim().toLowerCase() === 'true'
}

export function supportBaseUrl(env: EnvLike = process.env): string {
  const raw = (env.SUPPORT_PUBLIC_BASE_URL || env.NEXTAUTH_URL || 'https://www.betsycrm.com').trim()
  return raw.replace(/\/+$/, '')
}

function email(raw: string | undefined, fallback: string): string {
  const v = (raw || '').trim()
  return v || fallback
}

export type SupportEmailConfig = {
  /** Support inbox the agent watches (Grok Bot). */
  agentInbox: string
  /** Rafael. */
  escalation: string
  /** From header for support mail. */
  from: string
  /** Reply-To for customer-facing mail (the support inbox). */
  replyTo: string
}

export function getSupportEmailConfig(env: EnvLike = process.env): SupportEmailConfig {
  const agentInbox = email(env.SUPPORT_AGENT_EMAIL, 'hola@betsycrm.com')
  return {
    agentInbox,
    escalation: email(env.SUPPORT_ESCALATION_EMAIL, 'betsycrm.cr@gmail.com'),
    // noreply@ is the sender already verified in Resend; Reply-To keeps answers in the support inbox.
    from: email(env.SUPPORT_FROM_EMAIL, 'Betsy <noreply@betsycrm.com>'),
    replyTo: agentInbox,
  }
}

/**
 * Categories where an agent's "public" reply is held as an internal draft for
 * Rafael to send (SPEC §13 Q4 proposal: auto-reply for questions, draft for
 * billing and agent_request). `SUPPORT_AGENT_DRAFT_CATEGORIES=` (empty) = never draft.
 */
export function agentDraftCategories(env: EnvLike = process.env): Set<string> {
  const raw = env.SUPPORT_AGENT_DRAFT_CATEGORIES
  const list = (raw === undefined ? 'billing,agent_request' : raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set(list)
}

/** Webhook target; must be https (http only for localhost tests). */
export function supportWebhookUrl(env: EnvLike = process.env): string | null {
  const raw = (env.SUPPORT_AGENT_WEBHOOK_URL || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:') return u.toString()
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.toString()
    return null
  } catch {
    return null
  }
}
