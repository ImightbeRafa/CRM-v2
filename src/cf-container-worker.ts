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
  // Already on Worker secrets; must reach the container for login+/chats+/agentes
  ENCRYPTION_KEY?: string;
  CRON_SECRET?: string;
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
  // Optional / set when available (forward if present as wrangler secrets)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BOT_JWT_SECRET?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  OPENAI_MODEL?: string;
  XAI_MODEL?: string;
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
] as const;

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

export class BetsyCrmContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";
  envVars = getContainerEnvVars(env as unknown as Env);
}

export default {
  async fetch(request: Request, env: Env) {
    return getContainer(env.BETSY_CRM_CONTAINER).fetch(request);
  },
};
