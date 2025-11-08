/**
 * Tilopay API v1 Integration
 * API Endpoint: https://api.tilopay.com/v1/
 * Admin/SDK: https://app.tilopay.com/
 * 
 * Tilopay uses API Key authentication directly (no separate login required)
 */

const TILOPAY_BASE_URL = process.env.TILOPAY_BASE_URL || 'https://api.tilopay.com/v1';
const TILOPAY_API_KEY = process.env.TILOPAY_API_KEY || '';
const TILOPAY_API_USER = process.env.TILOPAY_USER || '';
const TILOPAY_API_PASSWORD = process.env.TILOPAY_PASSWORD || '';

/**
 * Make authenticated request to Tilopay API
 */
async function tilopayRequest(endpoint: string, options: RequestInit = {}) {
  if (!TILOPAY_API_KEY) {
    throw new Error('TILOPAY_API_KEY is not configured');
  }

  const url = `${TILOPAY_BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'key': TILOPAY_API_KEY, // Tilopay uses 'key' header for authentication
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tilopay API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Create a one-time payment link
 */
export async function createPaymentLink(input: {
  amountMinor: number;
  currency: string;
  description: string;
  orderId: string;
  successUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  customerEmail?: string;
}): Promise<{ url: string; transactionId?: string }> {
  
  const data = await tilopayRequest('/captures', {
    method: 'POST',
    body: JSON.stringify({
      key: TILOPAY_API_KEY,
      amount: input.amountMinor,
      currency: input.currency,
      description: input.description,
      order_id: input.orderId || `order-${Date.now()}`,
      redirect_success: input.successUrl,
      redirect_error: input.cancelUrl,
      notification_url: input.callbackUrl,
      email: input.customerEmail || ''
    })
  });

  return {
    url: data.payment_url || data.url || data.link,
    transactionId: data.transaction_id || data.id
  };
}

/**
 * Create a recurring subscription plan
 */
export async function createSubscriptionPlan(input: {
  planName: string;
  amount: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  description?: string;
}): Promise<{ planId: string }> {
  
  const data = await tilopayRequest('/createPlanRepeat', {
    method: 'POST',
    body: JSON.stringify({
      key: TILOPAY_API_KEY,
      nombre: input.planName,
      monto: input.amount,
      moneda: input.currency,
      intervalo: input.interval === 'monthly' ? 'month' : 'year',
      descripcion: input.description || input.planName
    })
  });

  return { planId: data.plan_id || data.id };
}

/**
 * Subscribe a customer to a plan
 */
export async function subscribeCustomer(input: {
  planId: string;
  customerEmail: string;
  customerName: string;
  orderId: string;
  successUrl: string;
  errorUrl: string;
  callbackUrl: string;
}): Promise<{ subscriptionUrl: string; subscriptionId?: string }> {
  
  const data = await tilopayRequest('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      key: TILOPAY_API_KEY,
      plan_id: input.planId,
      email: input.customerEmail,
      nombre: input.customerName,
      order_id: input.orderId,
      redirect_success: input.successUrl,
      redirect_error: input.errorUrl,
      notification_url: input.callbackUrl
    })
  });

  return {
    subscriptionUrl: data.subscription_url || data.url,
    subscriptionId: data.subscription_id || data.id
  };
}

/**
 * Pause a subscription
 */
export async function pauseSubscription(subscriptionId: string): Promise<{ success: boolean }> {
  const data = await tilopayRequest('/pauseSuscriptorRepeat', {
    method: 'POST',
    body: JSON.stringify({
      key: TILOPAY_API_KEY,
      subscription_id: subscriptionId
    })
  });

  return { success: data.success || data.status === 'paused' };
}

/**
 * Cancel/delete a subscription
 */
export async function cancelSubscription(subscriptionId: string): Promise<{ success: boolean }> {
  const data = await tilopayRequest('/deleteSuscriptorRepeat', {
    method: 'POST',
    body: JSON.stringify({
      key: TILOPAY_API_KEY,
      subscription_id: subscriptionId
    })
  });

  return { success: data.success || data.status === 'canceled' };
}

/**
 * Get subscription details
 */
export async function getSubscription(subscriptionId: string) {
  return tilopayRequest(`/subscriptions/${subscriptionId}`, {
    method: 'GET'
  });
}

/**
 * Get transaction status
 */
export async function getTransactionStatus(transactionId: string) {
  return tilopayRequest(`/transactions/${transactionId}`, {
    method: 'GET'
  });
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSharedSecret(req: Request): boolean {
  const expected = (process.env.TILOPAY_WEBHOOK_SECRET || '').trim();
  if (!expected) return true; // Allow if not set (development mode)
  
  const provided = (req.headers.get('x-tilopay-secret') || req.headers.get('signature') || '').trim();
  return !!provided && provided === expected;
}

