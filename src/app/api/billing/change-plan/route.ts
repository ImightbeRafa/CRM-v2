import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import Stripe from 'stripe';

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-09-30.clover',
    })
  : null;

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
    }
    
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

    // For paid plans, create Stripe checkout session
    if (!selectedPlan.stripePriceId) {
      return NextResponse.json(
        { error: 'Stripe configuration missing for this plan' },
        { status: 500 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: selectedPlan.stripePriceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXTAUTH_URL}/config?tab=billing&success=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/config?tab=billing&canceled=true`,
      customer_email: token.email as string,
      metadata: {
        tenantId: tenantId,
        planId: planId,
      },
      subscription_data: {
        metadata: {
          tenantId: tenantId,
        },
      },
    });

    return NextResponse.json({
      status: 'success',
      data: {
        checkoutUrl: session.url
      }
    });
  } catch (error) {
    console.error('Error changing plan:', error);
    return NextResponse.json(
      { error: 'Failed to change plan' },
      { status: 500 }
    );
  }
}

