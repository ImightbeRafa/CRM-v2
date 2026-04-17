import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET /api/webhook-logs
 * Retrieve webhook logs for troubleshooting
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');
    const level = searchParams.get('level');
    const source = searchParams.get('source');
    const search = searchParams.get('search');
    const days = parseInt(searchParams.get('days') || '7');

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 });
    }

    // Verify user has access to this tenant
    const membership = await prisma.membership.findFirst({
      where: {
        userId: session.user.id,
        tenantId: tenantId,
        isActive: true
      }
    });

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 });
    }

    // Verify user has admin access to this tenant
    const membership = await prisma.membership.findFirst({
      where: {
        userId: session.user.id,
        tenantId: tenantId,
        isActive: true,
        role: {
          in: ['OWNER', 'ADMIN']
        }
      }
    });

    if (!membership) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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
