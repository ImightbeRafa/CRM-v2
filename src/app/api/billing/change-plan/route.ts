import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const tenantId = user.memberships[0].tenantId;

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
    // Paid price 0 (enterprise handled offline)
    await prisma.tenant.update({ where: { id: tenantId }, data: { plan: selectedPlan.name as any, subscriptionStatus: 'pending' } });
    return NextResponse.json({ status: 'success', data: { plan: selectedPlan.name, status: 'pending' } });
  } catch (error) {
    console.error('Error changing plan:', error);
    return NextResponse.json(
      { error: 'Failed to change plan' },
      { status: 500 }
    );
  }
}

