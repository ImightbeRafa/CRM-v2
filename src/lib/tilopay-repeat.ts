export class TilopayCancellationError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_configured' | 'authentication_failed' | 'provider_rejected',
  ) {
    super(message);
    this.name = 'TilopayCancellationError';
  }
}

/** Cancel a Repeat plan with Tilopay before changing local subscription state. */
export async function cancelTilopayRepeatPlan(subscriptionId: string): Promise<void> {
  const apiUser = process.env.TILOPAY_USER;
  const apiPassword = process.env.TILOPAY_PASSWORD;
  const apiBaseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

  if (!apiUser || !apiPassword) {
    throw new TilopayCancellationError('Payment provider is not configured', 'not_configured');
  }

  const loginResponse = await fetch(`${apiBaseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiuser: apiUser, password: apiPassword }),
  });

  if (!loginResponse.ok) {
    throw new TilopayCancellationError('Payment provider authentication failed', 'authentication_failed');
  }

  const loginData = await loginResponse.json().catch(() => null) as { access_token?: string } | null;
  if (!loginData?.access_token) {
    throw new TilopayCancellationError('Payment provider authentication failed', 'authentication_failed');
  }

  const cancelResponse = await fetch(`${apiBaseUrl}/unsubscribePlan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginData.access_token}`,
    },
    body: JSON.stringify({ id_plan: subscriptionId }),
  });
  const cancelData = await cancelResponse.json().catch(() => null) as { type?: string | number } | null;

  if (!cancelResponse.ok || String(cancelData?.type || '') !== '200') {
    throw new TilopayCancellationError('Payment provider did not confirm cancellation', 'provider_rejected');
  }
}
