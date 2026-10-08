import { Container } from "@cloudflare/containers";

/**
 * Named container object (was the library default "cf-singleton-container"). 2026-09-29: that
 * object's instance got stuck "inactive" on Cloudflare's side (every fetch → internal error, a
 * redeploy did not reset it). A new name gives a fresh Durable Object + container.
 */
const CONTAINER_INSTANCE_NAME = "betsy-main-enam-1";
/** Standby object: only started when the primary throws (max_instances 2 leaves room for it). */
const STANDBY_INSTANCE_NAME = "betsy-standby-enam-1";

/**
 * Where the container objects live (perf 2026-10-01). A Durable Object — and the container behind it —
 * is placed where it is FIRST created and never moves: "betsy-main-2" landed on the US West Coast
 * (every DB query crossed the US to Supabase us-east-1, ~0.27 s extra per request from Costa Rica).
 * The hint only applies at creation, hence the new names. Eastern North America = next to the DB.
 */
const CONTAINER_LOCATION_HINT: DurableObjectLocationHint = "enam";

function containerStub(env: Env, name: string) {
  return env.BETSY_CRM_CONTAINER.get(env.BETSY_CRM_CONTAINER.idFromName(name), {
    locationHint: CONTAINER_LOCATION_HINT,
  });
}

/** Friendly page instead of Cloudflare's raw "Error 1101" when no container answers. */
function unavailableResponse(request: Request): Response {
  const headers = { "Retry-After": "30", "Cache-Control": "no-store" };
  if (new URL(request.url).pathname.startsWith("/api/")) {
    // Meta and other webhook senders retry on 5xx.
    return Response.json({ error: "Servicio temporalmente no disponible" }, { status: 503, headers });
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Betsy · volvemos enseguida</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0D17;color:#F1F1F5;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px;color:#B3A6FF}p{margin:0;color:#AEB8C7;line-height:1.5}</style></head><body><main><h1>Betsy</h1><p>Estamos reiniciando el servicio. Esta página se recarga sola en unos segundos.</p></main></body></html>`;
  return new Response(html, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * Primary container, then the standby once if the platform throws (e.g. "internal error" from
 * a stuck instance — the 2026-09-29 outage). HTTP error responses from the app are returned
 * as-is; only thrown exceptions fail over.
 */
async function fetchWithFailover(env: Env, request: Request): Promise<Response> {
  // Only small / bodiless requests are copied for a retry: cloning a large upload tees its
  // stream, and an unread branch can stall the original on Workers.
  const size = Number(request.headers.get("content-length") || 0);
  const replayable = !request.body || (size > 0 && size <= 1024 * 1024);
  const retry = replayable ? request.clone() : null;
  try {
    return await containerStub(env, CONTAINER_INSTANCE_NAME).fetch(request);
  } catch (primaryError) {
    console.error("[container] primary failed, trying standby", String(primaryError));
    if (!retry) return unavailableResponse(request);
    try {
      return await containerStub(env, STANDBY_INSTANCE_NAME).fetch(retry);
    } catch (standbyError) {
      console.error("[container] standby failed too", String(standbyError));
      return unavailableResponse(request);
    }
  }
}
import { env } from "cloudflare:workers";

// Cloudflare Worker entry for the daytime smoke deploy (see wrangler.jsonc).
// Not part of the Next.js app: excluded from the root tsconfig, checked by
// tsconfig.cf-worker.json, and bundled separately by wrangler.

interface Env {
  BETSY_CRM_CONTAINER: DurableObjectNamespace<BetsyCrmContainer>;
  // Kill switch + auth / DB core
  DISABLE_CRONS?: string;
  /** production | preview | development (src/lib/review-environment.ts); unset/unknown = production. */
  APP_ENV?: string;
  NEXTAUTH_URL?: string;
  NEXTAUTH_SECRET?: string;
  EMPLOYEE_CODE_SECRET?: string;
  DATABASE_URL?: string;
  PRISMA_CONNECTION_LIMIT?: string;
  DIRECT_URL?: string;
  RESEND_API_KEY?: string;
  ENCRYPTION_KEY?: string;
  CRON_SECRET?: string;
  OPENAI_API_KEY?: string;
  SOFT_AI_OPENAI_API_KEY?: string;
  SOFT_AI_OPENAI_REASONING?: string;
  SOFT_AGENT_KILL?: string;
  CHAT_SSE?: string;
  XAI_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BOT_JWT_SECRET?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  OPENAI_MODEL?: string;
  XAI_MODEL?: string;
  // Meta / WA / IG / chats
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_WA_APP_ID?: string;
  META_WA_APP_SECRET?: string;
  META_CAPI_ACCESS_TOKEN?: string;
  META_GRAPH_API_VERSION?: string;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_VERIFY_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_WEBHOOK_SECRET?: string;
  FB_LOGIN_REDIRECT_URI?: string;
  // Chat storage / Telegram / Tilopay / Correos / Finance
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CHAT_STORAGE_BUCKET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TILOPAY_API_KEY?: string;
  TILOPAY_BASE_URL?: string;
  TILOPAY_PASSWORD?: string;
  TILOPAY_USER?: string;
  TILOPAY_WEBHOOK_SECRET?: string;
  CORREOS_PROXY_SECRET?: string;
  CORREOS_PROXY_URL?: string;
  CORREOS_SECRET?: string;
  CORREOS_WS_COD_CLIENTE?: string;
  CORREOS_WS_PASSWORD?: string;
  CORREOS_WS_SERVICIO_ID?: string;
  CORREOS_WS_SISTEMA?: string;
  CORREOS_WS_USERNAME?: string;
  CORREOS_WS_USUARIO_ID?: string;
  FINANCE_API_KEY?: string;
  BACKUP_API_KEY?: string;
  BACKUP_RETENTION_DAYS?: string;
  BETSY_API_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  // Backups on Cloudflare R2 (S3 API, bucket-scoped token) + ops alert address.
  R2_ACCOUNT_ID?: string;
  R2_BACKUP_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  OPS_ALERT_EMAIL?: string;
  // Meta sales attribution: sending stays off unless this is exactly "1" (never on Railway preview).
  META_SALES_CAPI_SENDER?: string;
  // NEXT_PUBLIC_* — client bundle is build-time; server process.env can still
  // read these at runtime for Embedded Signup / Meta helpers.
  NEXT_PUBLIC_FB_LOGIN_CONFIG_ID?: string;
  NEXT_PUBLIC_IG_LOGIN_CONFIG_ID?: string;
  NEXT_PUBLIC_META_APP_ID?: string;
  NEXT_PUBLIC_META_GRAPH_API_VERSION?: string;
  NEXT_PUBLIC_META_WA_APP_ID?: string;
  NEXT_PUBLIC_TILOPAY_API_KEY?: string;
  NEXT_PUBLIC_APP_URL?: string;
}

/** Non-public Worker env names forwarded into the container process.
 * Prefer listing every secret we put on the Worker so new puts are picked up
 * after redeploy --keep-vars without another code change for known keys.
 */
const CONTAINER_ENV_KEYS = [
  "DISABLE_CRONS",
  "APP_ENV",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "EMPLOYEE_CODE_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "RESEND_API_KEY",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
  "OPENAI_API_KEY",
  "SOFT_AI_OPENAI_API_KEY",
  "SOFT_AI_OPENAI_REASONING",
  "SOFT_AGENT_KILL",
  "CHAT_SSE",
  "XAI_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "BOT_JWT_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "OPENAI_MODEL",
  "XAI_MODEL",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "META_WA_APP_ID",
  "META_WA_APP_SECRET",
  "META_CAPI_ACCESS_TOKEN",
  "META_GRAPH_API_VERSION",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_VERIFY_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_WEBHOOK_SECRET",
  "FB_LOGIN_REDIRECT_URI",
  // Chat file storage (Supabase Storage, src/lib/chat-storage.ts).
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CHAT_STORAGE_BUCKET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "TILOPAY_API_KEY",
  "TILOPAY_BASE_URL",
  "TILOPAY_PASSWORD",
  "TILOPAY_USER",
  "TILOPAY_WEBHOOK_SECRET",
  "CORREOS_PROXY_SECRET",
  "CORREOS_PROXY_URL",
  "CORREOS_SECRET",
  "CORREOS_WS_COD_CLIENTE",
  "CORREOS_WS_PASSWORD",
  "CORREOS_WS_SERVICIO_ID",
  "CORREOS_WS_SISTEMA",
  "CORREOS_WS_USERNAME",
  "CORREOS_WS_USUARIO_ID",
  "FINANCE_API_KEY",
  "BACKUP_API_KEY",
  "BACKUP_RETENTION_DAYS",
  "BETSY_API_URL",
  // Bot check on signup / password reset (src/lib/turnstile.ts): off until both are set.
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "R2_ACCOUNT_ID",
  "R2_BACKUP_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "OPS_ALERT_EMAIL",
  "META_SALES_CAPI_SENDER",
  "NEXT_PUBLIC_FB_LOGIN_CONFIG_ID",
  "NEXT_PUBLIC_IG_LOGIN_CONFIG_ID",
  "NEXT_PUBLIC_META_APP_ID",
  "NEXT_PUBLIC_META_GRAPH_API_VERSION",
  "NEXT_PUBLIC_META_WA_APP_ID",
  "NEXT_PUBLIC_TILOPAY_API_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

/** Unique cron expressions → internal paths (see wrangler.jsonc for the Worker cron triggers).
 * "0 2 * * *" fans out to process-subscription-expiry, then backup.
 */
const CRON_PATHS: Record<string, readonly string[]> = {
  // Subscription expiry first: the backup can take up to 12 minutes of the 15-minute window.
  "0 2 * * *": [
    "/api/cron/process-subscription-expiry",
    "/api/cron/backup",
  ],
  "0 14 * * *": ["/api/cron/backup/hot"],
  // meta-attribution: no-op unless META_SALES_CAPI_SENDER=1 and a business opted in.
  // ai-budget (F2): owner AI budget alerts / optional per-business auto-pause; no-op without budgets.
  "*/5 * * * *": ["/api/cron/bot-inbox", "/api/cron/meta-attribution", "/api/cron/ai-budget"],
  // chat-workspace (Phase 2b): assignment rules / auto-close / reopen; no-op unless a business turned them on.
  "*/1 * * * *": ["/api/cron/chat-automation", "/api/cron/chat-workspace"],
  "30 3 * * *": ["/api/cron/chat-agent-retention", "/api/cron/workspace-retention"],
  "0 5 * * *": ["/api/cron/logistics-report"],
  "0 18 * * SUN": ["/api/cron/logistics-finalize"],
  // ops-daily: alerts the owner when the nightly backup is missing / stale.
  "0 6 * * *": ["/api/cron/chat-token-health", "/api/cron/ops-daily"],
};

function getContainerEnvVars(source: Env): Record<string, string> {
  const envVars: Record<string, string> = {};

  for (const key of CONTAINER_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      envVars[key] = value;
    }
  }

  // One long-lived container serves everyone: Prisma's serverless default of ONE database
  // connection queued every parallel request of every user behind each other (perf review
  // 2026-09-30: /api/auth/me 3 s p50, pure waiting). 6 per container: primary + standby + a
  // container draining during a rollout (18) + Railway + backups + Supabase's own services stay
  // under max_connections (60). Override with a Worker var.
  envVars.PRISMA_CONNECTION_LIMIT = (source.PRISMA_CONNECTION_LIMIT || "").trim() || "6";

  // Only the production container (this Worker) may write / prune backups. The Railway preview
  // shares the production database and never runs this code, so it can never set this.
  envVars.BACKUP_WRITER = "1";

  // Behind Cloudflare the edge sets cf-connecting-ip and overwrites any client value,
  // while X-Forwarded-For keeps client-supplied entries. Rate limits key on this.
  envVars.TRUSTED_IP_HEADER = "cf-connecting-ip";

  return envVars;
}

function cronsDisabled(source: Env): boolean {
  const raw = (source.DISABLE_CRONS || "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export class BetsyCrmContainer extends Container {
  defaultPort = 3000;
  // Production-friendly idle timeout (daytime 10m caused cold starts).
  // Activity (incl. */1 chat-automation once DISABLE_CRONS is cleared) renews it.
  sleepAfter = "24h";
  envVars = getContainerEnvVars(env as unknown as Env);
}

async function runCronPaths(
  env: Env,
  paths: readonly string[],
): Promise<Response> {
  const secret = (env.CRON_SECRET || "").trim();
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET not configured on Worker" },
      { status: 500 },
    );
  }

  const results: Array<{ path: string; status: number; ok: boolean }> = [];

  for (const path of paths) {
    const request = new Request(`http://container${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });
    const response = await fetchWithFailover(env, request);
    results.push({
      path,
      status: response.status,
      ok: response.ok,
    });
    // Drain body so the container connection can close cleanly.
    await response.arrayBuffer().catch(() => undefined);
  }

  const allOk = results.every((r) => r.ok);
  return Response.json({ results }, { status: allOk ? 200 : 502 });
}

/**
 * Uptime watchdog (every 5 min, runs in the Worker, so it still works when the container or the
 * database is down): asks the container for /api/health; if two checks 20 s apart both fail,
 * emails OPS_ALERT_EMAIL through Resend's API directly. At most one email per hour (edge cache
 * marker), plus one "back up" email when it recovers.
 */
const HEALTH_ALERT_KEY = "https://betsy-internal.invalid/health-alert";

async function checkHealthOnce(env: Env): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetchWithFailover(
      env,
      new Request("http://container/api/health", { method: "GET" }),
    );
    const text = await response.text().catch(() => "");
    return { ok: response.ok, detail: `HTTP ${response.status} ${text.slice(0, 120)}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "error" };
  }
}

async function sendWorkerAlert(env: Env, subject: string, text: string): Promise<void> {
  const to = (env.OPS_ALERT_EMAIL || "").trim();
  const key = (env.RESEND_API_KEY || "").trim();
  if (!to || !key) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "BetsyCRM Alertas <noreply@betsycrm.com>",
      to,
      subject: `[Betsy] ${subject}`,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function healthWatch(env: Env): Promise<void> {
  const cache = caches.default;
  const marker = new Request(HEALTH_ALERT_KEY);
  let result = await checkHealthOnce(env);
  if (!result.ok) {
    await new Promise((r) => setTimeout(r, 20_000));
    result = await checkHealthOnce(env);
  }
  const alerted = await cache.match(marker);
  if (!result.ok) {
    console.error(`[cf-health] DOWN ${result.detail}`);
    if (alerted) return;
    await sendWorkerAlert(
      env,
      "www.betsycrm.com NO responde",
      `El sitio o la base de datos no responde (2 intentos con 20 s de diferencia).
Detalle: ${result.detail}
Hora: ${new Date().toISOString()}
Revisá Cloudflare (Worker betsy-crm-daytime-smoke) y Supabase.`,
    );
    await cache.put(marker, new Response("1", { headers: { "Cache-Control": "max-age=3600" } }));
    return;
  }
  if (alerted) {
    await cache.delete(marker);
    await sendWorkerAlert(env, "www.betsycrm.com volvió a responder", `Todo responde de nuevo. Hora: ${new Date().toISOString()}`);
  }
}

/**
 * Next.js build files under /_next/static/ are content-hashed and immutable: served from
 * Cloudflare's edge cache after the first request, so they never cost a container round trip
 * (the container was serving every JS chunk of every page view).
 */
const EDGE_CACHEABLE_PREFIX = "/_next/static/";

async function edgeCachedStatic(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(EDGE_CACHEABLE_PREFIX) || url.pathname.includes("..")) return null;
  // Cookie-free, query-free key: the same file for every visitor.
  const key = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const fresh = await fetchWithFailover(env, new Request(key.url, { method: "GET", headers: { "accept-encoding": request.headers.get("accept-encoding") || "gzip" } }));
  const cc = fresh.headers.get("cache-control") || "";
  if (fresh.status === 200 && cc.includes("immutable") && !fresh.headers.has("set-cookie")) {
    ctx.waitUntil(cache.put(key, fresh.clone()).catch(() => undefined));
  }
  return fresh;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const cached = await edgeCachedStatic(request, env, ctx).catch(() => null);
    if (cached) return cached;
    // Clients must not choose the container port (@cloudflare/containers reads this header).
    // Copying the headers keeps cf-connecting-ip for rate limits.
    const headers = new Headers(request.headers);
    headers.delete("cf-container-target-port");
    // Defence in depth: internal identity headers are only ever set by the app's middleware.
    for (const name of ["x-user-id", "x-user-role", "x-user-email", "x-tenant-id", "x-betsy-sv", "x-betsy-ctx-sig", "x-middleware-subrequest"]) {
      headers.delete(name);
    }
    return fetchWithFailover(env, new Request(request, { headers }));
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Keep Worker crons registered but inert until flip (DISABLE_CRONS=1).
    if (cronsDisabled(env)) {
      console.log(
        `[cf-cron] skipped (DISABLE_CRONS) cron=${controller.cron}`,
      );
      return;
    }

    const paths = CRON_PATHS[controller.cron];
    if (!paths || paths.length === 0) {
      console.error(`[cf-cron] unknown cron expression: ${controller.cron}`);
      return;
    }

    if (controller.cron === "*/5 * * * *") {
      await healthWatch(env).catch((error) =>
        console.error(`[cf-health] watchdog failed ${error instanceof Error ? error.name : "error"}`),
      );
    }

    const result = await runCronPaths(env, paths);
    if (!result.ok) {
      const body = await result.text();
      console.error(
        `[cf-cron] failed cron=${controller.cron} status=${result.status} body=${body.slice(0, 500)}`,
      );
      throw new Error(
        `Cron ${controller.cron} failed with status ${result.status}`,
      );
    }
    console.log(`[cf-cron] ok cron=${controller.cron}`);
  },
};

export default worker;
