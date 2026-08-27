import { NextResponse } from 'next/server';
import type { Prisma, SubscriptionTier, Tenant } from '@prisma/client';
import { prisma } from '@/lib/db';

export const BILLING_ACCESS_FLAG = 'billing_access';
export const BILLING_ENFORCEMENT_KILL_SWITCH = 'billing_write_enforcement';
const DAY_MS = 24 * 60 * 60 * 1000;

export type TenantAccessState = 'ACTIVE' | 'GRACE' | 'RESTRICTED';
export type BillingRolloutMode = 'OBSERVE' | 'WARN' | 'ENFORCE';

type FeatureFlagRow = {
  scope: string;
  key: string;
  enabled: boolean;
  config: Prisma.JsonValue | null;
};

export type TenantBillingSnapshot = Pick<
  Tenant,
  'id' | 'plan' | 'isActive' | 'subscriptionStatus' | 'trialEndsAt' | 'currentPeriodEnd' | 'createdAt' | 'settings'
>;

export interface TenantAccessEvaluation {
  tenantId: string;
  state: TenantAccessState;
  plan: SubscriptionTier;
  subscriptionStatus: string;
  rolloutMode: BillingRolloutMode;
  effectiveRolloutMode: BillingRolloutMode;
  enforcementKilled: boolean;
  wouldRestrict: boolean;
  enforced: boolean;
  writeAllowed: boolean;
  trialEndsAt: string | null;
  graceStartedAt: string | null;
  graceEndsAt: string | null;
  evaluatedAt: string;
  reason: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRolloutMode(value: unknown): BillingRolloutMode {
  const normalized = String(value || '').toUpperCase();
  return normalized === 'WARN' || normalized === 'ENFORCE' ? normalized : 'OBSERVE';
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function tableUnavailable(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate?.code === 'P2021'
    || candidate?.code === '42P01'
    || String(candidate?.message || '').includes('TenantFeatureFlag');
}

async function readBillingFlags(tenantId: string): Promise<FeatureFlagRow[]> {
  try {
    return await prisma.tenantFeatureFlag.findMany({
      where: {
        key: { in: [BILLING_ACCESS_FLAG, BILLING_ENFORCEMENT_KILL_SWITCH] },
        scope: { in: ['global', tenantId] },
      },
      select: { scope: true, key: true, enabled: true, config: true },
    });
  } catch (error) {
    // Additive rollout guarantee: old code and new code both run before the
    // approved SQL is applied. A missing table means observe-only, never lock.
    if (tableUnavailable(error)) return [];
    throw error;
  }
}

export function computeTenantAccess(
  tenant: TenantBillingSnapshot,
  flags: FeatureFlagRow[],
  now = new Date(),
): TenantAccessEvaluation {
  const status = String(tenant.subscriptionStatus || 'unknown').toLowerCase();
  const settings = asRecord(tenant.settings);
  const storedAccess = asRecord(settings.billingAccess);
  const tenantFlag = flags.find(flag => flag.scope === tenant.id && flag.key === BILLING_ACCESS_FLAG);
  const globalEnforcement = flags.find(flag => flag.scope === 'global' && flag.key === BILLING_ENFORCEMENT_KILL_SWITCH);
  const flagConfig = asRecord(tenantFlag?.config);
  const rolloutMode = parseRolloutMode(flagConfig.rolloutMode);
  const observeStartedAt = parseDate(flagConfig.observeStartedAt);
  const warnStartedAt = parseDate(flagConfig.warnStartedAt);
  const approvalAt = parseDate(flagConfig.enforcementApprovedAt);
  const enforcementApproved = Boolean(approvalAt && approvalAt <= now);
  const observeComplete = Boolean(observeStartedAt && observeStartedAt <= addDays(now, -7));
  const warnComplete = Boolean(warnStartedAt && warnStartedAt <= addDays(now, -7));
  const rolloutSequenceValid = Boolean(
    observeStartedAt
    && warnStartedAt
    && warnStartedAt >= addDays(observeStartedAt, 7)
    && approvalAt
    && approvalAt >= addDays(warnStartedAt, 7),
  );
  const enforcementKilled = !globalEnforcement?.enabled;
  const enforcementEnabled = Boolean(
    !enforcementKilled
    && tenantFlag?.enabled
    && rolloutMode === 'ENFORCE'
    && observeComplete
    && warnComplete
    && enforcementApproved
    && rolloutSequenceValid,
  );
  const effectiveRolloutMode: BillingRolloutMode = enforcementKilled || !tenantFlag?.enabled
    ? 'OBSERVE'
    : enforcementEnabled
      ? 'ENFORCE'
      : rolloutMode === 'WARN' && observeComplete && Boolean(warnStartedAt && warnStartedAt <= now)
        ? 'WARN'
        : rolloutMode === 'ENFORCE' && observeComplete && Boolean(warnStartedAt && warnStartedAt <= now)
          ? 'WARN'
          : 'OBSERVE';

  let state: TenantAccessState = 'ACTIVE';
  let reason = 'entitlement_active';
  let graceStartedAt: Date | null = null;
  let graceEndsAt: Date | null = null;

  if (!tenant.isActive) {
    state = 'RESTRICTED';
    reason = 'tenant_inactive';
  } else if (['expired', 'trial_expired', 'restricted'].includes(status)) {
    state = 'RESTRICTED';
    reason = 'explicitly_restricted';
  } else if (tenant.plan === 'FREE') {
    // Explicit FREE downgrades with no trial date remain active for backward
    // compatibility. Trial-backed FREE tenants use the normal grace window.
    const trialEnd = tenant.trialEndsAt;
    if (trialEnd && now >= trialEnd) {
      graceStartedAt = parseDate(storedAccess.graceStartedAt) || trialEnd;
      graceEndsAt = parseDate(storedAccess.graceEndsAt) || addDays(graceStartedAt, 7);
      state = now < graceEndsAt ? 'GRACE' : 'RESTRICTED';
      reason = state === 'GRACE' ? 'free_trial_grace' : 'free_trial_and_grace_expired';
    }
  } else {
    const paidThrough = tenant.currentPeriodEnd;
    const paidThroughCurrent = !paidThrough || paidThrough > now;
    const accessThroughPeriod = ['active', 'trialing', 'canceling', 'cancelled', 'canceled'].includes(status);

    const legacyUnknown = status === 'unknown' && !paidThrough;
    const pendingWithoutEntitlement = ['pending', 'incomplete'].includes(status) && !paidThrough;

    if (pendingWithoutEntitlement) {
      state = 'RESTRICTED';
      reason = 'paid_entitlement_not_confirmed';
    } else if (!(legacyUnknown || (paidThroughCurrent && accessThroughPeriod))) {
      const storedGraceEnd = parseDate(storedAccess.graceEndsAt);
      const legacyPaymentFailureEnd = status === 'payment_failed' && paidThrough && paidThrough > now
        ? paidThrough
        : null;
      graceEndsAt = storedGraceEnd || legacyPaymentFailureEnd;
      graceStartedAt = parseDate(storedAccess.graceStartedAt)
        || (graceEndsAt ? addDays(graceEndsAt, -7) : paidThrough)
        || now;
      graceEndsAt ||= addDays(graceStartedAt, 7);
      state = now < graceEndsAt ? 'GRACE' : 'RESTRICTED';
      reason = state === 'GRACE' ? 'paid_subscription_grace' : 'paid_subscription_grace_expired';
    }
  }

  const wouldRestrict = state === 'RESTRICTED';
  const enforced = wouldRestrict && enforcementEnabled;

  return {
    tenantId: tenant.id,
    state,
    plan: tenant.plan,
    subscriptionStatus: status,
    rolloutMode,
    effectiveRolloutMode,
    enforcementKilled,
    wouldRestrict,
    enforced,
    writeAllowed: !enforced,
    trialEndsAt: tenant.trialEndsAt?.toISOString() || null,
    graceStartedAt: graceStartedAt?.toISOString() || null,
    graceEndsAt: graceEndsAt?.toISOString() || null,
    evaluatedAt: now.toISOString(),
    reason,
  };
}

/** Fresh database evaluation. JWT subscription values are intentionally ignored. */
export async function evaluateTenantAccess(tenantId: string): Promise<TenantAccessEvaluation> {
  const [tenant, flags] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        plan: true,
        isActive: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        createdAt: true,
        settings: true,
      },
    }),
    readBillingFlags(tenantId),
  ]);

  if (!tenant) throw new Error('Tenant not found');
  return computeTenantAccess(tenant, flags);
}

export async function guardTenantWrite(
  tenantId: string,
  context: { channel: string; route?: string },
): Promise<{ allowed: true; access: TenantAccessEvaluation } | { allowed: false; access: TenantAccessEvaluation; response: NextResponse }> {
  const access = await evaluateTenantAccess(tenantId);

  if (access.wouldRestrict) {
    // Deliberately metadata-only: never include request bodies, customer data,
    // phone numbers, message text, or order identifiers in observe logs.
    console.warn('[BillingAccess] tenant write evaluation', {
      tenantId,
      state: access.state,
      rolloutMode: access.rolloutMode,
      effectiveRolloutMode: access.effectiveRolloutMode,
      enforced: access.enforced,
      channel: context.channel,
      route: context.route,
      count: 1,
    });
  }

  if (access.writeAllowed) return { allowed: true, access };

  return {
    allowed: false,
    access,
    response: NextResponse.json({
      error: 'Tenant billing access is restricted',
      code: 'billing_restricted',
      state: access.state,
      billingUrl: '/config?tab=billing',
    }, { status: 402 }),
  };
}

/** Website intake is allowed during restriction, but its backlog is marked once. */
export async function markRestrictedBacklog(tenantId: string, access: TenantAccessEvaluation): Promise<void> {
  if (!access.wouldRestrict && access.state !== 'RESTRICTED') return;

  await prisma.$executeRaw`
    UPDATE "Tenant"
    SET "settings" = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE("settings", '{}'::jsonb),
          '{billingAccess}',
          COALESCE("settings" -> 'billingAccess', '{}'::jsonb),
          true
        ),
        '{billingAccess,restrictedBacklog}',
        'true'::jsonb,
        true
      ),
      '{billingAccess,restrictedBacklogMarkedAt}',
      to_jsonb(${access.evaluatedAt}::text),
      true
    )
    WHERE "id" = ${tenantId}
      AND ("settings" #>> '{billingAccess,restrictedBacklog}') IS DISTINCT FROM 'true'
  `;
}

/** Persist a fixed seven-day grace window without overloading currentPeriodEnd. */
export async function startTenantBillingGrace(tenantId: string, now = new Date()) {
  const graceEndsAt = addDays(now, 7);
  const nowIso = now.toISOString();
  const graceEndsAtIso = graceEndsAt.toISOString();
  const rows = await prisma.$queryRaw<Array<{ graceStartedAt: string | null; graceEndsAt: string | null }>>`
    UPDATE "Tenant"
    SET "subscriptionStatus" = 'payment_failed',
        "updatedAt" = ${now},
        "settings" = CASE
          WHEN ("settings" #>> '{billingAccess,graceEndsAt}') IS NOT NULL
            AND ("settings" #>> '{billingAccess,graceEndsAt}') > ${nowIso}
          THEN "settings"
          ELSE jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE("settings", '{}'::jsonb),
                '{billingAccess}',
                COALESCE("settings" -> 'billingAccess', '{}'::jsonb),
                true
              ),
              '{billingAccess,graceStartedAt}',
              to_jsonb(${nowIso}::text),
              true
            ),
            '{billingAccess,graceEndsAt}',
            to_jsonb(${graceEndsAtIso}::text),
            true
          )
        END
    WHERE "id" = ${tenantId}
    RETURNING
      "settings" #>> '{billingAccess,graceStartedAt}' AS "graceStartedAt",
      "settings" #>> '{billingAccess,graceEndsAt}' AS "graceEndsAt"
  `;

  const persisted = rows[0];
  return {
    graceStartedAt: persisted?.graceStartedAt ? new Date(persisted.graceStartedAt) : now,
    graceEndsAt: persisted?.graceEndsAt ? new Date(persisted.graceEndsAt) : graceEndsAt,
  };
}
