/**
 * Telegram Webhook Configuration API
 * 
 * Admin endpoint to set or check the Telegram webhook.
 * Should be called once during deployment.
 * 
 * Usage:
 * - POST /api/bot/telegram/set-webhook - Set the webhook URL
 * - GET /api/bot/telegram/set-webhook - Get current webhook info
 * - DELETE /api/bot/telegram/set-webhook - Delete the webhook (for dev)
 */

import { NextRequest, NextResponse } from 'next/server';
import { setWebhook, deleteWebhook, getWebhookInfo, getTelegramBot } from '@/lib/bot/telegram';
import { timingSafeEqual } from 'crypto';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Secret key to protect this endpoint
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.NEXTAUTH_SECRET;

/**
 * Verify the request has the correct secret
 */
function verifySecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const secret = authHeader?.replace('Bearer ', '');
  
  // Allow from internal requests (same origin)
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  
  // In development, allow without secret
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  
  // SECURITY: Use timing-safe comparison to prevent timing attacks
  if (!secret || !WEBHOOK_SECRET) {
    return false;
  }
  
  try {
    const secretBuffer = Buffer.from(secret, 'utf8');
    const webhookSecretBuffer = Buffer.from(WEBHOOK_SECRET, 'utf8');
    
    // Lengths must match for timingSafeEqual
    if (secretBuffer.length !== webhookSecretBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(secretBuffer, webhookSecretBuffer);
  } catch {
    return false;
  }
}

/**
 * POST - Set the webhook URL
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authorization
    if (!verifySecret(request)) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or missing authorization' },
        { status: 401 }
      );
    }
    
    // Parse body for custom URL (optional)
    let webhookUrl: string;
    
    try {
      const body = await request.json();
      webhookUrl = body.webhookUrl;
    } catch {
      // Use default URL based on deployment
      webhookUrl = '';
    }
    
    // Default to production URL
    if (!webhookUrl) {
      const baseUrl = process.env.NEXTAUTH_URL || 'https://betsycrm.com';
      webhookUrl = `${baseUrl}/api/bot/telegram/webhook`;
    }
    
    console.log(`[Telegram Webhook] Setting webhook to: ${webhookUrl}`);
    
    const success = await setWebhook(webhookUrl);
    
    if (success) {
      return NextResponse.json({
        status: 'success',
        message: 'Webhook configurado exitosamente',
        data: {
          url: webhookUrl,
        },
      });
    } else {
      return NextResponse.json(
        { error: 'Failed', message: 'No se pudo configurar el webhook' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[Telegram Webhook] Error setting webhook:', error);
    return NextResponse.json(
      { error: 'Server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET - Get current webhook info
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authorization
    if (!verifySecret(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const info = await getWebhookInfo();
    
    return NextResponse.json({
      status: 'success',
      data: {
        url: info.url,
        hasCustomCertificate: info.has_custom_certificate,
        pendingUpdateCount: info.pending_update_count,
        maxConnections: info.max_connections,
        allowedUpdates: info.allowed_updates,
        lastErrorDate: info.last_error_date,
        lastErrorMessage: info.last_error_message,
      },
    });
  } catch (error: any) {
    console.error('[Telegram Webhook] Error getting info:', error);
    return NextResponse.json(
      { error: 'Server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove the webhook (for development/testing)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Verify authorization
    if (!verifySecret(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const success = await deleteWebhook();
    
    if (success) {
      return NextResponse.json({
        status: 'success',
        message: 'Webhook eliminado exitosamente',
      });
    } else {
      return NextResponse.json(
        { error: 'Failed', message: 'No se pudo eliminar el webhook' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[Telegram Webhook] Error deleting:', error);
    return NextResponse.json(
      { error: 'Server error', message: error.message },
      { status: 500 }
    );
  }
}

