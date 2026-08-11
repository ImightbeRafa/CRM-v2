import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { timingSafeEqualString } from '@/lib/security';

/**
 * Cron Job: Process Expired Subscriptions
 *
 * Endpoint: GET/POST /api/cron/process-subscription-expiry
 *
 * Purpose: Downgrade expired subscriptions to FREE plan WITHOUT deleting any data
 *
 * Security: Always requires Authorization: Bearer ${CRON_SECRET} (fail-closed).
 */
export async function GET(request: NextRequest) {
  return await processExpiredSubscriptions(request);
}

export async function POST(request: NextRequest) {
  return await processExpiredSubscriptions(request);
}

async function processExpiredSubscriptions(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log('🔄 [Cron] Starting subscription expiry processing...');

    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = (process.env.CRON_SECRET || '').trim();

    if (!cronSecret) {
      console.error('❌ [Cron] CRON_SECRET not configured — refusing subscription expiry job');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    const expected = `Bearer ${cronSecret}`;
    if (!timingSafeEqualString(authHeader, expected)) {
      console.error('❌ [Cron] Unauthorized cron job attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    
    // Find all tenants with expired paid subscriptions
    const expiredTenants = await prisma.tenant.findMany({
      where: {
        AND: [
          { currentPeriodEnd: { lt: now } },  // Period has ended
          { plan: { not: 'FREE' } },  // Not already on FREE plan
          {
            OR: [
              { subscriptionStatus: 'active' },
              { subscriptionStatus: 'cancelled' },
              { subscriptionStatus: 'payment_failed' }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        plan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        tilopaySubscriptionId: true
      }
    });

    console.log(`📊 [Cron] Found ${expiredTenants.length} expired subscriptions to process`);

    if (expiredTenants.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired subscriptions to process',
        processedCount: 0,
        processingTime: `${Date.now() - startTime}ms`
      });
    }

    const results = {
      success: [] as string[],
      errors: [] as { tenantId: string; error: string }[]
    };

    // Process each expired tenant
    for (const tenant of expiredTenants) {
      try {
        console.log(`🔽 [Cron] Downgrading ${tenant.name} (${tenant.id}) from ${tenant.plan} to FREE`);
        
        // IMPORTANT: Downgrade to FREE, but NEVER delete data
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            plan: 'FREE',
            subscriptionStatus: 'expired',
            cancelAtPeriodEnd: false,
            // Keep all other data intact - orders, clients, inventory, etc.
          }
        });

        // Create audit log for downgrade
        try {
          await prisma.auditLog.create({
            data: {
              tenantId: tenant.id,
              userId: 'system',
              userName: 'Subscription Expiry Cron',
              userRole: 'SYSTEM',
              action: 'UPDATE',
              entityType: 'subscription',
              entityId: tenant.tilopaySubscriptionId || 'none',
              entityName: `${tenant.plan} → FREE (Expired)`,
              oldValues: {
                plan: tenant.plan,
                status: tenant.subscriptionStatus,
                expiredAt: tenant.currentPeriodEnd?.toISOString()
              },
              newValues: {
                plan: 'FREE',
                status: 'expired',
                processedAt: now.toISOString(),
                note: 'Automatically downgraded to FREE after subscription expiry. All data preserved.'
              }
            }
          });
        } catch (auditError) {
          console.error(`⚠️ [Cron] Failed to create audit log for ${tenant.id}:`, auditError);
        }

        results.success.push(tenant.id);
        console.log(`✅ [Cron] Successfully downgraded ${tenant.name} (${tenant.id})`);

      } catch (error: any) {
        console.error(`❌ [Cron] Failed to process ${tenant.id}:`, error);
        results.errors.push({
          tenantId: tenant.id,
          error: error.message || 'Unknown error'
        });
      }
    }

    const processingTime = Date.now() - startTime;
    
    console.log(`✅ [Cron] Completed: ${results.success.length} downgraded, ${results.errors.length} errors`);
    console.log(`⏱️ [Cron] Processing time: ${processingTime}ms`);

    return NextResponse.json({
      success: true,
      message: 'Subscription expiry processing completed',
      processed: results.success.length,
      errors: results.errors.length,
      processingTime: `${processingTime}ms`,
      timestamp: now.toISOString()
    });

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('❌ [Cron] Fatal error processing subscription expiry:', error);
    
    return NextResponse.json({
      error: 'Failed to process subscription expiry',
      processingTime: `${processingTime}ms`
    }, { status: 500 });
  }
}
