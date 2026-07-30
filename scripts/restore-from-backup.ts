#!/usr/bin/env npx tsx
/**
 * Restore Betsy backup v1 manifests from private Vercel Blob (or test store).
 *
 * Usage:
 *   npx tsx scripts/restore-from-backup.ts list
 *   npx tsx scripts/restore-from-backup.ts inspect <runId>
 *   npx tsx scripts/restore-from-backup.ts verify <runId>
 *   npx tsx scripts/restore-from-backup.ts restore <runId> --apply
 *
 * Requires RESTORE_DATABASE_URL for restore (never defaults to DATABASE_URL).
 * Refuses non-loopback targets unless --allow-remote is set.
 */
import {
  createVercelBlobStore,
  verifyManifestArtifacts,
} from '../src/lib/backups/service';
import {
  listBackupManifests,
  loadManifestByRunId,
  restoreFromManifest,
} from '../src/lib/backups/restore';

function usage(): never {
  console.log(`Usage:
  restore-from-backup.ts list
  restore-from-backup.ts inspect <runId>
  restore-from-backup.ts verify <runId>
  restore-from-backup.ts restore <runId> [--apply] [--ddl-only] [--data-only] [--allow-remote]
`);
  process.exit(1);
}

async function main() {
  const [cmd, runId, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  const store = createVercelBlobStore();

  if (cmd === 'list') {
    const manifests = await listBackupManifests(store);
    if (!manifests.length) {
      console.log('No v1 manifests found under betsy/backups/v1/manifests/');
      return;
    }
    for (const m of manifests) {
      console.log(
        `${m.runId}  ${m.kind.padEnd(4)}  tables=${m.stats.discoveredTables}  rows=${m.stats.totalLogicalRows}  lm_ok=${m.health.requiredLmMissing.length === 0}  ${m.finishedAt}`,
      );
    }
    return;
  }

  if (!runId) usage();
  const { pathname, manifest } = await loadManifestByRunId(store, runId);

  if (cmd === 'inspect') {
    console.log(JSON.stringify({
      pathname,
      kind: manifest.kind,
      runId: manifest.runId,
      finishedAt: manifest.finishedAt,
      health: manifest.health,
      stats: manifest.stats,
      tables: manifest.tables.map((t) => ({
        tableName: t.tableName,
        source: t.source,
        rowCount: t.rowCount,
        compressedBytes: t.compressedBytes,
      })),
    }, null, 2));
    return;
  }

  if (cmd === 'verify') {
    const result = await verifyManifestArtifacts(store, manifest);
    if (!result.ok) {
      console.error('VERIFY FAILED');
      for (const e of result.errors) console.error(` - ${e}`);
      process.exit(1);
    }
    console.log(`✅ Manifest ${manifest.runId} verified (${manifest.tables.length} tables)`);
    return;
  }

  if (cmd === 'restore') {
    const apply = rest.includes('--apply');
    const allowRemote = rest.includes('--allow-remote');
    const ddlOnly = rest.includes('--ddl-only');
    const dataOnly = rest.includes('--data-only');
    const targetUrl = process.env.RESTORE_DATABASE_URL;
    if (!targetUrl) {
      console.error('RESTORE_DATABASE_URL is required (refusing to use DATABASE_URL)');
      process.exit(1);
    }
    if (apply) {
      const host = new URL(targetUrl).hostname;
      console.log(`About to restore run ${manifest.runId} → ${host}`);
    }
    const result = await restoreFromManifest({
      store,
      manifest,
      targetUrl,
      apply,
      allowRemote,
      ddlOnly,
      dataOnly,
    });
    if (!result.ok) {
      console.error('RESTORE FAILED');
      for (const e of result.errors) console.error(` - ${e}`);
      process.exit(1);
    }
    console.log(
      result.dryRun
        ? `✅ Dry-run OK — would restore ${result.tablesRestored} tables / ${result.rowsInserted} rows (pass --apply to execute)`
        : `✅ Restored ${result.tablesRestored} tables / ${result.rowsInserted} rows`,
    );
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
