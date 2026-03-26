import crypto from 'crypto';

const META_PIXEL_ID = '837653306013618';
const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/${META_PIXEL_ID}/events`;

function sha256Hash(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

interface CAPIEventParams {
  eventName: string;
  eventId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  currency?: string;
  value?: number;
  sourceUrl?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
}

/**
 * Send a server-side event to Meta Conversions API.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export function sendCAPIEvent(params: CAPIEventParams): void {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!accessToken) {
    return;
  }

  const userData: Record<string, string> = {};

  if (params.email) {
    userData.em = sha256Hash(params.email);
  }
  if (params.phone) {
    const digits = params.phone.replace(/\D/g, '');
    userData.ph = sha256Hash(digits);
  }
  if (params.firstName) {
    userData.fn = sha256Hash(params.firstName);
  }
  if (params.lastName) {
    userData.ln = sha256Hash(params.lastName);
  }
  if (params.clientIpAddress) {
    userData.client_ip_address = params.clientIpAddress;
  }
  if (params.clientUserAgent) {
    userData.client_user_agent = params.clientUserAgent;
  }

  const eventData: Record<string, any> = {
    event_name: params.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: params.eventId,
    action_source: 'website',
    user_data: userData,
  };

  if (params.sourceUrl) {
    eventData.event_source_url = params.sourceUrl;
  }

  if (params.value !== undefined || params.currency) {
    eventData.custom_data = {};
    if (params.value !== undefined) {
      eventData.custom_data.value = params.value;
    }
    if (params.currency) {
      eventData.custom_data.currency = params.currency;
    }
  }

  const payload = JSON.stringify({
    data: [eventData],
    access_token: accessToken,
  });

  fetch(GRAPH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => 'no body');
        console.error(`[meta-capi] ${params.eventName} failed (${res.status}): ${text}`);
      }
    })
    .catch((err) => {
      console.error(`[meta-capi] ${params.eventName} network error:`, err?.message);
    });
}
