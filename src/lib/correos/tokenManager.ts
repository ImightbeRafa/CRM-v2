import https from 'https';
import http from 'http';
import type { CorreosWSCredentials, TokenRequest } from './types';
import { getCorreosProxyAgent, getProxyDescription } from './proxy';

const TOKEN_URL = new URL('https://servicios.correos.go.cr:447/Token/authenticate');
const TOKEN_TTL_MS = 4 * 60 * 1000; // 4 minutes (tokens expire at 5 min)
const REQUEST_TIMEOUT_MS = 30_000;

// Per-username token cache so different tenants/credentials don't share tokens
const tokenCache = new Map<string, { token: string; exp: number }>();

/**
 * Hard timeout wrapper — ensures a promise rejects after `ms` regardless of
 * what the underlying operation does. This is critical when using proxy agents
 * because the agent's CONNECT phase can hang without triggering the request's
 * socket-level timeout.
 */
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
 * Perform an HTTPS POST using Node.js native `https.request()`.
 * When FIXIE_URL is set, uses HttpsProxyAgent to tunnel through the proxy.
 */
function httpsPost(url: URL, body: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const agent = getCorreosProxyAgent();
    const usingProxy = !!agent;

    console.log(
      `[CorreosToken] POST ${url.hostname}:${url.port}${url.pathname}` +
      ` (proxy: ${usingProxy ? getProxyDescription() : 'direct'})`
    );

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
      servername: url.hostname,
    };

    const req = https.request(options, (res) => {
      console.log(`[CorreosToken] Response status: ${res.statusCode}`);
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
      console.error('[CorreosToken] Socket timeout fired');
      req.destroy(new Error(`Correos token request socket timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('socket', (socket) => {
      console.log('[CorreosToken] Socket assigned to request');
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

/**
 * Test proxy connectivity by making a simple HTTPS request to a known-good
 * host through the proxy agent. Returns timing and status info.
 */
export async function testProxyConnectivity(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const agent = getCorreosProxyAgent();
  if (!agent) return { ok: true, ms: 0, detail: 'no proxy — direct connection' };

  const t0 = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, ms: Date.now() - t0, detail: 'proxy test timeout (15s)' });
    }, 15_000);

    const testReq = https.request(
      {
        hostname: 'www.google.com',
        port: 443,
        path: '/',
        method: 'HEAD',
        agent,
        timeout: 10_000,
        servername: 'www.google.com',
      },
      (res) => {
        clearTimeout(timer);
        res.resume();
        resolve({ ok: true, ms: Date.now() - t0, detail: `proxy OK, status=${res.statusCode}` });
      }
    );

    testReq.on('timeout', () => {
      clearTimeout(timer);
      testReq.destroy();
      resolve({ ok: false, ms: Date.now() - t0, detail: 'proxy request socket timeout' });
    });

    testReq.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, ms: Date.now() - t0, detail: `proxy error: ${err.message}` });
    });

    testReq.end();
  });
}

/**
 * Test proxy connectivity specifically to Correos token endpoint
 * (just TCP+TLS through proxy, using HEAD to avoid auth issues).
 */
export async function testProxyToCorreos(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const agent = getCorreosProxyAgent();
  if (!agent) return { ok: true, ms: 0, detail: 'no proxy — direct connection' };

  const t0 = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, ms: Date.now() - t0, detail: 'proxy→Correos timeout (20s)' });
    }, 20_000);

    const req = http.request(
      {
        hostname: new URL(process.env.FIXIE_URL!).hostname,
        port: Number(new URL(process.env.FIXIE_URL!).port) || 80,
        method: 'CONNECT',
        path: 'servicios.correos.go.cr:447',
        headers: {
          'Proxy-Authorization': 'Basic ' + Buffer.from(
            `${new URL(process.env.FIXIE_URL!).username}:${new URL(process.env.FIXIE_URL!).password}`
          ).toString('base64'),
        },
        timeout: 15_000,
      },
    );

    req.on('connect', (_res, socket) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: true, ms: Date.now() - t0, detail: `CONNECT tunnel established` });
    });

    req.on('timeout', () => {
      clearTimeout(timer);
      req.destroy();
      resolve({ ok: false, ms: Date.now() - t0, detail: 'CONNECT to proxy timed out' });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, ms: Date.now() - t0, detail: `CONNECT error: ${err.message}` });
    });

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

    const res = await withTimeout(
      httpsPost(TOKEN_URL, JSON.stringify(payload)),
      REQUEST_TIMEOUT_MS + 5_000,
      'Correos token request',
    );

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
