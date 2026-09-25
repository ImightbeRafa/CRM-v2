import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

// Cloudflare Worker entry for the daytime smoke deploy (see wrangler.jsonc).
// Not part of the Next.js app: excluded from the root tsconfig, checked by
// tsconfig.cf-worker.json, and bundled separately by wrangler.

interface Env {
  BETSY_CRM_CONTAINER: DurableObjectNamespace<BetsyCrmContainer>;
  DISABLE_CRONS?: string;
  NEXTAUTH_URL?: string;
  NEXTAUTH_SECRET?: string;
  EMPLOYEE_CODE_SECRET?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  RESEND_API_KEY?: string;
}

const CONTAINER_ENV_KEYS = [
  "DISABLE_CRONS",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "EMPLOYEE_CODE_SECRET",
  "DATABASE_URL",
  "DIRECT_URL",
  "RESEND_API_KEY",
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
