import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { createPaymentLink } from '@/lib/tilopay';

export async function POST(request: NextRequest) {
  try {
    console.log('🔐 Tilopay checkout - Getting token...');
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      console.error('❌ No authentication token found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log('✅ Token found for:', token.email);

    const { planId } = await request.json();
    console.log('📦 Plan requested:', planId);
    
    if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 });

    const planPricing: Record<string, { name: string; priceMinor: number; currency: string }> = {
      free: { name: 'FREE', priceMinor: 0, currency: 'CRC' },
      basic: { name: 'BASIC', priceMinor: 15000, currency: 'CRC' },
      pro: { name: 'PRO', priceMinor: 45000, currency: 'CRC' },
      enterprise: { name: 'ENTERPRISE', priceMinor: 0, currency: 'CRC' }
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
      description: `Plan ${selected.name} - Tenant ${token.tenantId}`,
      orderId: `${token.tenantId}-${selected.name}-${Date.now()}`,
      successUrl,
      cancelUrl,
      callbackUrl,
      customerEmail: token.email as string
    });

    console.log('✅ Payment link created:', link.url);
    return NextResponse.json({ status: 'success', data: { checkoutUrl: link.url } });
  } catch (e: any) {
    console.error('❌ Tilopay checkout error:', e);
    return NextResponse.json({ 
      error: e?.message || 'Failed to create checkout',
      stack: e?.stack 
    }, { status: 500 });
  }
}


