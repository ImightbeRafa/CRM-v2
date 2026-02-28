import https from 'https';
import type { CorreosWSCredentials, TokenRequest } from './types';

const TOKEN_URL = new URL('https://servicios.correos.go.cr:442/Token/authenticate');
const TOKEN_TTL_MS = 4 * 60 * 1000; // 4 minutes (tokens expire at 5 min)
const REQUEST_TIMEOUT_MS = 60_000;

// Per-username token cache so different tenants/credentials don't share tokens
const tokenCache = new Map<string, { token: string; exp: number }>();

/**
 * Perform an HTTPS POST using Node.js native `https.request()`.
 * Bypasses axios entirely to avoid webpack bundling issues on Vercel
 * where the bundled http adapter hangs on non-standard ports.
 */
function httpsPost(url: URL, body: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
      servername: url.hostname, // explicit SNI
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Correos token request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        console.log('[CorreosToken] TCP connected');
      });
      if ('on' in socket && typeof (socket as any).on === 'function') {
        (socket as any).on('secureConnect', () => {
          const tlsSock = socket as import('tls').TLSSocket;
          console.log(
            `[CorreosToken] TLS handshake complete — ` +
            `protocol=${tlsSock.getProtocol()}, ` +
            `cipher=${tlsSock.getCipher()?.name}`
          );
        });
      }
    });

    req.on('error', (err) => {
      reject(new Error(`Correos token auth network error: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

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

    const res = await httpsPost(TOKEN_URL, JSON.stringify(payload));

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Correos token auth failed (${res.statusCode})`);
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
