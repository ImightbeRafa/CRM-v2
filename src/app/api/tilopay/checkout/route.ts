import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { createPaymentLink } from '@/lib/tilopay';
import { getMembershipForToken } from '@/lib/selected-tenant';

export async function POST(request: NextRequest) {
  try {
    console.log('🔐 Tilopay checkout - Getting token...');
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      console.error('❌ No authentication token found');
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
    if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 });

    const planPricing: Record<string, { name: string; priceMinor: number; currency: string }> = {
      free: { name: 'FREE', priceMinor: 0, currency: 'USD' },
      basic: { name: 'BASIC', priceMinor: 2000, currency: 'USD' }, // $20.00 USD
      pro: { name: 'PRO', priceMinor: 0, currency: 'USD' }, // Coming soon
      enterprise: { name: 'ENTERPRISE', priceMinor: 0, currency: 'USD' }
    };

    const selected = planPricing[String(planId).toLowerCase()];
    if (!selected) return NextResponse.json({ error: 'Invalid planId' }, { status: 400 });

    if (selected.priceMinor <= 0) {
      return NextResponse.json({ status: 'success', data: { noPayment: true } });
    }

    const successUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&success=true`;
    const cancelUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&canceled=true`;
    const callbackUrl = `${process.env.NEXTAUTH_URL}/api/tilopay/webhook`;

    console.log('🔗 Creating Tilopay payment link...');
    const link = await createPaymentLink({
      amountMinor: selected.priceMinor,
      currency: selected.currency,
      description: `Plan ${selected.name} - Tenant ${tenantId}`,
      orderId: `${tenantId}-${selected.name}-${Date.now()}`,
      successUrl,
      cancelUrl,
      callbackUrl,
      customerEmail: membership.user.email
    });

    return NextResponse.json({ status: 'success', data: { checkoutUrl: link.url } });
  } catch (e: any) {
    console.error('❌ Tilopay checkout error:', e?.name || 'checkout_error');
    return NextResponse.json({ 
      error: 'Failed to create checkout',
      code: e?.name || 'checkout_error',
    }, { status: 500 });
  }
}


