/**
 * Public contact intake shared by POST /api/support/contact and the legacy
 * POST /api/contact (SPEC §4). Order: validate → rate limit (IP, then email) →
 * Turnstile (only when its keys are set) → honeypot/timing/link heuristics →
 * ticket (or the legacy email when the kill switch is off / 059 is missing).
 */
import 'server-only'
import { after } from 'next/server'
import { z } from 'zod'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'
import { getLiveToken } from '@/lib/live-token'
import { verifyTurnstile } from '@/lib/turnstile'
import { supportPipelineEnabled } from './config'
import { dispatchPendingSupportEvents } from './dispatcher'
import { buildLegacyContactEmail, resendSender } from './notify'
import { checkSpam, hashIp, isOwnSupportAddress, normalizeEmailKey } from './spam'
import { SupportTablesMissingError, createSupportTicket } from './tickets'
import { SUPPORT_CATEGORIES, SUPPORT_LIMITS } from './types'

const ipLimiter = createIdentifierRateLimit({ windowMs: 10 * 60_000, maxRequests: 5, identifier: 'support-contact-ip' })
const emailLimiter = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 3, identifier: 'support-contact-email' })

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(SUPPORT_LIMITS.name),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(SUPPORT_LIMITS.subject),
  message: z.string().trim().min(SUPPORT_LIMITS.messageMin).max(SUPPORT_LIMITS.messageMax),
  category: z.enum(SUPPORT_CATEGORIES).optional(),
  website: z.string().max(500).optional(),
  startedAt: z.union([z.number(), z.string()]).optional(),
  turnstileToken: z.string().max(4096).optional().nullable(),
  pageUrl: z.string().max(2000).optional().nullable(),
  locale: z.string().max(20).optional().nullable(),
})

export type ContactIntakeResult =
  | { kind: 'invalid'; error: string; fields?: string[] }
  | { kind: 'rate_limited' }
  | { kind: 'turnstile'; error: string }
  | { kind: 'accepted'; ticketRef: string | null; mode: 'ticket' | 'legacy_email' | 'dropped' }
  | { kind: 'failed' }

async function sessionContext(request: Request) {
  try {
    const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.sub) return { tenantId: null, userId: null }
    const t = token as { currentTenant?: { id?: string } | null; tenantId?: string | null }
    return { tenantId: t.currentTenant?.id || t.tenantId || null, userId: token.sub }
  } catch {
    return { tenantId: null, userId: null }
  }
}

/** Old /api/contact callers could send any non-empty message: keep that for the legacy route. */
const legacyContactSchema = contactSchema.extend({ message: z.string().trim().min(1).max(SUPPORT_LIMITS.messageMax) })

export async function handleContactIntake(
  request: Request,
  raw: unknown,
  opts: { legacyRoute?: boolean } = {},
): Promise<ContactIntakeResult> {
  const parsed = (opts.legacyRoute ? legacyContactSchema : contactSchema).safeParse(raw)
  if (!parsed.success) {
    return {
      kind: 'invalid',
      error: 'Revisá los campos del formulario.',
      fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))].filter(Boolean),
    }
  }
  const input = parsed.data
  const ip = getClientIP(request)
  if (!(await ipLimiter(`ip:${ip}`)).allowed) return { kind: 'rate_limited' }
  // Turnstile before the per-address bucket, so nobody can lock a victim's address out without solving it.
  const ts = await verifyTurnstile(input.turnstileToken, ip)
  if (!ts.ok) return { kind: 'turnstile', error: ts.error }
  if (!(await emailLimiter(`email:${normalizeEmailKey(input.email)}`)).allowed) return { kind: 'rate_limited' }

  const spam = checkSpam({
    honeypot: input.website,
    startedAt: input.startedAt,
    subject: input.subject,
    body: input.message,
  })
  // Bots get the same 200 as people (don't teach them); nothing is stored or sent.
  if (spam.verdict === 'reject') return { kind: 'accepted', ticketRef: null, mode: 'dropped' }

  const legacy = async (): Promise<ContactIntakeResult> => {
    if (spam.verdict === 'spam') return { kind: 'accepted', ticketRef: null, mode: 'dropped' }
    const res = await resendSender(buildLegacyContactEmail(input))
    return res.ok ? { kind: 'accepted', ticketRef: null, mode: 'legacy_email' } : { kind: 'failed' }
  }
  if (!supportPipelineEnabled()) return legacy()
  // Betsy's own inboxes as the "customer" would loop acks / agent replies back into the support inbox.
  if (isOwnSupportAddress(input.email)) return { kind: 'accepted', ticketRef: null, mode: 'dropped' }

  const session = await sessionContext(request)
  try {
    const ticket = await createSupportTicket({
      source: 'contact_form',
      tenantId: session.tenantId,
      userId: session.userId,
      contact: { name: input.name, email: input.email },
      subject: input.subject,
      body: input.message,
      category: input.category && input.category !== 'agent_request' ? input.category : 'question',
      status: spam.verdict === 'spam' ? 'spam' : 'open',
      meta: {
        pageUrl: input.pageUrl || null,
        locale: input.locale || null,
        userAgent: (request.headers.get('user-agent') || '').slice(0, 300) || null,
        ipHash: hashIp(ip, process.env.NEXTAUTH_SECRET),
        ...(spam.reasons.length ? { spamReasons: spam.reasons } : {}),
      },
    })
    if (ticket.status !== 'spam') after(() => dispatchPendingSupportEvents({ limit: 5 }).catch(() => undefined))
    return { kind: 'accepted', ticketRef: ticket.status === 'spam' ? null : ticket.ref, mode: 'ticket' }
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return legacy()
    // Name only: Prisma messages can echo argument values (the email).
    console.error('[support] contact intake failed', (error as Error)?.name)
    return { kind: 'failed' }
  }
}
