import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required in non-demo mode").optional(),

  // OAuth providers (optional)
  GOOGLE_ID: z.string().optional(),
  GOOGLE_SECRET: z.string().optional(),

  // Legacy GAS endpoint (optional)
  NEXT_PUBLIC_SCRIPT_URL: z.string().url().optional(),

  // Access control
  AUTH_DEMO_MODE: z.string().optional(), // "true" to enable demo credentials provider
  AUTH_ALLOWLIST_EMAILS: z.string().optional(), // comma-separated emails
  AUTH_DEFAULT_ROLE: z.string().optional(), // default role in demo

  // Master user bootstrap (non-demo mode)
  MASTER_EMAIL: z.string().email().optional(),
  MASTER_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  demoMode: boolean;
  allowlistEmails: string[];
  defaultRole: string;
};

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function getConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // In demo mode we will relax requirements; otherwise throw
    const demoMode = parseBoolean(process.env.AUTH_DEMO_MODE);
    if (!demoMode) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
  }

  const data = parsed.success ? parsed.data : (process.env as Record<string, string>);
  const demoMode = parseBoolean(data.AUTH_DEMO_MODE);
  const allowlist = (data.AUTH_ALLOWLIST_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean);
  const defaultRole = data.AUTH_DEFAULT_ROLE || "admin";

  return {
    ...(data as any),
    demoMode,
    allowlistEmails: allowlist,
    defaultRole,
  } as AppConfig;
}

export const config = getConfig();


