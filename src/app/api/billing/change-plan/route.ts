import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
// Stripe removed; using Tilopay exclusively
import { NextResponse as _NR } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { planId } = await request.json();

    if (!planId) {
      return NextResponse.json({ error: 'Plan ID required' }, { status: 400 });
    }

    const tenantId = token.tenantId as string;

    // Define pricing for each plan
    const planPricing: Record<string, { name: string; stripePriceId?: string; price: number }> = {
      free: { name: 'FREE', price: 0 },
      basic: { 
        name: 'BASIC', 
        price: 15000,
        stripePriceId: process.env.NEXT_PUBLIC_STRIPE_BASIC_PRICE_ID 
      },
      pro: { 
        name: 'PRO', 
        price: 45000,
        stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID 
      },
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
          stripeCustomerId: null,
          stripeSubscriptionId: null
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

