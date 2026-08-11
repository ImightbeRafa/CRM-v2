import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function logCallbackEvent(level: 'info' | 'warn' | 'error', message: string, data?: unknown, tenantId?: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] [Tilopay Callback] ${message}`, data ? data : '');

  if (level === 'error' || level === 'warn') {
    prisma.webhookLog.create({
      data: {
        tenantId: tenantId || 'unknown',
        level,
        message,
        data: data ? JSON.stringify(data) : null,
        source: 'tilopay-callback',
      },
    }).catch((err) => console.error('Failed to store callback log:', err));
  }
}

/**
 * Tilopay browser redirect callback.
 *
 * SECURITY: This endpoint is public and attacker-controllable. It MUST NOT
 * mutate subscription/plan state. Entitlements are applied only by verified
 * webhooks (/api/tilopay/webhook, /api/tilopay/webhook-repeat).
 *
 * This handler only redirects the user to the billing UI with a status hint.
 */
function redirectForPaymentStatus(status: 'success' | 'cancelled' | 'error') {
  const base = process.env.NEXTAUTH_URL || '';
  return NextResponse.redirect(`${base}/config?tab=billing&payment=${status}`);
}

export async function POST(request: NextRequest) {
  const callbackId = `callback_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  try {
    const contentType = request.headers.get('content-type') || '';
    let data: Record<string, unknown> = {};

    try {
      if (contentType.includes('application/json')) {
        data = (await request.json()) as Record<string, unknown>;
      } else if (contentType.includes('form')) {
        const formData = await request.formData();
        data = Object.fromEntries(formData.entries()) as Record<string, unknown>;
      } else {
        // Some gateways redirect with query params only
        data = Object.fromEntries(request.nextUrl.searchParams.entries());
      }
    } catch {
      data = Object.fromEntries(request.nextUrl.searchParams.entries());
    }

    // Log metadata only — never persist full payment payloads from an unauthenticated source
    logCallbackEvent('info', `Callback received [${callbackId}] (no entitlement mutation)`, {
      callbackId,
      hasOrderNumber: Boolean(data.orderNumber || data.referencia),
      message: data.message,
      status: data.status || data.estado,
    });

    const message = String(data.message || '').toLowerCase();
    const status = String(data.status || data.estado || '').toLowerCase();
    const isSuccess =
      (message === 'success' || status === 'approved' || status === 'success') &&
      !message.includes('cancel') &&
      !status.includes('cancel');
    const isCancelled =
      message.includes('cancel') ||
      status.includes('cancel') ||
      message.includes('cancelado');

    if (isSuccess) return redirectForPaymentStatus('success');
    if (isCancelled) return redirectForPaymentStatus('cancelled');
    return redirectForPaymentStatus('error');
  } catch (error) {
    console.error(`❌ [Tilopay Callback] Error [${callbackId}]:`, error);
    return redirectForPaymentStatus('error');
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
