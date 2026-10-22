import { NextRequest, NextResponse, after } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { getLiveToken } from '@/lib/live-token';
import { withTenantContext } from '@/lib/tenantContext';
import { supportPipelineEnabled } from '@/lib/support/config';
import { dispatchPendingSupportEvents } from '@/lib/support/dispatcher';
import { viewerContact } from '@/lib/support/session';
import { createIdentifierRateLimit } from '@/lib/rate-limit';
import {
  SupportTablesMissingError,
  createSupportTicket,
  listFeedbackShapedTickets,
} from '@/lib/support/tickets';

// The tenant-scoped client's inferred type sits at TypeScript's depth limit; pin the one model used here
// (same runtime object, tenant isolation unchanged).
const tenantFeedback = (tenantId: string) =>
  getTenantPrisma(tenantId) as unknown as Pick<PrismaClient, 'feedbackTicket'>;

// Shares its bucket with /api/support/tickets (same identifier): 10 tickets per person per hour.
const feedbackLimiter = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 10, identifier: 'support-ticket-user' });

/**
 * In-app feedback (FeedbackWidget). With SUPPORT_PIPELINE_ENABLED=true it goes through the support
 * pipeline (createSupportTicket: ticket + outbox, same response shape); off, or before SQL 059, the
 * legacy FeedbackTicket table is used as before.
 */
export async function GET(request: NextRequest) {
  try {
    const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;

    if (!tenantId || !userId) {
      return NextResponse.json({ error: 'Session incomplete' }, { status: 400 });
    }

    return await withTenantContext({ tenantId, userId, role }, async () => {
      const prisma = tenantFeedback(tenantId);
      const legacy = await prisma.feedbackTicket.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      if (!supportPipelineEnabled()) return NextResponse.json({ status: 'success', data: legacy });
      let support: Awaited<ReturnType<typeof listFeedbackShapedTickets>> = [];
      try {
        support = await listFeedbackShapedTickets(userId, tenantId);
      } catch (error) {
        if (!(error instanceof SupportTablesMissingError)) throw error;
      }
      // Backfilled legacy rows appear once (as their support ticket).
      const migrated = new Set(support.map((t) => t.legacyFeedbackTicketId).filter(Boolean));
      const data = [...support, ...legacy.filter((t) => !migrated.has(t.id))]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 50);
      return NextResponse.json({ status: 'success', data });
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;

    if (!tenantId || !userId) {
      return NextResponse.json({ error: 'Session incomplete' }, { status: 400 });
    }

    const body = await request.json();
    const { category, subject, description, screenshotUrl } = body;

    if (!subject?.trim() || !description?.trim()) {
      return NextResponse.json({ error: 'Subject and description are required' }, { status: 400 });
    }

    const validCategories = ['bug', 'feature', 'question', 'other'];
    const safeCategory = validCategories.includes(category) ? category : 'other';

    if (supportPipelineEnabled()) {
      // Each ticket mails the support inbox + the agent: same per-person cap as /api/support/tickets.
      if (!(await feedbackLimiter(`user:${userId}`)).allowed) {
        return NextResponse.json({ error: 'Demasiados tickets. Probá más tarde.' }, { status: 429 });
      }
      const contact = await viewerContact(userId);
      if (contact) {
        try {
          const ticket = await createSupportTicket({
            source: 'in_app',
            tenantId,
            userId,
            contact,
            subject: String(subject).trim().slice(0, 200),
            body: String(description).trim().slice(0, 5000),
            category: safeCategory,
            meta: { screenshotUrl: screenshotUrl?.trim()?.slice(0, 500) || null },
          });
          after(() => dispatchPendingSupportEvents({ limit: 5 }).catch(() => undefined));
          return NextResponse.json({
            status: 'success',
            data: { id: ticket.id, ref: ticket.ref, tenantId, userId, category: safeCategory, status: 'open' },
          });
        } catch (error) {
          if (!(error instanceof SupportTablesMissingError)) throw error;
          // SQL 059 not applied yet: fall through to the legacy table.
        }
      }
    }

    return await withTenantContext({ tenantId, userId, role }, async () => {
      const prisma = tenantFeedback(tenantId);
      const ticket = await prisma.feedbackTicket.create({
        data: {
          tenantId,
          userId,
          category: safeCategory,
          subject: subject.trim().slice(0, 200),
          description: description.trim().slice(0, 5000),
          screenshotUrl: screenshotUrl?.trim()?.slice(0, 500) || null,
        },
      });
      return NextResponse.json({ status: 'success', data: ticket });
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
