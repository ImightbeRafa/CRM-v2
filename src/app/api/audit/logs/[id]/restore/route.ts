import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { guardTenantWrite } from '@/lib/billing-access';
import { shouldUseSoftDeleteRestoreV2 } from '@/lib/feature-flags';
import { OrderArchiveError, restoreOrderFromAudit } from '@/lib/order-archive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'manage_tenant');
    if (!auth.ok) return auth.response;
    if (auth.role !== 'OWNER') {
      return NextResponse.json(
        { status: 'error', error: 'Only the tenant OWNER can restore an archived order' },
        { status: 403 },
      );
    }

    const writeAccess = await guardTenantWrite(auth.tenantId, {
      channel: 'api',
      route: '/api/audit/logs/[id]/restore',
    });
    if (!writeAccess.allowed) return writeAccess.response;

    if (!(await shouldUseSoftDeleteRestoreV2(auth.tenantId))) {
      return NextResponse.json(
        { status: 'error', error: 'Order restore is not enabled for this tenant' },
        { status: 404 },
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await restoreOrderFromAudit({
      tenantId: auth.tenantId,
      auditLogId: id,
      actorUserId: auth.userId,
      actorName: auth.session?.user?.email || 'Unknown',
      actorRole: 'OWNER',
      expectedDeletedAt: body.expectedDeletedAt,
    });

    return NextResponse.json({
      status: 'success',
      data: result,
      message: 'Order restored without replaying invoices, guías, payments, or inventory',
    });
  } catch (error) {
    if (error instanceof OrderArchiveError) {
      return NextResponse.json(
        { status: 'error', code: error.code, error: error.message },
        { status: error.status },
      );
    }
    console.error('[Audit restore] Failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ status: 'error', error: 'Restore failed' }, { status: 500 });
  }
}
