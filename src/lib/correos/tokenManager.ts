import type { CorreosWSCredentials, TokenRequest } from './types';

const TOKEN_URL = 'https://servicios.correos.go.cr:442/Token/authenticate';
const TOKEN_TTL_MS = 4 * 60 * 1000; // 4 minutes (tokens expire at 5 min)

let cachedToken: { token: string; exp: number } | null = null;

export class CorreosTokenManager {
  private credentials: CorreosWSCredentials;

  constructor(credentials: CorreosWSCredentials) {
    this.credentials = credentials;
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && now < cachedToken.exp) {
      return cachedToken.token;
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
      throw new Error(`Correos token auth failed (${res.status}): ${rawBody}`);
    }

    // The endpoint may return:
    //  - A plain string like "Bearer eyJ..." or just "eyJ..."
    //  - A JSON object like { "token": "...", ... }
    let token: string | undefined;

    const trimmed = rawBody.trim();
    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed);
        token = data.token ?? data.Token ?? data.access_token;
      } catch {
        throw new Error(`Correos token auth returned invalid JSON: ${trimmed.slice(0, 300)}`);
      }
    } else {
      // Plain-text token — strip "Bearer " prefix if present
      token = trimmed.startsWith('Bearer ') ? trimmed.slice(7) : trimmed;
    }

    if (!token || typeof token !== 'string') {
      throw new Error(
        `Correos token auth returned unexpected payload: ${trimmed.slice(0, 300)}`
      );
    }

    cachedToken = { token, exp: Date.now() + TOKEN_TTL_MS };
    return token;
  }

  invalidate(): void {
    cachedToken = null;
  }
}
