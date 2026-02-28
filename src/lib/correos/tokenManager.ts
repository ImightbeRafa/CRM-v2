import type { CorreosWSCredentials, TokenRequest } from './types';
import { correosTokenHttp } from './http';

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

    let rawBody: string;
    try {
      const res = await correosTokenHttp.post(TOKEN_URL, payload, {
        transformResponse: [(data: any) => data], // keep raw string, don't auto-parse JSON
      });
      rawBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    } catch (err: any) {
      if (err.response) {
        throw new Error(`Correos token auth failed (${err.response.status})`);
      }
      throw new Error(`Correos token auth network error: ${err.message}`);
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
