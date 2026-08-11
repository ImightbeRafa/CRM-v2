import { createHmac } from 'crypto';
import { timingSafeEqualString } from '@/lib/security';

const TILOPAY_BASE_URL = process.env.TILOPAY_BASE_URL || 'https://api.tilopay.com/v1';
const TILOPAY_API_KEY = process.env.TILOPAY_API_KEY || '';
const TILOPAY_USER = process.env.TILOPAY_USER || '';
const TILOPAY_PASSWORD = process.env.TILOPAY_PASSWORD || '';

type TilopayAuthResponse = {
  token: string;
  expiresIn?: number;
};

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!TILOPAY_API_KEY || !TILOPAY_USER || !TILOPAY_PASSWORD) {
    throw new Error('Tilopay credentials are not configured');
  }

  const now = Date.now();
  if (cachedToken && now < cachedToken.exp) return cachedToken.token;

  // Tilopay v1 API uses direct authentication with API key + credentials
  // Try different auth endpoints
  const authEndpoints = ['/login', '/auth', '/authenticate'];
  
  let res: Response | null = null;
  let lastError = '';
  
  for (const endpoint of authEndpoints) {
    try {
      res = await fetch(`${TILOPAY_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'x-api-key': TILOPAY_API_KEY,
          'key': TILOPAY_API_KEY // Some APIs use 'key' header
        },
        body: JSON.stringify({ 
          usuario: TILOPAY_USER, 
          password: TILOPAY_PASSWORD,
          user: TILOPAY_USER, // Try alternative field name
          pass: TILOPAY_PASSWORD // Try alternative field name
        })
      });
      
      if (res.ok) break;
      
      lastError = `${endpoint}: ${res.status}`;
    } catch (e: any) {
      lastError = `${endpoint}: ${e.message}`;
    }
  }
  
  if (!res || !res.ok) {
    const t = res ? await res.text() : lastError;
    throw new Error(`Tilopay auth failed (tried ${authEndpoints.join(', ')}): ${t}`);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tilopay auth failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as TilopayAuthResponse;
  const ttlMs = (data.expiresIn ?? 50) * 1000;
  cachedToken = { token: data.token, exp: Date.now() + ttlMs };
  return data.token;
}

export async function createPaymentLink(input: {
  amountMinor: number;
  currency: string;
  description: string;
  orderId: string;
  successUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  customerEmail?: string;
}): Promise<{ url: string; transactionId?: string }>
{
  const token = await getAccessToken();
  const res = await fetch(`${TILOPAY_BASE_URL}/transactions/payment-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-api-key': TILOPAY_API_KEY
    },
    body: JSON.stringify({
      monto: input.amountMinor,
      moneda: input.currency,
      descripcion: input.description,
      referencia: input.orderId,
      urls: { exito: input.successUrl, cancelado: input.cancelUrl, notificacion: input.callbackUrl },
      cliente: input.customerEmail ? { email: input.customerEmail } : undefined
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tilopay link failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return { url: data.url || data.payment_url || data.link, transactionId: data.id };
}

export async function getTransactionStatus(id: string) {
  const token = await getAccessToken();
  const res = await fetch(`${TILOPAY_BASE_URL}/transactions/${id}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-api-key': TILOPAY_API_KEY }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tilopay status failed: ${res.status} ${t}`);
  }
  return res.json();
}

/**
 * Verify Tilopay webhook authenticity
 *
 * Accepted methods (fail-closed when TILOPAY_WEBHOOK_SECRET is unset):
 * - x-tilopay-secret header (constant-time shared secret)
 * - hash-tilopay header = HMAC-SHA256(rawBody, secret) hex digest
 *
 * Presence of hash-tilopay alone is NOT sufficient.
 */
export function verifyWebhookSharedSecret(req: Request, body?: string): boolean {
  const expected = (process.env.TILOPAY_WEBHOOK_SECRET || '').trim();
  const providedSecret = (req.headers.get('x-tilopay-secret') || '').trim();
  const providedHash = (req.headers.get('hash-tilopay') || '').trim();

  if (!expected) {
    console.error('[Webhook Verification] TILOPAY_WEBHOOK_SECRET not configured — rejecting webhook');
    return false;
  }

  // Method 1: Simple shared secret (one-time payments)
  if (providedSecret && timingSafeEqualString(providedSecret, expected)) {
    return true;
  }

  // Method 2: HMAC-SHA256 of raw body (Repeat / signed payloads)
  if (providedHash && typeof body === 'string') {
    try {
      const computedHash = createHmac('sha256', expected).update(body, 'utf8').digest('hex');
      if (timingSafeEqualString(computedHash, providedHash)) {
        return true;
      }
    } catch (err) {
      console.error('[Webhook Verification] HMAC verification error:', err);
    }
  }

  console.error('[Webhook Verification] Invalid — no valid authentication method');
  return false;
}


