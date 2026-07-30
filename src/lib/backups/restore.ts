import postgres from 'postgres';
import {
  createVercelBlobStore,
  gunzipToString,
  sha256Hex,
  type BackupBlobStore,
} from './blob-store';
import { MANIFEST_PREFIX } from './config';
import { quoteIdent } from './postgres';
import { verifyManifestArtifacts } from './service';
import { isBackupManifestV1, type BackupManifestV1 } from './types';

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export async function listBackupManifests(store: BackupBlobStore): Promise<BackupManifestV1[]> {
  const objects = await store.list(`${MANIFEST_PREFIX}/`);
  const manifests: BackupManifestV1[] = [];
  for (const obj of objects
    .filter((o) => o.pathname.endsWith('.json'))
    .sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0))) {
    try {
      const raw = JSON.parse((await store.getBytes(obj.pathname)).toString('utf8'));
      if (isBackupManifestV1(raw)) manifests.push(raw);
    } catch {
      // skip invalid
    }
  }
  return manifests;
}

export async function loadManifestByRunId(
  store: BackupBlobStore,
  runId: string,
  kind?: 'full' | 'hot',
): Promise<{ pathname: string; manifest: BackupManifestV1 }> {
  const suffix = kind ? `-${kind}.json` : '.json';
  const objects = await store.list(`${MANIFEST_PREFIX}/`);
  const match = objects.find((o) => o.pathname.includes(runId) && o.pathname.endsWith(suffix)
    || (!kind && o.pathname.includes(runId) && o.pathname.endsWith('.json')));
  if (!match) {
    // try exact full then hot
    const exact = objects.find((o) =>
      o.pathname === `${MANIFEST_PREFIX}/${runId}-full.json`
      || o.pathname === `${MANIFEST_PREFIX}/${runId}-hot.json`
      || o.pathname.endsWith(`/${runId}-full.json`)
      || o.pathname.endsWith(`/${runId}-hot.json`),
    );
    if (!exact) throw new Error(`Manifest not found for runId=${runId}`);
    const manifest = JSON.parse((await store.getBytes(exact.pathname)).toString('utf8'));
    if (!isBackupManifestV1(manifest)) throw new Error('Invalid manifest format');
    return { pathname: exact.pathname, manifest };
  }
  const manifest = JSON.parse((await store.getBytes(match.pathname)).toString('utf8'));
  if (!isBackupManifestV1(manifest)) throw new Error('Invalid manifest format');
  return { pathname: match.pathname, manifest };
}

export interface RestoreOptions {
  store?: BackupBlobStore;
  manifest: BackupManifestV1;
  targetUrl: string;
  apply: boolean;
  allowRemote?: boolean;
  ddlOnly?: boolean;
  dataOnly?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  tablesRestored: number;
  rowsInserted: number;
  errors: string[];
  dryRun: boolean;
}

export async function restoreFromManifest(options: RestoreOptions): Promise<RestoreResult> {
  const store = options.store ?? createVercelBlobStore();
  const errors: string[] = [];

  if (!options.targetUrl) {
    throw new Error('RESTORE_DATABASE_URL is required');
  }
  if (!isLoopbackUrl(options.targetUrl) && !options.allowRemote) {
    throw new Error(
      'Refusing restore to non-loopback database. Pass allowRemote / --allow-remote for intentional remote restores.',
    );
  }

  const verify = await verifyManifestArtifacts(store, options.manifest);
  if (!verify.ok) {
    return { ok: false, tablesRestored: 0, rowsInserted: 0, errors: verify.errors, dryRun: !options.apply };
  }

  if (!options.apply) {
    return {
      ok: true,
      tablesRestored: options.manifest.tables.length,
      rowsInserted: options.manifest.stats.totalLogicalRows,
      errors: [],
      dryRun: true,
    };
  }

  const sql = postgres(options.targetUrl, {
    max: 1,
    prepare: false,
    ssl: isLoopbackUrl(options.targetUrl) ? false : 'require',
  });

  let tablesRestored = 0;
  let rowsInserted = 0;

  try {
    if (!options.dataOnly) {
      const pre = gunzipToString(await store.getBytes(options.manifest.schema.prePath));
      await sql.unsafe(pre);
    }

    if (!options.ddlOnly) {
      // Disable FKs during load when possible
      await sql.unsafe('SET session_replication_role = replica');

      for (const table of options.manifest.tables) {
        const buf = await store.getBytes(table.artifactPath);
        if (sha256Hex(buf) !== table.sha256) {
          errors.push(`Hash mismatch during restore: ${table.tableName}`);
          continue;
        }
        const text = gunzipToString(buf);
        const lines = text.trim() ? text.trim().split('\n') : [];
        await sql.unsafe(`TRUNCATE TABLE ${quoteIdent(table.tableName)} CASCADE`);

        const batchSize = 200;
        for (let i = 0; i < lines.length; i += batchSize) {
          const batch = lines.slice(i, i + batchSize).map((l) => JSON.parse(l) as Record<string, unknown>);
          if (!batch.length) continue;
          // Embed JSON literal — avoids postgres.js/$1 typing issues with json_populate_recordset
          const jsonLiteral = JSON.stringify(batch).replace(/'/g, "''");
          await sql.unsafe(
            `INSERT INTO ${quoteIdent(table.tableName)}
             SELECT * FROM json_populate_recordset(
               NULL::${quoteIdent(table.tableName)},
               '${jsonLiteral}'::json
             )`,
          );
          rowsInserted += batch.length;
        }
        tablesRestored += 1;
      }

      await sql.unsafe('SET session_replication_role = DEFAULT');
    }

    if (!options.dataOnly) {
      const post = gunzipToString(await store.getBytes(options.manifest.schema.postPath));
      try {
        await sql.unsafe(post);
      } catch (err) {
        errors.push(`Post-schema warnings: ${err instanceof Error ? err.message : err}`);
      }
    }

    return {
      ok: errors.length === 0,
      tablesRestored,
      rowsInserted,
      errors,
      dryRun: false,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
