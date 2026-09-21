/**
 * Apply Betsy v2 additive SQL 018–024 against the shared database.
 *
 * Safety gates (all required):
 *   BETSY_V2_APPLY_MIGRATIONS=1
 *   BETSY_V2_APPLY_CONFIRM_HOST=<exact DIRECT_URL hostname>
 *   BETSY_V2_APPLY_FILES=018,019,...,024   (optional subset)
 *
 * Never uses Prisma migrate / db push. Each file has its own BEGIN/COMMIT
 * plus lock_timeout/statement_timeout. Stops on the first failure.
 *
 * Usage:
 *   BETSY_V2_APPLY_MIGRATIONS=1 \
 *   BETSY_V2_APPLY_CONFIRM_HOST=db.xxxx.supabase.co \
 *   node scripts/apply-betsy-v2-additive-sql.mjs
 *
 * 025 unique constraints are registered but NOT in DEFAULT_APPLY_FILES.
 * Include 025 only via BETSY_V2_APPLY_FILES=025 after verify reports 0 dups.
 * 026 Soft AI ChatAutomationJob is gated the same way (BETSY_V2_APPLY_FILES=026).
 * 027 Soft Agent Layer is gated the same way (BETSY_V2_APPLY_FILES=027).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  DEFAULT_APPLY_FILES,
  EXPECTED_COLUMNS,
  EXPECTED_INDEXES_024,
  EXPECTED_INDEXES_025,
  EXPECTED_SEQUENCE_024,
  EXPECTED_TABLES,
  EXPECTED_TRIGGER_024,
  FILES,
} from './lib/betsy-v2-additive-manifest.mjs';

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

const requested = (process.env.BETSY_V2_APPLY_FILES || DEFAULT_APPLY_FILES)
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

async function verify025Extras() {
  for (const indexName of EXPECTED_INDEXES_025) {
    const rows = await sql`
      SELECT i.indisunique, i.indisvalid
      FROM pg_class idx
      JOIN pg_index i ON i.indexrelid = idx.oid
      JOIN pg_namespace n ON n.oid = idx.relnamespace
      WHERE n.nspname = 'public' AND idx.relname = ${indexName}
    `;
    if (rows.length !== 1) fail(`Postcondition failed: index ${indexName} missing after 025.`);
    if (rows[0].indisunique !== true) fail(`Postcondition failed: index ${indexName} is not UNIQUE.`);
    if (rows[0].indisvalid !== true) fail(`Postcondition failed: index ${indexName} is invalid.`);
  }
}

async function verify024Extras() {
  const seq = await sql`
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname = ${EXPECTED_SEQUENCE_024}
  `;
  if (seq.length !== 1) fail(`Postcondition failed: sequence ${EXPECTED_SEQUENCE_024} missing.`);

  const trigger = await sql`
    SELECT t.tgname, t.tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ChatConversation'
      AND t.tgname = ${EXPECTED_TRIGGER_024}
      AND NOT t.tgisinternal
  `;
  if (trigger.length !== 1) fail(`Postcondition failed: trigger ${EXPECTED_TRIGGER_024} missing.`);
  if (trigger[0].tgenabled !== 'O') {
    fail(`Postcondition failed: trigger ${EXPECTED_TRIGGER_024} is not enabled.`);
  }

  for (const indexName of EXPECTED_INDEXES_024) {
    const rows = await sql`
      SELECT i.indisvalid
      FROM pg_class idx
      JOIN pg_index i ON i.indexrelid = idx.oid
      JOIN pg_namespace n ON n.oid = idx.relnamespace
      WHERE n.nspname = 'public' AND idx.relname = ${indexName}
    `;
    if (rows.length !== 1) fail(`Postcondition failed: index ${indexName} missing after 024.`);
    if (rows[0].indisvalid !== true) fail(`Postcondition failed: index ${indexName} is invalid.`);
  }

  const forbidden = await sql`
    SELECT idx.relname
    FROM pg_class idx
    JOIN pg_namespace n ON n.oid = idx.relnamespace
    WHERE n.nspname = 'public'
      AND idx.relkind = 'i'
      AND (
        idx.relname ILIKE '%ChatMessage%providerMessageId%key%'
        OR idx.relname ILIKE '%SocialAccount%platform%accountId%active%'
      )
  `;
  if (forbidden.length > 0) {
    fail(`024 must not create 025 unique indexes: ${forbidden.map((r) => r.relname).join(', ')}`);
  }
}

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
  if (id === '024') await verify024Extras();
  if (id === '025') await verify025Extras();
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
    if (id === '024' && /UNIQUE\s+INDEX[\s\S]{0,120}providerMessageId/i.test(body)) {
      fail(`${FILES[id]} must not ship 025 providerMessageId unique index.`);
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
