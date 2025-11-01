import { prisma } from './db';

/**
 * Check if a tenant's trial has expired
 * Returns true if trial has expired (FREE plan and past trialEndsAt date)
 * Returns false if on a paid plan (trial doesn't apply to paid plans)
 */
export async function isTrialExpired(tenantId: string): Promise<boolean> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        plan: true,
        trialEndsAt: true,
        createdAt: true,
        subscriptionStatus: true
      }
    });

    if (!tenant) {
      return false; // Can't determine, assume not expired
    }

    // Handle plan as enum or string - normalize to uppercase string for comparison
    const normalizedPlan = tenant.plan ? String(tenant.plan).trim().toUpperCase() : null;

    // CRITICAL: If on a paid plan (BASIC, PRO, etc.), trial doesn't apply - access should be allowed
    // This is the key check - paid plans bypass trial restrictions
    if (normalizedPlan && normalizedPlan !== 'FREE' && normalizedPlan !== '') {
      console.log(`✅ Tenant ${tenantId} on paid plan (${normalizedPlan}) - trial restrictions bypassed`);
      return false; // Not expired (trial doesn't apply to paid plans)
    }

    // If subscription is active on a FREE plan, check trial status
    // Otherwise, check if trial has expired
    const now = new Date();
    const trialEndsAt = tenant.trialEndsAt || new Date(tenant.createdAt.getTime() + 15 * 24 * 60 * 60 * 1000);
    
    // Trial expired if:
    // 1. Plan is FREE
    // 2. Current time is past trialEndsAt
    const expired = now >= trialEndsAt;
    
    if (expired) {
      console.log(`⚠️ Trial expired for tenant ${tenantId} (FREE plan, expired on ${trialEndsAt.toISOString()})`);
    }
    
    return expired;
  } catch (error) {
    console.error('Error checking trial expiration:', error);
    return false; // On error, don't block access
  }
}

/**
 * Check if subscription is active (not expired/canceled)
 * Returns true if:
 * - On a paid plan (BASIC, PRO) with active subscription, OR
 * - On FREE plan with active trial (not expired)
 */
export async function isSubscriptionActive(tenantId: string): Promise<boolean> {
  console.log(`🚀 [TRIAL-ENFORCEMENT] isSubscriptionActive called for tenant: ${tenantId}`);
  
  try {
    // Use the same query approach as billing API - direct tenant lookup
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true
      }
    });

    console.log(`🔍 [TRIAL-ENFORCEMENT] Tenant query result:`, {
      found: !!tenant,
      plan: tenant?.plan,
      subscriptionStatus: tenant?.subscriptionStatus,
      planType: typeof tenant?.plan,
      statusType: typeof tenant?.subscriptionStatus
    });

    if (!tenant) {
      console.error(`❌ [TRIAL-ENFORCEMENT] Tenant ${tenantId} not found in database`);
      return false;
    }

    // Handle plan as enum or string - normalize to uppercase string for comparison
    // Plan can be: 'FREE', 'BASIC', 'PRO' (enum SubscriptionTier)
    // CRITICAL: Plan might be enum, so convert to string properly
    let planValue: string | null = null;
    if (tenant.plan !== null && tenant.plan !== undefined) {
      // Handle both enum and string types
      const planStr = String(tenant.plan);
      planValue = planStr.trim().toUpperCase();
    }
    
    let statusValue: string | null = null;
    if (tenant.subscriptionStatus !== null && tenant.subscriptionStatus !== undefined) {
      statusValue = String(tenant.subscriptionStatus).trim().toLowerCase();
    }
    
    // Normalize plan and status strings (trim whitespace, handle case)
    const normalizedPlan = planValue;
    const normalizedStatus = statusValue;

    // Debug logging - CRITICAL for troubleshooting
    console.log(`🔍 [TRIAL-ENFORCEMENT] isSubscriptionActive check for tenant ${tenantId}:`, {
      rawPlan: tenant.plan,
      rawPlanType: typeof tenant.plan,
      normalizedPlan,
      rawStatus: tenant.subscriptionStatus,
      rawStatusType: typeof tenant.subscriptionStatus,
      normalizedStatus,
      planIsFree: normalizedPlan === 'FREE',
      planIsNull: normalizedPlan === null,
      planIsBasic: normalizedPlan === 'BASIC',
      planIsPro: normalizedPlan === 'PRO',
      statusIsActive: normalizedStatus === 'active',
      statusIsNull: normalizedStatus === null
    });

    // CRITICAL: If on a paid plan (BASIC, PRO, etc.), check subscription status
    // IMPORTANT: Match billing API logic - null/undefined defaults to 'active'
    // For paid plans, we ALWAYS allow access UNLESS status is explicitly canceled/expired/past_due
    if (normalizedPlan && normalizedPlan !== 'FREE' && normalizedPlan !== '') {
      // Paid plan - check subscription status
      // Allow if: active, null, undefined, empty, OR any status that's not explicitly blocking
      // Only block if status is explicitly: canceled, expired, past_due
      const blockingStatuses = ['canceled', 'expired', 'past_due'];
      const isBlocked = normalizedStatus && blockingStatuses.includes(normalizedStatus);
      
      if (!isBlocked) {
        // Not blocked - allow access (matches billing API: status || 'active')
        console.log(`✅ [TRIAL-ENFORCEMENT] Tenant ${tenantId} on paid plan (${normalizedPlan}) with subscription status '${tenant.subscriptionStatus}' (normalized: '${normalizedStatus || 'null/active'}') - ACCESS ALLOWED`);
        return true;
      } else {
        console.log(`⚠️ [TRIAL-ENFORCEMENT] Tenant ${tenantId} on paid plan (${normalizedPlan}) but subscription status is '${tenant.subscriptionStatus}' (normalized: '${normalizedStatus}') - ACCESS RESTRICTED (blocked status)`);
        return false; // Paid plan but subscription explicitly blocked
      }
    }

    // If FREE plan, check if trial is still active
    if (normalizedPlan === 'FREE' || !normalizedPlan || normalizedPlan === '') {
      const now = new Date();
      const trialEndsAt = tenant.trialEndsAt || new Date(tenant.createdAt.getTime() + 15 * 24 * 60 * 60 * 1000);
      const trialActive = now < trialEndsAt;
      if (!trialActive) {
        console.log(`⚠️ Tenant ${tenantId} on FREE plan with expired trial - access restricted`);
      } else {
        console.log(`✅ Tenant ${tenantId} on FREE plan with active trial - access allowed`);
      }
      return trialActive; // Active if trial hasn't expired
    }

    // Fallback: if we somehow get here, be permissive for unknown plans
    console.log(`⚠️ Tenant ${tenantId} has unknown plan '${tenant.plan}' - allowing access`);
    return true;
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return false;
  }
}

