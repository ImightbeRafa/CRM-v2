#!/usr/bin/env node
/**
 * Guard around `prisma db push`.
 * Refuses shared Supabase / any DB that already has lm_* tables unless
 * ALLOW_LM_DROP=1 is set explicitly (break-glass for throwaway DBs only).
 */
import { spawnSync } from 'child_process';
import postgres from 'postgres';

function fail(message) {
  console.error(`\n❌ db:push blocked: ${message}\n`);
  process.exit(1);
}

const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!url) {
  fail('DATABASE_URL / DIRECT_URL is not set');
}

let hostname = '';
let port = '';
try {
  const u = new URL(url);
  hostname = u.hostname;
  port = u.port || '5432';
} catch {
  fail('DATABASE_URL is not a valid URL');
}

const host = hostname.toLowerCase();
const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
const looksSupabase =
  host.includes('supabase.co')
  || host.includes('supabase.com')
  || host.includes('pooler.supabase');

if (looksSupabase) {
  fail(
    `Refusing to run against Supabase host "${hostname}". `
    + 'lm_* logistics tables are not in Prisma and would be dropped. '
    + 'Use supabase/migrations SQL instead.',
  );
}

if (port === '6543') {
  fail('Refusing transaction pooler port 6543 for db push (use a local direct Postgres).');
}

if (!isLoopback && process.env.ALLOW_REMOTE_DB_PUSH !== '1') {
  fail(
    `Refusing non-loopback host "${hostname}". `
    + 'Set ALLOW_REMOTE_DB_PUSH=1 only for disposable remote DBs you own.',
  );
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
  ssl: isLoopback ? false : 'require',
  connect_timeout: 15,
});

try {
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'lm_%'
  `;
  const cnt = rows[0]?.cnt ?? 0;
  if (cnt > 0 && process.env.ALLOW_LM_DROP !== '1') {
    fail(
      `Database has ${cnt} lm_* tables. prisma db push would try to DROP them. `
      + 'Set ALLOW_LM_DROP=1 only if you intentionally accept destroying logistics data '
      + 'on a disposable database.',
    );
  }
} catch (err) {
  fail(`Could not inspect database for lm_* tables: ${err instanceof Error ? err.message : err}`);
} finally {
  await sql.end({ timeout: 2 });
}

if (process.argv.includes('--accept-data-loss')) {
  fail('--accept-data-loss is not allowed via db:push');
}

console.log('✅ db:push guards passed — running prisma db push (no --accept-data-loss)');
const result = spawnSync('npx', ['prisma', 'db', 'push', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
process.exit(result.status ?? 1);
