import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user and their tenant through memberships
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        memberships: {
          where: { isActive: true },
          select: { 
            tenantId: true,
            tenant: {
              select: {
                plan: true,
                tilopaySubscriptionId: true,
                subscriptionStatus: true
              }
            }
          },
          take: 1
        }
      }
    });

    if (!user || !user.memberships || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const { feedback } = await request.json();
    const tenantId = user.memberships[0].tenantId;
    const tenant = user.memberships[0].tenant;

    if (tenant.plan === 'FREE') {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
    }

    console.log(`❌ Canceling subscription for tenant ${tenantId}, plan: ${tenant.plan}`);

    // For Tilopay, mark subscription for cancellation at period end
    // Tilopay Repeat subscriptions are managed in their dashboard
    if (tenant.tilopaySubscriptionId) {
      console.log('ℹ️ Tilopay subscription will be canceled at period end');
    } 
    console.log('ℹ️ User should also cancel in Tilopay to stop automatic charges');

    // Update tenant - mark for cancellation at period end
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        cancelAtPeriodEnd: true,
        subscriptionStatus: 'canceling'
      }
    });

    // Log feedback if provided
    if (feedback) {
      console.log(`📝 Cancellation feedback from tenant ${tenantId}:`, feedback);
      
      // Store feedback in audit log
      try {
        await prisma.auditLog.create({
          data: {
            tenantId,
            userId: token.sub,
            userName: token.email || 'Unknown',
            userRole: 'OWNER',
            action: 'UPDATE',
            entityType: 'subscription',
            entityId: tenant.tilopaySubscriptionId || 'unknown',
            entityName: 'Subscription Cancellation',
            reason: feedback,
            oldValues: { plan: tenant.plan, status: 'active' },
            newValues: { plan: 'FREE', status: 'canceling' }
          }
        });
      } catch (auditError) {
        console.error('Failed to log cancellation audit:', auditError);
      }
    }

    return NextResponse.json({
      status: 'success',
      data: {
        message: 'Subscription will be canceled at the end of the billing period',
        note: tenant.tilopaySubscriptionId 
          ? 'Para detener los cargos automáticos, también cancela tu suscripción en Tilopay.' 
          : null
      }
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}

