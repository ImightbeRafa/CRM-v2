/**
 * Apply Betsy v2 additive SQL 018–023 against the shared database.
 *
 * Safety gates (all required):
 *   BETSY_V2_APPLY_MIGRATIONS=1
 *   BETSY_V2_APPLY_CONFIRM_HOST=<exact DIRECT_URL hostname>
 *   BETSY_V2_APPLY_FILES=018,019,020,021,022,023   (optional subset)
 *
 * Never uses Prisma migrate / db push. Each file has its own BEGIN/COMMIT
 * plus lock_timeout/statement_timeout. Stops on the first failure.
 *
 * Usage:
 *   BETSY_V2_APPLY_MIGRATIONS=1 \
 *   BETSY_V2_APPLY_CONFIRM_HOST=db.xxxx.supabase.co \
 *   node scripts/apply-betsy-v2-additive-sql.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const FILES = {
  '018': '018_betsy_v2_feature_flags.sql',
  '019': '019_betsy_v2_order_lifecycle.sql',
  '020': '020_betsy_v2_server_pagination.sql',
  '021': '021_betsy_v2_bot_inbox.sql',
  '022': '022_betsy_v2_order_archive.sql',
  '023': '023_betsy_v2_tenant_ui.sql',
};

const EXPECTED_TABLES = {
  '018': ['TenantFeatureFlag'],
  '019': ['ClientIdentityConflict', 'OrderLifecycleOperation', 'OrderInventoryAllocation'],
  '020': ['TenantOrderStatusClassification'],
  '021': ['BotInboxMessage', 'BotInboxDelivery'],
  '022': [],
  '023': ['TenantSetupProgress'],
};

const EXPECTED_COLUMNS = {
  '019': [
    ['Order', 'clientId'],
    ['Order', 'lifecycleVersion'],
    ['Client', 'normalizedPhone'],
    ['Invoice', 'emailStatus'],
  ],
  '021': [
    ['BotSession', 'seatPolicy'],
    ['Invoice', 'sourceOperationKey'],
  ],
  '022': [
    ['Order', 'deletedAt'],
    ['Order', 'archiveMetadata'],
  ],
};

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const applyEnabled = process.env.BETSY_V2_APPLY_MIGRATIONS === '1';
const confirmHost = process.env.BETSY_V2_APPLY_CONFIRM_HOST;
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!applyEnabled) fail('Set BETSY_V2_APPLY_MIGRATIONS=1 to run this script.');
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

const requested = (process.env.BETSY_V2_APPLY_FILES || '018,019,020,021,022,023')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
for (const id of requested) {
  if (!FILES[id]) fail(`Unknown migration id ${id}.`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = postgres(url, {
  max: 1,
  ssl: 'require',
  prepare: false,
  connect_timeout: 20,
  idle_timeout: 5,
  onnotice: (notice) => console.log(`[notice] ${notice.message}`),
});

async function verify(id) {
  for (const table of EXPECTED_TABLES[id] || []) {
    const rows = await sql`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table}
    `;
    if (rows.length !== 1) fail(`Postcondition failed: table ${table} missing after ${id}.`);
    if (rows[0].relrowsecurity !== true) fail(`Postcondition failed: ${table} RLS is off.`);
  }
  for (const [table, column] of EXPECTED_COLUMNS[id] || []) {
    const rows = await sql`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    `;
    if (rows.length !== 1) fail(`Postcondition failed: ${table}.${column} missing after ${id}.`);
  }
  const flags = await sql`
    SELECT COUNT(*)::int AS n FROM public."TenantFeatureFlag" WHERE enabled = true
  `.catch(() => [{ n: 0 }]);
  if (flags[0]?.n) fail('Unexpected enabled TenantFeatureFlag row after apply.');
}

async function main() {
  console.log(`Applying ${requested.join(',')} to ${parsed.hostname}:${parsed.port || 5432}`);
  for (const id of requested) {
    const file = join(root, 'supabase/migrations', FILES[id]);
    const body = readFileSync(file, 'utf8');
    if (/\b(DROP TABLE|TRUNCATE|ALTER TABLE\b[\s\S]{0,80}DROP COLUMN)/i.test(body)) {
      fail(`${FILES[id]} contains destructive SQL.`);
    }
    console.log(`\n--- ${id} ${FILES[id]} ---`);
    const started = Date.now();
    await sql.unsafe(body);
    await verify(id);
    console.log(`ok ${id} in ${Date.now() - started}ms`);
  }
  console.log('\nAll requested additive migrations applied. Feature flags remain off.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await sql.end({ timeout: 5 }); } catch {}
  });
