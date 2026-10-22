/**
 * Copy legacy FeedbackTicket rows into SupportTicket (SPEC §3 backfill). Needs SQL 059 applied.
 * Idempotent: rows already copied (SupportTicket.legacyFeedbackTicketId) are skipped. Uses the single
 * write path (createSupportTicket, backfill mode: original status/dates, admin notes → internal
 * message, NO outbox event, so nothing is emailed or pushed for old tickets). FeedbackTicket is untouched.
 *
 * Dry run (default, read-only):
 *   npx tsx --import ./scripts/shim-server-only.mjs scripts/backfill-feedback-to-support.ts
 * Apply (shared production DB — Rafael's GO only):
 *   SUPPORT_BACKFILL_APPLY=1 npx tsx --import ./scripts/shim-server-only.mjs scripts/backfill-feedback-to-support.ts --apply
 */
import { prisma } from '../src/lib/db'
import { createSupportTicket } from '../src/lib/support/tickets'
import type { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '../src/lib/support/types'

const STATUS: Record<string, SupportTicketStatus> = {
  open: 'open',
  in_progress: 'waiting_customer',
  resolved: 'resolved',
  closed: 'closed',
}

async function main() {
  const apply = process.argv.includes('--apply') && process.env.SUPPORT_BACKFILL_APPLY === '1'
  const legacy = await prisma.feedbackTicket.findMany({ orderBy: { createdAt: 'asc' } })
  const done = new Set(
    (await prisma.supportTicket.findMany({
      where: { legacyFeedbackTicketId: { not: null } },
      select: { legacyFeedbackTicketId: true },
    })).map((r) => r.legacyFeedbackTicketId),
  )
  const todo = legacy.filter((t) => !done.has(t.id))
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — FeedbackTicket: ${legacy.length}, ya copiados: ${legacy.length - todo.length}, a copiar: ${todo.length}`)
  if (!apply) {
    for (const t of todo.slice(0, 20)) console.log(`- ${t.id} ${t.createdAt.toISOString()} [${t.status}] ${t.subject.slice(0, 60)}`)
    console.log('Nada escrito. Para aplicar: SUPPORT_BACKFILL_APPLY=1 … --apply')
    return
  }
  let copied = 0
  for (const t of todo) {
    const user = await prisma.user.findUnique({ where: { id: t.userId }, select: { email: true, name: true } })
    if (!user?.email) {
      console.log(`  – ${t.id}: usuario sin correo, se omite`)
      continue
    }
    const created = await createSupportTicket({
      source: 'in_app',
      tenantId: t.tenantId,
      userId: t.userId,
      contact: { name: user.name ?? null, email: user.email },
      subject: t.subject,
      body: t.description,
      category: (['bug', 'feature', 'question', 'other'].includes(t.category) ? t.category : 'other') as SupportTicketCategory,
      priority: (['low', 'normal', 'high', 'critical'].includes(t.priority) ? t.priority : 'normal') as SupportTicketPriority,
      meta: { screenshotUrl: t.screenshotUrl ?? null, backfilled: true },
      legacyFeedbackTicketId: t.id,
      backfill: {
        status: STATUS[t.status] ?? 'open',
        createdAt: t.createdAt,
        resolvedAt: t.resolvedAt,
        internalNote: t.adminNotes,
      },
    })
    copied++
    console.log(`  ✓ ${t.id} → ${created.ref}`)
  }
  console.log(`Copiados: ${copied}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
