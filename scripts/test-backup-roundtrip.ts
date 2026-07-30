#!/usr/bin/env npx tsx
/**
 * End-to-end backup → restore proof on disposable local Postgres.
 *
 * Env:
 *   BACKUP_TEST_DATABASE_URL  (default postgresql://postgres:postgres@127.0.0.1:5432/postgres)
 *
 * Creates databases backup_src_<ts> and backup_dst_<ts>, never touches remote hosts.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import postgres from 'postgres';
import { REQUIRED_LM_TABLES } from '../src/lib/backups/config';
import { createMemoryBlobStore } from '../src/lib/backups/blob-store';
import { performBackup, verifyManifestArtifacts } from '../src/lib/backups/service';
import { restoreFromManifest } from '../src/lib/backups/restore';

function assertLoopback(url: string) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing non-loopback BACKUP_TEST_DATABASE_URL host: ${host}`);
  }
}

async function dbExists(admin: postgres.Sql, name: string): Promise<boolean> {
  const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  return rows.length > 0;
}

async function main() {
  const adminUrl = process.env.BACKUP_TEST_DATABASE_URL
    || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
  assertLoopback(adminUrl);

  const ts = Date.now().toString(36);
  const srcName = `backup_src_${ts}`;
  const dstName = `backup_dst_${ts}`;
  const admin = postgres(adminUrl, { max: 1, prepare: false });

  const mkUrl = (db: string) => {
    const u = new URL(adminUrl);
    u.pathname = `/${db}`;
    return u.toString();
  };

  try {
    await admin.unsafe(`CREATE DATABASE ${srcName}`);
    await admin.unsafe(`CREATE DATABASE ${dstName}`);

    const srcUrl = mkUrl(srcName);
    const dstUrl = mkUrl(dstName);
    const src = postgres(srcUrl, { max: 1, prepare: false });
    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), 'tests/fixtures/backup-source.sql'),
        'utf8',
      );
      await src.unsafe(fixture);
    } finally {
      await src.end({ timeout: 5 });
    }

    const store = createMemoryBlobStore();
    process.env.BACKUP_DATABASE_URL = srcUrl;

    const full = await performBackup({ kind: 'full', store, retentionDays: 0 });
    if (!full.success) throw new Error('Full backup failed');

    const verify = await verifyManifestArtifacts(store, full.manifest);
    if (!verify.ok) {
      throw new Error(`Verify failed: ${verify.errors.join('; ')}`);
    }

    // Coverage: all required lm_* + future_table + Seller
    for (const t of REQUIRED_LM_TABLES) {
      if (!full.manifest.tables.some((x) => x.tableName === t && x.rowCount >= 1)) {
        throw new Error(`Manifest missing seeded rows for ${t}`);
      }
    }
    if (!full.manifest.tables.some((t) => t.tableName === 'future_table' && t.rowCount === 1)) {
      throw new Error('Discovery failed: future_table not backed up');
    }

    // Fingerprint reuse: second full should reuse watermarked unchanged tables
    const full2 = await performBackup({ kind: 'full', store, retentionDays: 0 });
    const reused = full2.manifest.stats.reused;
    if (reused < 1) {
      throw new Error('Expected fingerprint reuse on second full backup');
    }

    // Mutate Order, run hot
    const srcMut = postgres(srcUrl, { max: 1, prepare: false });
    try {
      await srcMut`UPDATE "Order" SET status = 'SHIPPED', "updatedAt" = now() WHERE id = 'o1'`;
      await srcMut`INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
                   VALUES ('o2', 't1', 'correos', 'NEW')`;
    } finally {
      await srcMut.end({ timeout: 5 });
    }

    const hot = await performBackup({ kind: 'hot', store, retentionDays: 0 });
    const orderArt = hot.manifest.tables.find((t) => t.tableName === 'Order');
    if (!orderArt || orderArt.source !== 'materialized') {
      throw new Error('Hot backup should rematerialize changed Order');
    }
    if (hot.manifest.stats.carriedForward < 1) {
      throw new Error('Hot backup should carry-forward cold tables from full');
    }

    const restore = await restoreFromManifest({
      store,
      manifest: hot.manifest,
      targetUrl: dstUrl,
      apply: true,
    });
    if (!restore.ok) {
      throw new Error(`Restore failed: ${restore.errors.join('; ')}`);
    }

    const dst = postgres(dstUrl, { max: 1, prepare: false });
    try {
      const order = await dst`SELECT status, total::text AS total, meta::text AS meta FROM "Order" WHERE id = 'o1'`;
      if (order[0]?.status !== 'SHIPPED') {
        throw new Error(`Order status not restored: ${order[0]?.status}`);
      }
      if (String(order[0]?.total) !== '12.50') {
        throw new Error(`Order total not restored: ${order[0]?.total}`);
      }

      const lmCount = await dst`SELECT COUNT(*)::int AS c FROM lm_orders`;
      if (lmCount[0].c !== 2) {
        throw new Error(`lm_orders expected 2 rows, got ${lmCount[0].c}`);
      }

      const seller = await dst`SELECT name FROM "Seller" WHERE id = 's1'`;
      if (seller[0]?.name !== 'Seller') {
        throw new Error('Carried-forward Seller missing after hot restore');
      }

      const future = await dst`SELECT note FROM future_table WHERE id = 'f1'`;
      if (future[0]?.note !== 'discovered automatically') {
        throw new Error('future_table data missing');
      }

      // Corrupt artifact → verify fails
      const corruptPath = full.manifest.tables.find((t) => t.tableName === 'Order')!.artifactPath;
      await store.putBytes(corruptPath, Buffer.from('not-gzip'), 'application/gzip');
      const bad = await verifyManifestArtifacts(store, full.manifest);
      if (bad.ok) throw new Error('Verify should fail on corrupt artifact');
    } finally {
      await dst.end({ timeout: 5 });
    }

    console.log('✅ Backup round-trip proof passed');
    console.log(JSON.stringify({
      fullTables: full.manifest.stats.discoveredTables,
      fullRows: full.manifest.stats.totalLogicalRows,
      reusedOnSecondFull: reused,
      hotMaterialized: hot.manifest.stats.materialized,
      hotCarriedForward: hot.manifest.stats.carriedForward,
      restoredTables: restore.tablesRestored,
      restoredRows: restore.rowsInserted,
    }, null, 2));
  } finally {
    try {
      if (await dbExists(admin, srcName)) {
        await admin.unsafe(`DROP DATABASE ${srcName} WITH (FORCE)`);
      }
    } catch { /* ignore */ }
    try {
      if (await dbExists(admin, dstName)) {
        await admin.unsafe(`DROP DATABASE ${dstName} WITH (FORCE)`);
      }
    } catch { /* ignore */ }
    await admin.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('❌ Round-trip failed:', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
