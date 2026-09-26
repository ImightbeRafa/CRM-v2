import { Container, getContainer } from "@cloudflare/containers";
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
  "*/1 * * * *": ["/api/cron/chat-automation"],
  "30 3 * * *": ["/api/cron/chat-agent-retention"],
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

  const container = getContainer(env.BETSY_CRM_CONTAINER);
  const results: Array<{ path: string; status: number; ok: boolean }> = [];

  for (const path of paths) {
    const request = new Request(`http://container${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    });
    const response = await container.fetch(request);
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
    return getContainer(env.BETSY_CRM_CONTAINER).fetch(request);
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
