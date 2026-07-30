import {
  BACKUP_FORMAT_VERSION,
  DEFAULT_RETENTION_DAYS,
  FULL_FRESH_HOURS,
  HOT_FRESH_HOURS,
  MANIFEST_PREFIX,
  OBJECT_PREFIX,
  REQUIRED_LM_TABLES,
  RETENTION_SWEEP_GRACE_HOURS,
  encodeTableFileName,
  isHotTable,
} from './config';
import { gzipSync } from 'zlib';
import {
  createMemoryBlobStore,
  createVercelBlobStore,
  gunzipToString,
  gzipJsonlLines,
  sha256Hex,
  type BackupBlobStore,
} from './blob-store';
import {
  computeSchemaHash,
  createBackupSql,
  discoverPublicTables,
  dumpTableJsonl,
  fingerprintTable,
  fingerprintsEqual,
  type Sql,
} from './postgres';
import { dumpPublicSchema } from './schema';
import {
  isBackupManifestV1,
  type BackupKind,
  type BackupManifestV1,
  type BackupRunResult,
  type BackupStatusResponse,
  type ManifestSummary,
  type SchemaArtifacts,
  type TableArtifact,
} from './types';

export interface PerformBackupOptions {
  kind: BackupKind;
  store?: BackupBlobStore;
  sql?: Sql;
  retentionDays?: number;
  now?: Date;
}

function runIdFromDate(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

async function loadManifest(
  store: BackupBlobStore,
  pathname: string,
): Promise<BackupManifestV1 | null> {
  try {
    const buf = await store.getBytes(pathname);
    const parsed = JSON.parse(buf.toString('utf8')) as unknown;
    return isBackupManifestV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function listManifests(store: BackupBlobStore): Promise<Array<{ pathname: string; uploadedAt?: Date }>> {
  const objects = await store.list(`${MANIFEST_PREFIX}/`);
  return objects
    .filter((o) => o.pathname.endsWith('.json'))
    .sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
}

export async function findLatestManifest(
  store: BackupBlobStore,
  kind?: BackupKind,
): Promise<{ pathname: string; manifest: BackupManifestV1 } | null> {
  const manifests = await listManifests(store);
  for (const m of manifests) {
    if (kind && !m.pathname.endsWith(`-${kind}.json`)) continue;
    const manifest = await loadManifest(store, m.pathname);
    if (manifest?.health.ok) return { pathname: m.pathname, manifest };
  }
  return null;
}

export async function performBackup(options: PerformBackupOptions): Promise<BackupRunResult> {
  const startedAt = options.now ?? new Date();
  const kind = options.kind;
  const runId = runIdFromDate(startedAt);
  const store = options.store ?? createVercelBlobStore();
  const ownsSql = !options.sql;
  const sql = options.sql ?? createBackupSql();
  const retentionDays = options.retentionDays
    ?? parseInt(process.env.BACKUP_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);

  try {
    const {
      discovered,
      requiredLmPresent,
      schemaArtifacts,
      tableArtifacts,
      warnings,
    } = await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      const discovered = await discoverPublicTables(tx);
      const discoveredNames = discovered.map((t) => t.tableName);
      const requiredLmMissing = REQUIRED_LM_TABLES.filter((t) => !discoveredNames.includes(t));
      const requiredLmPresent = REQUIRED_LM_TABLES.filter((t) => discoveredNames.includes(t));

      if (requiredLmMissing.length) {
        throw new Error(
          `Backup aborted: required lm_* tables missing: ${requiredLmMissing.join(', ')}`,
        );
      }

      const previousFull = await findLatestManifest(store, 'full');
      const previousAny = kind === 'hot'
        ? (await findLatestManifest(store, 'hot')) || previousFull
        : previousFull;
      const previousByTable = new Map<string, TableArtifact>();
      if (previousAny) {
        for (const t of previousAny.manifest.tables) {
          previousByTable.set(t.tableName, t);
        }
      }

      const tablesToMaterialize = kind === 'full'
        ? discovered
        : discovered.filter((t) => isHotTable(t.tableName));

      let schemaArtifacts: SchemaArtifacts;
      const schemaDump = await dumpPublicSchema(tx, discoveredNames);
      const preGz = gzipSync(Buffer.from(schemaDump.preSql, 'utf8'));
      const postGz = gzipSync(Buffer.from(schemaDump.postSql, 'utf8'));
      const preSha = sha256Hex(preGz);
      const postSha = sha256Hex(postGz);

      const prevSchema = previousFull?.manifest.schema;
      if (
        kind === 'hot'
        && prevSchema
        && prevSchema.preSha256 === preSha
        && prevSchema.postSha256 === postSha
      ) {
        schemaArtifacts = { ...prevSchema, source: 'reused' };
      } else {
        const prePath = `${OBJECT_PREFIX}/${runId}/schema/pre.sql.gz`;
        const postPath = `${OBJECT_PREFIX}/${runId}/schema/post.sql.gz`;
        await store.putBytes(prePath, preGz, 'application/gzip');
        await store.putBytes(postPath, postGz, 'application/gzip');
        schemaArtifacts = {
          prePath,
          postPath,
          preSha256: preSha,
          postSha256: postSha,
          preBytes: preGz.length,
          postBytes: postGz.length,
          source: 'materialized',
        };
      }

      const tableArtifacts: TableArtifact[] = [];
      const warnings: string[] = [];

      for (const table of tablesToMaterialize) {
        const schemaHash = await computeSchemaHash(tx, table.tableName);
        const fp = await fingerprintTable(tx, table, schemaHash);
        const prev = previousByTable.get(table.tableName);

        if (
          prev
          && prev.fingerprint.reuseSafe
          && fp.reuseSafe
          && fingerprintsEqual(prev.fingerprint, fp)
        ) {
          tableArtifacts.push({
            ...prev,
            source: 'reused',
            fingerprint: fp,
          });
          continue;
        }

        const lines = await dumpTableJsonl(tx, table);
        if (lines.length !== fp.rowCount) {
          warnings.push(
            `${table.tableName}: dumped ${lines.length} rows but fingerprint count was ${fp.rowCount}`,
          );
        }
        const gz = gzipJsonlLines(lines);
        const digest = sha256Hex(gz);
        const artifactPath = `${OBJECT_PREFIX}/${runId}/tables/${encodeTableFileName(table.tableName)}.jsonl.gz`;
        await store.putBytes(artifactPath, gz, 'application/gzip');
        tableArtifacts.push({
          tableName: table.tableName,
          source: 'materialized',
          artifactPath,
          rowCount: lines.length,
          fingerprint: { ...fp, rowCount: lines.length },
          sha256: digest,
          compressedBytes: gz.length,
        });
      }

      if (kind === 'hot') {
        if (!previousFull) {
          throw new Error('Hot backup requires a prior successful full backup manifest');
        }
        const hotNames = new Set(tableArtifacts.map((t) => t.tableName));
        for (const t of previousFull.manifest.tables) {
          if (hotNames.has(t.tableName)) continue;
          tableArtifacts.push({
            ...t,
            source: 'carried-forward',
          });
        }
      }

      const artifactNames = new Set(tableArtifacts.map((t) => t.tableName));
      for (const name of discoveredNames) {
        if (!artifactNames.has(name)) {
          throw new Error(`Backup incomplete: missing artifact for table ${name}`);
        }
      }

      return {
        discovered,
        requiredLmPresent,
        schemaArtifacts,
        tableArtifacts,
        warnings,
      };
    });

    const finishedAt = new Date();
    const materialized = tableArtifacts.filter((t) => t.source === 'materialized').length;
    const reused = tableArtifacts.filter((t) => t.source === 'reused').length;
    const carriedForward = tableArtifacts.filter((t) => t.source === 'carried-forward').length;
    const totalLogicalRows = tableArtifacts.reduce((s, t) => s + t.rowCount, 0);
    const totalCompressedBytes = tableArtifacts.reduce((s, t) => s + t.compressedBytes, 0)
      + schemaArtifacts.preBytes + schemaArtifacts.postBytes;

    const manifest: BackupManifestV1 = {
      formatVersion: BACKUP_FORMAT_VERSION,
      kind,
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      database: {
        fingerprintNote: 'Fingerprints use count + watermark (updated*) when present; without watermark, artifacts are always materialized',
      },
      health: {
        ok: true,
        requiredLmPresent: [...requiredLmPresent],
        requiredLmMissing: [],
        warnings,
      },
      schema: schemaArtifacts,
      tables: tableArtifacts.sort((a, b) => a.tableName.localeCompare(b.tableName)),
      stats: {
        discoveredTables: discovered.length,
        materialized,
        reused,
        carriedForward,
        totalLogicalRows,
        totalCompressedBytes,
      },
    };

    const manifestPath = `${MANIFEST_PREFIX}/${runId}-${kind}.json`;
    await store.putBytes(
      manifestPath,
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      'application/json',
    );

    if (kind === 'full' && retentionDays > 0) {
      try {
        await applyRetention(store, retentionDays);
      } catch (err) {
        warnings.push(`Retention cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        manifest.health.warnings = warnings;
        await store.putBytes(
          manifestPath,
          Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
          'application/json',
        );
      }
    }

    return {
      success: true,
      kind,
      runId,
      manifestPath,
      manifest,
    };
  } finally {
    if (ownsSql) {
      await sql.end({ timeout: 5 });
    }
  }
}

export async function applyRetention(
  store: BackupBlobStore,
  retentionDays: number,
  now = new Date(),
): Promise<{ deletedManifests: number; deletedObjects: number }> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const graceCutoff = now.getTime() - RETENTION_SWEEP_GRACE_HOURS * 60 * 60 * 1000;

  const manifestObjs = await listManifests(store);
  const keptPaths = new Set<string>();
  const toDeleteManifests: string[] = [];

  for (const m of manifestObjs) {
    const manifest = await loadManifest(store, m.pathname);
    if (!manifest) {
      toDeleteManifests.push(m.pathname);
      continue;
    }
    const finished = new Date(manifest.finishedAt).getTime();
    if (finished < cutoff) {
      toDeleteManifests.push(m.pathname);
    } else {
      keptPaths.add(m.pathname);
      keptPaths.add(manifest.schema.prePath);
      keptPaths.add(manifest.schema.postPath);
      for (const t of manifest.tables) keptPaths.add(t.artifactPath);
    }
  }

  // Objects under prefix not referenced and older than grace
  const allObjects = await store.list(`${OBJECT_PREFIX}/`);
  const toDeleteObjects: string[] = [];
  for (const obj of allObjects) {
    if (keptPaths.has(obj.pathname)) continue;
    const uploaded = obj.uploadedAt?.getTime() ?? 0;
    if (uploaded && uploaded > graceCutoff) continue;
    // Also skip if still referenced (already handled); delete unreferenced
    toDeleteObjects.push(obj.pathname);
  }

  await store.deleteMany(toDeleteManifests);
  await store.deleteMany(toDeleteObjects);
  return {
    deletedManifests: toDeleteManifests.length,
    deletedObjects: toDeleteObjects.length,
  };
}

function toSummary(manifest: BackupManifestV1, now: Date): ManifestSummary {
  const finished = new Date(manifest.finishedAt).getTime();
  const hoursAgo = (now.getTime() - finished) / (1000 * 60 * 60);
  return {
    kind: manifest.kind,
    runId: manifest.runId,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    hoursAgo,
    discoveredTables: manifest.stats.discoveredTables,
    totalLogicalRows: manifest.stats.totalLogicalRows,
    totalCompressedBytes: manifest.stats.totalCompressedBytes,
    requiredLmMissing: manifest.health.requiredLmMissing,
    materialized: manifest.stats.materialized,
    reused: manifest.stats.reused,
    carriedForward: manifest.stats.carriedForward,
    ok: manifest.health.ok && manifest.health.requiredLmMissing.length === 0,
  };
}

export async function getBackupStatus(
  store?: BackupBlobStore,
  now = new Date(),
): Promise<BackupStatusResponse> {
  const blobStore = store ?? createVercelBlobStore();
  const retentionDays = parseInt(
    process.env.BACKUP_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS),
    10,
  );

  const manifestObjs = await listManifests(blobStore);
  const summaries: ManifestSummary[] = [];
  for (const m of manifestObjs.slice(0, 40)) {
    const manifest = await loadManifest(blobStore, m.pathname);
    if (manifest) summaries.push(toSummary(manifest, now));
  }

  const full = summaries.find((s) => s.kind === 'full') ?? null;
  const hot = summaries.find((s) => s.kind === 'hot') ?? null;

  const recommendations: BackupStatusResponse['recommendations'] = [];
  let isHealthy = true;

  if (!full) {
    isHealthy = false;
    recommendations.push({
      type: 'critical',
      message: 'No successful full backup found.',
      action: 'Trigger GET /api/cron/backup with CRON_SECRET.',
    });
  } else if (full.hoursAgo > FULL_FRESH_HOURS || !full.ok) {
    isHealthy = false;
    recommendations.push({
      type: 'critical',
      message: `Full backup unhealthy (age ${Math.round(full.hoursAgo)}h, ok=${full.ok}).`,
      action: 'Inspect cron logs and required lm_* coverage.',
    });
  }

  if (!hot) {
    recommendations.push({
      type: 'warning',
      message: 'No hot backup yet (expected after 14:00 UTC once scheduled).',
      action: 'Confirm /api/cron/backup/hot cron is deployed.',
    });
  } else if (hot.hoursAgo > HOT_FRESH_HOURS || !hot.ok) {
    isHealthy = false;
    recommendations.push({
      type: 'warning',
      message: `Hot backup stale or unhealthy (age ${Math.round(hot.hoursAgo)}h).`,
      action: 'Check afternoon cron and hot table dumps.',
    });
  }

  if (full?.requiredLmMissing.length) {
    isHealthy = false;
    recommendations.push({
      type: 'critical',
      message: `Missing lm_* in last full: ${full.requiredLmMissing.join(', ')}`,
      action: 'Restore logistics DDL before relying on backups.',
    });
  }

  const status: BackupStatusResponse['status'] = !full
    ? 'missing'
    : isHealthy
      ? 'healthy'
      : 'degraded';

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    isHealthy,
    status,
    retentionDays,
    full,
    hot,
    recentManifests: summaries.slice(0, 20),
    recommendations,
  };
}

export async function verifyManifestArtifacts(
  store: BackupBlobStore,
  manifest: BackupManifestV1,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const schemaPath of [manifest.schema.prePath, manifest.schema.postPath]) {
    try {
      const buf = await store.getBytes(schemaPath);
      const expected = schemaPath === manifest.schema.prePath
        ? manifest.schema.preSha256
        : manifest.schema.postSha256;
      if (sha256Hex(buf) !== expected) {
        errors.push(`Schema hash mismatch: ${schemaPath}`);
      }
      gunzipToString(buf);
    } catch (err) {
      errors.push(`Schema artifact missing/corrupt: ${schemaPath} (${err instanceof Error ? err.message : err})`);
    }
  }

  for (const t of manifest.tables) {
    try {
      const buf = await store.getBytes(t.artifactPath);
      if (sha256Hex(buf) !== t.sha256) {
        errors.push(`Hash mismatch for ${t.tableName}`);
      }
      const text = gunzipToString(buf);
      const lines = text.trim() ? text.trim().split('\n') : [];
      if (lines.length !== t.rowCount) {
        errors.push(`Row count mismatch for ${t.tableName}: expected ${t.rowCount}, got ${lines.length}`);
      }
    } catch (err) {
      errors.push(`Table artifact failed ${t.tableName}: ${err instanceof Error ? err.message : err}`);
    }
  }

  for (const req of REQUIRED_LM_TABLES) {
    if (!manifest.tables.some((t) => t.tableName === req)) {
      errors.push(`Required lm_* missing from manifest: ${req}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export { createMemoryBlobStore, createVercelBlobStore };
