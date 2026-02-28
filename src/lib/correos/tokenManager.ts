import type { CorreosWSCredentials, TokenRequest } from './types';

const TOKEN_URL = 'https://servicios.correos.go.cr:442/Token/authenticate';
const TOKEN_TTL_MS = 4 * 60 * 1000; // 4 minutes (tokens expire at 5 min)

// Per-username token cache so different tenants/credentials don't share tokens
const tokenCache = new Map<string, { token: string; exp: number }>();

export class CorreosTokenManager {
  private credentials: CorreosWSCredentials;
  private cacheKey: string;

  constructor(credentials: CorreosWSCredentials) {
    this.credentials = credentials;
    this.cacheKey = credentials.username;
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

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const rawBody = await res.text();

    if (!res.ok) {
      throw new Error(`Correos token auth failed (${res.status})`);
    }

    let token: string | undefined;

    const trimmed = rawBody.trim();
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
