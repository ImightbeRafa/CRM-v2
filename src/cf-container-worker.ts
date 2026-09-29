import { Container, getContainer } from "@cloudflare/containers";

/**
 * Named container object (was the library default "cf-singleton-container"). 2026-09-29: that
 * object's instance got stuck "inactive" on Cloudflare's side (every fetch → internal error, a
 * redeploy did not reset it). A new name gives a fresh Durable Object + container.
 */
const CONTAINER_INSTANCE_NAME = "betsy-main-2";
/** Standby object: only started when the primary throws (max_instances 2 leaves room for it). */
const STANDBY_INSTANCE_NAME = "betsy-standby-1";

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
    return await getContainer(env.BETSY_CRM_CONTAINER, CONTAINER_INSTANCE_NAME).fetch(request);
  } catch (primaryError) {
    console.error("[container] primary failed, trying standby", String(primaryError));
    if (!retry) return unavailableResponse(request);
    try {
      return await getContainer(env.BETSY_CRM_CONTAINER, STANDBY_INSTANCE_NAME).fetch(retry);
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
  NEXTAUTH_URL?: string;
  NEXTAUTH_SECRET?: string;
  EMPLOYEE_CODE_SECRET?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  RESEND_API_KEY?: string;
  ENCRYPTION_KEY?: string;
  CRON_SECRET?: string;
  OPENAI_API_KEY?: string;
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
  // Blob / Telegram / Tilopay / Correos / Finance
  BLOB_READ_WRITE_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CHAT_STORAGE_BUCKET?: string;
  BLOB_STORE_ID?: string;
  BLOB_WEBHOOK_PUBLIC_KEY?: string;
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
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "EMPLOYEE_CODE_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "RESEND_API_KEY",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
  "OPENAI_API_KEY",
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
  "BLOB_READ_WRITE_TOKEN",
  // Chat file storage (Supabase Storage, src/lib/chat-storage.ts).
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CHAT_STORAGE_BUCKET",
  "BLOB_STORE_ID",
  "BLOB_WEBHOOK_PUBLIC_KEY",
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
  "NEXT_PUBLIC_FB_LOGIN_CONFIG_ID",
  "NEXT_PUBLIC_IG_LOGIN_CONFIG_ID",
  "NEXT_PUBLIC_META_APP_ID",
  "NEXT_PUBLIC_META_GRAPH_API_VERSION",
  "NEXT_PUBLIC_META_WA_APP_ID",
  "NEXT_PUBLIC_TILOPAY_API_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

/** Unique cron expressions → internal paths (Vercel vercel.json schedules).
 * "0 2 * * *" fans out to both backup and process-subscription-expiry.
 */
const CRON_PATHS: Record<string, readonly string[]> = {
  "0 2 * * *": [
    "/api/cron/backup",
    "/api/cron/process-subscription-expiry",
  ],
  "0 14 * * *": ["/api/cron/backup/hot"],
  "*/5 * * * *": ["/api/cron/bot-inbox"],
  // chat-workspace (Phase 2b): assignment rules / auto-close / reopen; no-op unless a business turned them on.
  "*/1 * * * *": ["/api/cron/chat-automation", "/api/cron/chat-workspace"],
  "30 3 * * *": ["/api/cron/chat-agent-retention", "/api/cron/workspace-retention"],
  "0 5 * * *": ["/api/cron/logistics-report"],
  "0 18 * * SUN": ["/api/cron/logistics-finalize"],
  "0 6 * * *": ["/api/cron/chat-token-health"],
};

function getContainerEnvVars(source: Env): Record<string, string> {
  const envVars: Record<string, string> = {};

  for (const key of CONTAINER_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string") {
      envVars[key] = value;
    }
  }

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

export default {
  async fetch(request: Request, env: Env) {
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
