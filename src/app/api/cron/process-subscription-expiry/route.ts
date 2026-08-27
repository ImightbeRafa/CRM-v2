import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { timingSafeEqualString } from '@/lib/security';

const DAY_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  return processExpiredSubscriptions(request);
}

export async function POST(request: NextRequest) {
  return processExpiredSubscriptions(request);
}

async function processExpiredSubscriptions(request: NextRequest) {
  const startTime = Date.now();
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = (process.env.CRON_SECRET || '').trim();

  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  if (!timingSafeEqualString(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where: {
      isActive: true,
      plan: { not: 'FREE' },
      AND: [
        {
          OR: [
            { subscriptionStatus: null },
            { subscriptionStatus: { not: 'expired' } },
          ],
        },
        {
          OR: [
            { currentPeriodEnd: { lte: now } },
            { subscriptionStatus: { in: ['payment_failed', 'past_due', 'grace'] } },
          ],
        },
      ],
    },
    select: {
      id: true,
      plan: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      settings: true,
      tilopaySubscriptionId: true,
    },
  });

  let graceStarted = 0;
  let stillInGrace = 0;
  let restricted = 0;
  let errors = 0;

  for (const tenant of tenants) {
    try {
      const status = String(tenant.subscriptionStatus || 'unknown').toLowerCase();
      const settings = asRecord(tenant.settings);
      const storedAccess = asRecord(settings.billingAccess);
      const storedStart = asDate(storedAccess.graceStartedAt);
      const storedEnd = asDate(storedAccess.graceEndsAt);
      const legacyFailureEnd = status === 'payment_failed'
        && tenant.currentPeriodEnd
        && tenant.currentPeriodEnd > now
        ? tenant.currentPeriodEnd
        : null;
      const graceEndsAt = storedEnd
        || legacyFailureEnd
        || new Date((tenant.currentPeriodEnd || now).getTime() + 7 * DAY_MS);
      const graceStartedAt = storedStart
        || (legacyFailureEnd ? new Date(legacyFailureEnd.getTime() - 7 * DAY_MS) : tenant.currentPeriodEnd)
        || now;

      if (now < graceEndsAt) {
        if (!storedStart || !storedEnd) {
          await prisma.$transaction(async tx => {
            await tx.$executeRaw`
              UPDATE "Tenant"
              SET "subscriptionStatus" = 'grace',
                  "updatedAt" = ${now},
                  "settings" = jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        COALESCE("settings", '{}'::jsonb),
                        '{billingAccess}',
                        COALESCE("settings" -> 'billingAccess', '{}'::jsonb),
                        true
                      ),
                      '{billingAccess,graceStartedAt}',
                      to_jsonb(${graceStartedAt.toISOString()}::text),
                      true
                    ),
                    '{billingAccess,graceEndsAt}',
                    to_jsonb(${graceEndsAt.toISOString()}::text),
                    true
                  )
              WHERE "id" = ${tenant.id}
            `;
            await tx.auditLog.create({
              data: {
                tenantId: tenant.id,
                userId: null,
                userName: 'Subscription Expiry Cron',
                userRole: 'SYSTEM',
                action: 'UPDATE',
                entityType: 'subscription',
                entityId: tenant.tilopaySubscriptionId || tenant.id,
                entityName: 'Billing grace started',
                oldValues: { plan: tenant.plan, status: tenant.subscriptionStatus },
                newValues: {
                  plan: tenant.plan,
                  status: 'grace',
                  graceStartedAt: graceStartedAt.toISOString(),
                  graceEndsAt: graceEndsAt.toISOString(),
                },
              },
            });
          });
          graceStarted += 1;
        } else {
          stillInGrace += 1;
        }
        continue;
      }

      await prisma.$transaction([
        prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            subscriptionStatus: 'expired',
            cancelAtPeriodEnd: false,
          },
        }),
        prisma.auditLog.create({
          data: {
            tenantId: tenant.id,
            userId: null,
            userName: 'Subscription Expiry Cron',
            userRole: 'SYSTEM',
            action: 'UPDATE',
            entityType: 'subscription',
            entityId: tenant.tilopaySubscriptionId || tenant.id,
            entityName: 'Billing grace expired',
            oldValues: { plan: tenant.plan, status: tenant.subscriptionStatus },
            newValues: {
              plan: tenant.plan,
              status: 'expired',
              graceEndsAt: graceEndsAt.toISOString(),
              note: 'Access restricted; tenant data and paid plan label preserved.',
            },
          },
        }),
      ]);
      restricted += 1;
    } catch (error) {
      errors += 1;
      console.error('[SubscriptionExpiry] Tenant processing failed', {
        code: error instanceof Error ? error.name : 'processing_error',
      });
    }
  }

  return NextResponse.json({
    success: errors === 0,
    counts: {
      candidates: tenants.length,
      graceStarted,
      stillInGrace,
      restricted,
      errors,
    },
    processingTimeMs: Date.now() - startTime,
  }, { status: errors === 0 ? 200 : 207 });
}
