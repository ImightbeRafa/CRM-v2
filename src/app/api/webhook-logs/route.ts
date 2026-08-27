import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/webhook-logs
 * Retrieve webhook logs for troubleshooting
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const requestedTenantId = searchParams.get('tenantId');
    const tenantId = auth.tenantId;
    const level = searchParams.get('level');
    const source = searchParams.get('source');
    const search = searchParams.get('search');
    const days = parseInt(searchParams.get('days') || '7');

    if (requestedTenantId && requestedTenantId !== tenantId) {
      return NextResponse.json({ error: 'Selected tenant mismatch' }, { status: 403 });
    }

    // Build where clause
    const where: any = {
      tenantId: tenantId
    };

    if (level && level !== 'all') {
      where.level = level;
    }

    if (source && source !== 'all') {
      where.source = source;
    }

    if (search) {
      where.message = {
        contains: search,
        mode: 'insensitive'
      };
    }

    // Date filter
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    where.createdAt = {
      gte: startDate
    };

    // Get logs
    const logs = await prisma.webhookLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      take: 1000 // Limit to prevent large responses
    });

    return NextResponse.json({
      logs,
      total: logs.length,
      filters: {
        level,
        source,
        search,
        days
      }
    });

  } catch (error: any) {
    console.error('Error fetching webhook logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch webhook logs' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/webhook-logs
 * Clear webhook logs for a tenant
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const requestedTenantId = body.tenantId ? String(body.tenantId) : auth.tenantId;
    if (requestedTenantId !== auth.tenantId) {
      return NextResponse.json({ error: 'Selected tenant mismatch' }, { status: 403 });
    }
    const tenantId = auth.tenantId;

    // Delete logs older than 30 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    const result = await prisma.webhookLog.deleteMany({
      where: {
        tenantId: tenantId,
        createdAt: {
          lt: cutoffDate
        }
      }
    });

    return NextResponse.json({
      message: 'Webhook logs cleared',
      deletedCount: result.count
    });

  } catch (error: any) {
    console.error('Error clearing webhook logs:', error);
    return NextResponse.json(
      { error: 'Failed to clear webhook logs' },
      { status: 500 }
    );
  }
}
