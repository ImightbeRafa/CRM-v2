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

    const { feedback } = await request.json();
    const tenantId = token.tenantId as string;

    // Get tenant subscription info
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { 
        stripeSubscriptionId: true,
        plan: true
      }
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (tenant.plan === 'FREE') {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
    }

    // Cancel subscription in Stripe
    if (tenant.stripeSubscriptionId) {
      await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    // Update tenant
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        cancelAtPeriodEnd: true,
        subscriptionStatus: 'canceled'
      }
    });

    // Log feedback if provided
    if (feedback) {
      console.log(`Cancellation feedback from tenant ${tenantId}:`, feedback);
      // TODO: Store feedback in database for analysis
    }

    return NextResponse.json({
      status: 'success',
      data: {
        message: 'Subscription will be canceled at the end of the billing period'
      }
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}

