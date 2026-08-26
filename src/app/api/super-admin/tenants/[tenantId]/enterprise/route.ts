import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { isSuperAdmin } from '@/lib/super-admin-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isSuperAdmin(token.sub))) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const { tenantId } = await params;
  const body = await request.json().catch(() => null);
  const contractReference = String(body?.contractReference || '').trim();
  const reason = String(body?.reason || '').trim();
  const startsAt = new Date(body?.startsAt);
  const endsAt = new Date(body?.endsAt);

  if (
    !contractReference || contractReference.length > 120
    || reason.length < 10 || reason.length > 500
    || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())
    || endsAt <= startsAt
  ) {
    return NextResponse.json({ error: 'Invalid contract reference, reason, or effective dates' }, { status: 400 });
  }

  const [tenant, actor] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.user.findUnique({ where: { id: token.sub }, select: { email: true, name: true } }),
  ]);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  if (tenant.tilopaySubscriptionId) {
    return NextResponse.json({
      error: 'Cancel the existing Tilopay subscription before offline Enterprise activation',
      code: 'active_provider_subscription',
    }, { status: 409 });
  }

  await prisma.$transaction(async tx => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        plan: 'ENTERPRISE',
        subscriptionStatus: 'active',
        currentPeriodStart: startsAt,
        currentPeriodEnd: endsAt,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: token.sub,
        userName: actor?.name || actor?.email || 'Super admin',
        userRole: 'SUPER_ADMIN',
        action: 'UPDATE',
        entityType: 'subscription',
        entityId: contractReference,
        entityName: 'Offline Enterprise contract activation',
        reason,
        oldValues: { plan: tenant.plan, status: tenant.subscriptionStatus },
        newValues: {
          plan: 'ENTERPRISE',
          status: 'active',
          contractReference,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      },
    });
  });

  return NextResponse.json({
    status: 'success',
    data: { tenantId, plan: 'ENTERPRISE', startsAt, endsAt },
  });
}
