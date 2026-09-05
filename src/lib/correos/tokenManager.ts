import type { CorreosWSCredentials, TokenRequest } from './types';
import { credentialTokenCacheKey } from './credential-select';
import { CorreosAuthError } from './auth-error';
import { getTokenUrl, getProxySecret, isProxyConfigured } from './proxy';

const TOKEN_TTL_MS = 4 * 60 * 1000; // 4 minutes (tokens expire at 5 min)
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_RETRY_STATUSES = new Set([502, 503, 504]);
const TOKEN_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTokenBody(body: string): string {
  return body
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/"(token|Token|access_token|password|Password|Username)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

// Per-username token cache so different tenants/credentials don't share tokens
const tokenCache = new Map<string, { token: string; exp: number }>();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: hard timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * POST to the token endpoint. When CORREOS_PROXY_URL is set, the request
 * goes through the Jetson proxy via Cloudflare Tunnel (standard HTTPS, port 443).
 * When not set (local dev), it goes directly to Correos :447.
 */
async function tokenPost(body: string): Promise<{ statusCode: number; body: string }> {
  const url = getTokenUrl();
  const secret = getProxySecret();
  const usingProxy = isProxyConfigured();

  console.log(`[CorreosToken] POST ${url} (via ${usingProxy ? 'proxy' : 'direct'})`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (usingProxy && secret) {
    headers['X-Correos-Secret'] = secret;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    const text = await res.text();
    const cfRay = res.headers.get('cf-ray') || '-';
    const contentType = res.headers.get('content-type') || '-';
    console.log(`[CorreosToken] Response status: ${res.status} cf-ray=${cfRay} content-type=${contentType}`);
    if (res.status < 200 || res.status >= 300) {
      console.warn(
        `[CorreosToken] Non-OK body (${text.length}b): ${sanitizeTokenBody(text) || '[empty]'}`,
      );
    }

    return { statusCode: res.status, body: text };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Correos token request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new Error(`Correos token auth network error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export class CorreosTokenManager {
  private credentials: CorreosWSCredentials;
  private cacheKey: string;

  constructor(credentials: CorreosWSCredentials) {
    this.credentials = credentials;
    this.cacheKey = credentialTokenCacheKey(credentials);
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    const cached = tokenCache.get(this.cacheKey);
    if (cached && now < cached.exp) {
      return cached.token;
    }

    const payload: TokenRequest = {
      Username: this.credentials.username,
      Password: this.credentials.password,
      Sistema: this.credentials.sistema,
    };

    let res: { statusCode: number; body: string } | undefined;
    for (let attempt = 1; attempt <= TOKEN_MAX_ATTEMPTS; attempt++) {
      res = await withTimeout(
        tokenPost(JSON.stringify(payload)),
        REQUEST_TIMEOUT_MS + 5_000,
        'Correos token request',
      );
      if (!TOKEN_RETRY_STATUSES.has(res.statusCode) || attempt === TOKEN_MAX_ATTEMPTS) {
        break;
      }
      const delay = 1_000 * attempt;
      console.warn(
        `[CorreosToken] Retrying after ${res.statusCode} (attempt ${attempt}/${TOKEN_MAX_ATTEMPTS}) in ${delay}ms`,
      );
      await sleep(delay);
    }

    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      throw new CorreosAuthError(res?.statusCode ?? 0);
    }

    let token: string | undefined;

    const trimmed = res.body.trim();
    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed);
        token = data.token ?? data.Token ?? data.access_token;
      } catch {
        throw new Error('Correos token auth returned invalid response');
      }
    } else {
      token = trimmed.startsWith('Bearer ') ? trimmed.slice(7) : trimmed;
    }

    if (!token || typeof token !== 'string') {
      throw new Error('Correos token auth returned unexpected payload');
    }

    tokenCache.set(this.cacheKey, { token, exp: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  invalidate(): void {
    tokenCache.delete(this.cacheKey);
  }
}
