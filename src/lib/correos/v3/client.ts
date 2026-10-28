import { createHash } from 'node:crypto';
import type {
  CorreosV3Config,
  CorreosV3Environment,
  V3Barrio,
  V3Canton,
  V3Distrito,
  V3Envelope,
  V3GuiaRequest,
  V3GuiaResponse,
  V3Provincia,
  V3Rastreo,
  V3RecoleccionRequest,
  V3Sucursal,
  V3Tarifa,
  V3TarifaRequest,
  V3TokenResponse,
} from './types';

/**
 * Correos de Costa Rica REST API v3 client (JSON + Bearer JWT).
 *
 * - One host per environment; tokens live 1 h and are refreshed with the
 *   refresh token before a fresh login is attempted.
 * - Reads (GET, tarifa) retry on network errors / 503. Writes (guía,
 *   recolección) are NEVER retried: Correos has no idempotency key, a retry
 *   could register a second shipment.
 * - When CORREOS_PROXY_URL is set the calls go through the relay at
 *   `${proxy}/v3/${environment}` (same X-Correos-Secret header as SOAP).
 */

const DIRECT_BASE: Record<CorreosV3Environment, string> = {
  test: 'https://servicios.correos.go.cr:459/api/v3',
  prod: 'https://amistadpro.correos.go.cr:449/api/v3',
};

const DEFAULT_TIMEOUT_MS = 20_000;
const READ_RETRIES = 2;
/** Refresh a little before Correos expires the token. */
const TOKEN_SAFETY_MS = 60_000;

export class CorreosV3Error extends Error {
  readonly status: number;
  readonly errores: string[];
  /** True when the failure means the credentials were rejected. */
  readonly auth: boolean;

  constructor(message: string, status: number, errores: string[] = []) {
    super(message);
    this.name = 'CorreosV3Error';
    this.status = status;
    this.errores = errores;
    this.auth = status === 401 || status === 403;
  }
}

export function resolveV3BaseUrl(
  environment: CorreosV3Environment,
  env: NodeJS.Dict<string> = process.env,
): string {
  const override = environment === 'test' ? env.CORREOS_V3_TEST_BASE_URL : env.CORREOS_V3_BASE_URL;
  if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  const proxy = env.CORREOS_V3_PROXY_URL || env.CORREOS_PROXY_URL;
  if (proxy && env.CORREOS_PROXY_SECRET) return `${proxy.replace(/\/+$/, '')}/v3/${environment}`;
  return DIRECT_BASE[environment];
}

/** The relay secret goes only to the configured relay's exact origin (SecureDog INFRA-28). */
export function proxySecretFor(baseUrl: string, env: NodeJS.Dict<string>): string {
  const proxy = env.CORREOS_V3_PROXY_URL || env.CORREOS_PROXY_URL;
  const secret = env.CORREOS_PROXY_SECRET;
  if (!proxy || !secret) return '';
  try {
    const a = new URL(baseUrl);
    const b = new URL(proxy);
    return a.origin === b.origin && a.protocol === 'https:' ? secret : '';
  } catch {
    return '';
  }
}

interface CachedToken {
  accessToken: string;
  refreshToken: string | null;
  exp: number;
}

const tokenCache = new Map<string, CachedToken>();
const loginInFlight = new Map<string, Promise<CachedToken>>();

export function __resetV3TokenCache() {
  tokenCache.clear();
  loginInFlight.clear();
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CorreosV3ClientOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  env?: NodeJS.Dict<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class CorreosV3Client {
  readonly config: CorreosV3Config;
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly proxySecret: string;
  private readonly cacheKey: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: CorreosV3Config, options: CorreosV3ClientOptions = {}) {
    const env = options.env ?? process.env;
    this.config = config;
    this.baseUrl = (config.baseUrl || resolveV3BaseUrl(config.environment, env)).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.proxySecret = proxySecretFor(this.baseUrl, env);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cacheKey = createHash('sha256')
      .update(`${this.baseUrl}\0${config.username}\0${config.password}`)
      .digest('hex');
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  private headers(token?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(this.proxySecret ? { 'x-correos-secret': this.proxySecret } : {}),
    };
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private toCached(body: V3TokenResponse): CachedToken {
    if (!body?.accessToken) throw new CorreosV3Error('Correos no devolvió un token', 502);
    const lifeMs = Math.max(60, Number(body.expiresIn) || 3600) * 1000;
    return {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken || null,
      exp: this.now() + lifeMs - TOKEN_SAFETY_MS,
    };
  }

  private async authCall(path: '/auth/login' | '/auth/refresh', body: unknown): Promise<CachedToken> {
    const res = await this.rawFetch(path, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      throw new CorreosV3Error(
        res.status === 401 ? 'Correos rechazó las credenciales' : `Correos auth falló (${res.status})`,
        res.status,
        text ? [text.slice(0, 200)] : [],
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CorreosV3Error('Respuesta de autenticación inválida', 502);
    }
    // Tolerate both a bare token object and one wrapped in the envelope.
    const tok = (parsed as V3Envelope<V3TokenResponse>)?.datos ?? (parsed as V3TokenResponse);
    return this.toCached(tok);
  }

  private async login(): Promise<CachedToken> {
    const pending = loginInFlight.get(this.cacheKey);
    if (pending) return pending;
    const p = (async () => {
      const prev = tokenCache.get(this.cacheKey);
      if (prev?.refreshToken) {
        try {
          return await this.authCall('/auth/refresh', { refreshToken: prev.refreshToken });
        } catch {
          // fall through to a full login
        }
      }
      return this.authCall('/auth/login', { usuario: this.config.username, password: this.config.password });
    })()
      .then((tok) => {
        tokenCache.set(this.cacheKey, tok);
        return tok;
      })
      .finally(() => loginInFlight.delete(this.cacheKey));
    loginInFlight.set(this.cacheKey, p);
    return p;
  }

  async getToken(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey);
    if (cached && cached.exp > this.now()) return cached.accessToken;
    return (await this.login()).accessToken;
  }

  invalidateToken() {
    const cached = tokenCache.get(this.cacheKey);
    if (cached) tokenCache.set(this.cacheKey, { ...cached, exp: 0 });
  }

  /** Revoke the refresh token (e.g. when credentials are replaced). */
  async revoke(): Promise<void> {
    const cached = tokenCache.get(this.cacheKey);
    tokenCache.delete(this.cacheKey);
    if (!cached?.refreshToken) return;
    try {
      await this.rawFetch('/auth/revoke', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ refreshToken: cached.refreshToken }),
      });
    } catch {
      // best effort
    }
  }

  // ─── Core request ─────────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; retry: boolean },
  ): Promise<T> {
    let attempt = 0;
    let reauthed = false;
    for (;;) {
      const token = await this.getToken();
      let res: Response;
      try {
        res = await this.rawFetch(path, {
          method,
          headers: this.headers(token),
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (err) {
        if (opts.retry && attempt < READ_RETRIES) {
          attempt++;
          await this.sleep(500 * attempt);
          continue;
        }
        const msg = err instanceof Error && err.name === 'TimeoutError'
          ? `Correos no respondió en ${Math.round(this.timeoutMs / 1000)} s`
          : `No se pudo conectar con Correos: ${err instanceof Error ? err.message : String(err)}`;
        throw new CorreosV3Error(msg, 0);
      }

      if (res.status === 401 && !reauthed) {
        // Token revoked/expired server-side: re-login once. Safe for writes too,
        // a 401 means Correos did not accept (and so did not register) the call.
        reauthed = true;
        this.invalidateToken();
        tokenCache.delete(this.cacheKey);
        continue;
      }
      if (res.status === 503 && opts.retry && attempt < READ_RETRIES) {
        attempt++;
        await this.sleep(500 * attempt);
        continue;
      }

      const text = await res.text();
      let env: V3Envelope<T> | null = null;
      try {
        env = text ? (JSON.parse(text) as V3Envelope<T>) : null;
      } catch {
        env = null;
      }

      if (!res.ok || !env || env.exito === false) {
        const errores = (env?.errores ?? []).filter(Boolean);
        const problem = env as unknown as { title?: string; detail?: string } | null;
        const message =
          env?.mensaje ||
          errores[0] ||
          problem?.detail ||
          problem?.title ||
          (res.status === 401 ? 'Correos rechazó las credenciales' : '') ||
          (res.status === 503 ? 'Correos no está disponible en este momento' : '') ||
          `Correos respondió ${res.status}`;
        // A 2xx without a readable envelope is NOT a refusal: for a write it means "maybe registered".
        throw new CorreosV3Error(message, res.ok ? (env ? 422 : 502) : res.status, errores);
      }
      return env.datos as T;
    }
  }

  // ─── Ubicaciones ──────────────────────────────────────────────────────────

  provincias() {
    return this.request<V3Provincia[]>('GET', '/ubicaciones/provincias', { retry: true }).then((d) => d ?? []);
  }

  cantones(provincia: string) {
    const q = new URLSearchParams({ provincia });
    return this.request<V3Canton[]>('GET', `/ubicaciones/cantones?${q}`, { retry: true }).then((d) => d ?? []);
  }

  distritos(provincia: string, canton: string) {
    const q = new URLSearchParams({ provincia, canton });
    return this.request<V3Distrito[]>('GET', `/ubicaciones/distritos?${q}`, { retry: true }).then((d) => d ?? []);
  }

  barrios(provincia: string, canton: string, distrito: string) {
    const q = new URLSearchParams({ provincia, canton, distrito });
    return this.request<V3Barrio[]>('GET', `/ubicaciones/barrios?${q}`, { retry: true }).then((d) => d ?? []);
  }

  sucursales(provincia: string, canton: string) {
    const q = new URLSearchParams({ provincia, canton });
    return this.request<V3Sucursal[]>('GET', `/ubicaciones/sucursales?${q}`, { retry: true }).then((d) => d ?? []);
  }

  // ─── Tarifas / guías / rastreo / recolecciones ────────────────────────────

  tarifa(req: Omit<V3TarifaRequest, 'servicio' | 'codCliente'> & Partial<Pick<V3TarifaRequest, 'servicio' | 'codCliente'>>) {
    const body: V3TarifaRequest = {
      ...req,
      servicio: req.servicio ?? this.config.servicioId,
      codCliente: req.codCliente ?? this.config.codCliente,
    };
    return this.request<V3Tarifa>('POST', '/tarifas/calcular', { body, retry: true });
  }

  /** Registers a guía. Never retried (no provider idempotency key). */
  registrarGuia(req: Omit<V3GuiaRequest, 'codigoCliente' | 'servicioId'> & Partial<Pick<V3GuiaRequest, 'codigoCliente' | 'servicioId'>>) {
    const body: V3GuiaRequest = {
      ...req,
      codigoCliente: req.codigoCliente ?? this.config.codCliente,
      servicioId: req.servicioId ?? this.config.servicioId,
      usuarioId: req.usuarioId ?? this.config.usuarioId,
    };
    // Correos asks that unused optional fields are left out of the JSON.
    for (const k of Object.keys(body) as (keyof V3GuiaRequest)[]) {
      if (body[k] === undefined) delete body[k];
    }
    return this.request<V3GuiaResponse>('POST', '/guiasweb/registrar', { body, retry: false });
  }

  rastreo(numeroGuia: string) {
    const q = new URLSearchParams({ numeroGuia });
    return this.request<V3Rastreo>('GET', `/envios/rastreo?${q}`, { retry: true });
  }

  /** Asks Correos to pick up the given guías. Never retried. */
  solicitarRecoleccion(req: V3RecoleccionRequest) {
    return this.request<unknown>('POST', '/recolecciones/solicitar', { body: req, retry: false });
  }
}
