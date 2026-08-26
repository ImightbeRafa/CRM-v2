import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken } from '@/lib/selected-tenant';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await getMembershipForToken(token);
    if (!membership) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    if (membership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the tenant owner can manage billing' }, { status: 403 });
    }

    const tenantId = membership.tenantId;

    const { planId } = await request.json();

    if (!planId) {
      return NextResponse.json({ error: 'Plan ID required' }, { status: 400 });
    }

    // Define pricing for each plan (Tilopay only)
    const planPricing: Record<string, { name: string; price: number }> = {
      free: { name: 'FREE', price: 0 },
      basic: { name: 'BASIC', price: 20 }, // $20 USD
      pro: { name: 'PRO', price: 45 }, // $45 USD
      enterprise: { name: 'ENTERPRISE', price: 0 }
    };

    const selectedPlan = planPricing[planId.toLowerCase()];
    if (!selectedPlan) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 });
    }

    // Handle free plan (downgrade)
    if (planId.toLowerCase() === 'free') {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: 'FREE',
          subscriptionStatus: 'active',
          currentPeriodEnd: null,
          tilopaySubscriptionId: null
        }
      });

      return NextResponse.json({
        status: 'success',
        data: { plan: 'FREE' }
      });
    }

    // Use Tilopay exclusively
    if (selectedPlan.price > 0) {
      console.log('🔄 Creating Tilopay checkout for plan:', planId);
      console.log('📍 Tilopay endpoint:', `${process.env.NEXTAUTH_URL}/api/tilopay/checkout`);
      
      try {
        const resp = await fetch(`${process.env.NEXTAUTH_URL}/api/tilopay/checkout`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            cookie: request.headers.get('cookie') || '' 
          },
          body: JSON.stringify({ planId })
        });
        
        const data = await resp.json();
        console.log('📦 Tilopay response status:', resp.status);
        console.log('📦 Tilopay response data:', data);
        
        if (!resp.ok) {
          console.error('❌ Tilopay checkout failed:', data);
          return NextResponse.json({ 
            error: data.error || 'Tilopay checkout failed', 
            details: data 
          }, { status: 500 });
        }
        
        if (data.data?.checkoutUrl) {
          console.log('✅ Checkout URL created:', data.data.checkoutUrl);
          return NextResponse.json({ status: 'success', data: { checkoutUrl: data.data.checkoutUrl } });
        }
        
        return NextResponse.json({ status: 'success', data: { plan: selectedPlan.name, status: 'pending' } });
      } catch (fetchError: any) {
        console.error('❌ Fetch error calling Tilopay:', fetchError);
        return NextResponse.json({ 
          error: 'Failed to connect to Tilopay service', 
          details: fetchError.message 
        }, { status: 500 });
      }
    }
    // Enterprise is activated only through the audited offline-contract route.
    return NextResponse.json({
      error: 'Enterprise plans require an approved offline contract',
      code: 'enterprise_contract_required',
    }, { status: 409 });
  } catch (error) {
    console.error('Error changing plan:', error);
    return NextResponse.json(
      { error: 'Failed to change plan' },
      { status: 500 }
    );
  }
}

