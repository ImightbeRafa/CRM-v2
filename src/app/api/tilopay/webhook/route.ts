import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyWebhookSharedSecret } from '@/lib/tilopay';

export async function POST(req: NextRequest) {
  try {
    if (!verifyWebhookSharedSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const status: string = String(body.estado || body.status || '').toLowerCase();
    const ref: string = String(body.referencia || body.reference || '');

    const [tenantId, planId] = ref.split('-');
    if (!tenantId || !planId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (['aprobada', 'approved', 'success', 'paid'].includes(status)) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: planId.toUpperCase() as any,
          subscriptionStatus: 'active',
          currentPeriodEnd: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          cancelAtPeriodEnd: false,
        }
      });
    } else if (['rechazada', 'failed', 'canceled'].includes(status)) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: 'past_due' }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Webhook error' }, { status: 500 });
  }
}


