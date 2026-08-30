/**
 * Turn every TenantFeatureFlag.enabled to false.
 * Does not DELETE flag rows. Does not touch Order, Client, Invoice, or lm_* tables.
 *
 * Safety gates (all required):
 *   BETSY_V2_DISABLE_ALL_FLAGS=1
 *   BETSY_V2_APPLY_CONFIRM_HOST=<exact DIRECT_URL hostname>
 *
 *   BETSY_V2_DISABLE_ALL_FLAGS=1 \
 *   BETSY_V2_APPLY_CONFIRM_HOST=db.xxxx.supabase.co \
 *   node scripts/disable-betsy-v2-flags.mjs
 */
import postgres from 'postgres';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const applyEnabled = process.env.BETSY_V2_DISABLE_ALL_FLAGS === '1';
const confirmHost = process.env.BETSY_V2_APPLY_CONFIRM_HOST;
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!applyEnabled) fail('Set BETSY_V2_DISABLE_ALL_FLAGS=1 to run this script.');
if (!confirmHost) fail('Set BETSY_V2_APPLY_CONFIRM_HOST to the exact database hostname.');
if (!url) fail('DIRECT_URL / DATABASE_URL is missing.');

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail('DATABASE URL is not a valid URL.');
}
if (parsed.hostname !== confirmHost) {
  fail(`Host mismatch: url has ${parsed.hostname}, confirm host is ${confirmHost}.`);
}
if (parsed.port && parsed.port !== '5432') {
  fail(`Refusing pooler/non-direct port ${parsed.port}. Use DIRECT_URL on 5432.`);
}

const sql = postgres(url, { max: 1, ssl: 'require', prepare: false });

const before = await sql`
  SELECT "tenantId", key, enabled, "scope"
  FROM public."TenantFeatureFlag"
  WHERE enabled
  ORDER BY "tenantId", key
`;

if (before.length === 0) {
  console.log(JSON.stringify({ ok: true, updated: 0, before: [] }, null, 2));
  await sql.end({ timeout: 5 });
  process.exit(0);
}

const updated = await sql`
  UPDATE public."TenantFeatureFlag"
  SET enabled = false, "updatedAt" = NOW()
  WHERE enabled = true
  RETURNING "tenantId", key, enabled, "scope"
`;

const remaining = await sql`
  SELECT COUNT(*)::int AS enabled_flags
  FROM public."TenantFeatureFlag"
  WHERE enabled
`;

const report = {
  ok: Number(remaining[0].enabled_flags) === 0,
  updated: updated.length,
  before,
  after: updated,
  remainingEnabled: Number(remaining[0].enabled_flags),
};

console.log(JSON.stringify(report, null, 2));
await sql.end({ timeout: 5 });
if (!report.ok) process.exit(1);
