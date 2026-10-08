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
import {
  createMemoryBlobStore,
  gunzipToString,
  gzipBufferAsync,
  gzipJsonlLinesAsync,
  sha256Hex,
  type BackupBlobStore,
} from './blob-store';
import { createBackupStore } from './store-factory';
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

/**
 * Full + hot + manual runs never overlap: transaction-level advisory lock (two-key form, its own
 * key space), released by Postgres at commit / rollback even through a session pooler.
 */
const BACKUP_LOCK_KEY = 815_420_026;
const BACKUP_LOCK_SUBKEY = 1;

/**
 * Only the Cloudflare Worker sets BACKUP_WRITER=1 (in its own code). The Railway preview shares the
 * production database and must never write or prune backups, even if R2 keys were copied there.
 */
export function backupWriterAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BACKUP_WRITER || '').trim() === '1';
}
/** Worker cron wall limit is 15 min; stop before it and close the connection (aborts the snapshot). */
export const BACKUP_DEADLINE_MS = 12 * 60_000;

function runIdFromDate(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

async function loadManifest(
  store: BackupBlobStore,
  pathname: string,
): Promise<BackupManifestV1 | null> {
  try {
    return await readManifestStrict(store, pathname);
  } catch {
    return null;
  }
}

/**
 * Throws when the storage read fails (network, timeout, 5xx); returns null only for content that is
 * not a v1 manifest. Retention must never treat "could not read" as "garbage".
 */
async function readManifestStrict(store: BackupBlobStore, pathname: string): Promise<BackupManifestV1 | null> {
  const buf = await store.getBytes(pathname);
  try {
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
  if (!options.store && !backupWriterAllowed()) {
    throw new Error('Backup writer disabled here (BACKUP_WRITER is set only by the Cloudflare Worker)');
  }
  const runId = runIdFromDate(startedAt);
  const store = options.store ?? createBackupStore();
  const ownsSql = !options.sql;
  const sql = options.sql ?? createBackupSql();
  const retentionDays = options.retentionDays
    ?? parseInt(process.env.BACKUP_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);

  let timedOut = false;
  const deadline = ownsSql
    ? setTimeout(() => {
        timedOut = true;
        void sql.end({ timeout: 0 }).catch(() => undefined);
      }, BACKUP_DEADLINE_MS)
    : null;

  try {
    const {
      discovered,
      requiredLmPresent,
      schemaArtifacts,
      tableArtifacts,
      warnings,
    } = await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      // Session-pooler safe: settings and the lock live in THIS transaction only.
      // A stalled upload never holds the read snapshot open on the shared DB for long.
      await tx`SET LOCAL idle_in_transaction_session_timeout = '120s'`;
      await tx`SET LOCAL application_name = 'betsy-backup'`;
      const [lock] = await tx<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${BACKUP_LOCK_KEY}, ${BACKUP_LOCK_SUBKEY}) AS ok`;
      if (!lock?.ok) throw new Error('Backup already running');
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
      if (kind === 'hot' && !previousFull) {
        // A hot run only makes sense on top of a full one (it would upload everything, then fail).
        throw new Error('No full backup yet: run a full backup first');
      }
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
      const preGz = await gzipBufferAsync(Buffer.from(schemaDump.preSql, 'utf8'));
      const postGz = await gzipBufferAsync(Buffer.from(schemaDump.postSql, 'utf8'));
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
        const gz = await gzipJsonlLinesAsync(lines);
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
        await applyRetention(store, retentionDays, new Date(), { protect: [manifestPath] });
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

    forgetBackupStatusCache();
    return {
      success: true,
      kind,
      runId,
      manifestPath,
      manifest,
    };
  } catch (err) {
    if (timedOut) {
      const cause = err instanceof Error ? err.message.slice(0, 120) : 'unknown';
      throw new Error(`Backup stopped: exceeded ${Math.round(BACKUP_DEADLINE_MS / 60_000)} minutes (${cause})`);
    }
    throw err;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (ownsSql && !timedOut) {
      await sql.end({ timeout: 5 });
    }
  }
}

/**
 * Deletes manifests older than the retention window and artifacts no kept manifest references.
 * Safe by construction (SecureDog 2026-10-02, H1):
 * - if ANY manifest cannot be read (network / timeout / 5xx) nothing is deleted (throws);
 * - a manifest that is not a recognised v1 document is kept, and then no artifact is deleted
 *   (its references are unknown);
 * - manifests in `protect` (the run that just finished) are never deleted.
 */
export async function applyRetention(
  store: BackupBlobStore,
  retentionDays: number,
  now = new Date(),
  opts: { protect?: string[] } = {},
): Promise<{ deletedManifests: number; deletedObjects: number; keptUnknown: number }> {
  if (!(retentionDays > 0)) return { deletedManifests: 0, deletedObjects: 0, keptUnknown: 0 };
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const graceCutoff = now.getTime() - RETENTION_SWEEP_GRACE_HOURS * 60 * 60 * 1000;
  const protect = new Set(opts.protect ?? []);

  const manifestObjs = await listManifests(store);
  const keptPaths = new Set<string>();
  const toDeleteManifests: string[] = [];
  let keptUnknown = 0;

  for (const m of manifestObjs) {
    let manifest: BackupManifestV1 | null;
    try {
      manifest = await readManifestStrict(store, m.pathname);
    } catch {
      throw new Error(`Retention skipped: could not read manifest ${m.pathname}`);
    }
    if (!manifest) {
      keptUnknown += 1;
      keptPaths.add(m.pathname);
      continue;
    }
    const finished = new Date(manifest.finishedAt).getTime();
    if (Number.isFinite(finished) && finished < cutoff && !protect.has(m.pathname)) {
      toDeleteManifests.push(m.pathname);
    } else {
      keptPaths.add(m.pathname);
      keptPaths.add(manifest.schema.prePath);
      keptPaths.add(manifest.schema.postPath);
      for (const t of manifest.tables) keptPaths.add(t.artifactPath);
    }
  }

  // Objects under the prefix that no kept manifest references and older than the grace window.
  // Skipped entirely when an unknown manifest exists (it may reference them).
  const toDeleteObjects: string[] = [];
  if (keptUnknown === 0) {
    const allObjects = await store.list(`${OBJECT_PREFIX}/`);
    for (const obj of allObjects) {
      if (keptPaths.has(obj.pathname)) continue;
      const uploaded = obj.uploadedAt?.getTime() ?? 0;
      if (!uploaded || uploaded > graceCutoff) continue;
      toDeleteObjects.push(obj.pathname);
    }
  }

  await store.deleteMany(toDeleteManifests);
  await store.deleteMany(toDeleteObjects);
  return {
    deletedManifests: toDeleteManifests.length,
    deletedObjects: toDeleteObjects.length,
    keptUnknown,
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

export const BACKUP_STATUS_DEADLINE_MS = 20_000;
const STATUS_CACHE_MS = 60_000;
let statusCache: { at: number; value: BackupStatusResponse } | null = null;

/** Clears the 60 s status cache (tests, and right after a backup run). */
export function forgetBackupStatusCache(): void {
  statusCache = null;
}

/**
 * Backup health for the platform admin. Never hangs: storage that does not answer within 20 s
 * yields `status: 'unknown'` (2026-10-02 the old version waited forever on blob storage).
 */
export async function getBackupStatus(
  store?: BackupBlobStore,
  now = new Date(),
  deadlineMs = BACKUP_STATUS_DEADLINE_MS,
): Promise<BackupStatusResponse> {
  const cacheable = !store;
  if (cacheable && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.value;
  const retentionDays = parseInt(
    process.env.BACKUP_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS),
    10,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deadlineMs);
  });
  let result: BackupStatusResponse;
  try {
    const computed = await Promise.race([computeBackupStatus(store ?? createBackupStore(), now, retentionDays), timeout]);
    result = computed === 'timeout' ? unknownStatus(retentionDays, 'Backup storage did not answer in time.') : computed;
  } catch {
    result = unknownStatus(retentionDays, 'Backup storage is not reachable or not configured.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (cacheable) statusCache = { at: Date.now(), value: result };
  return result;
}

function unknownStatus(retentionDays: number, message: string): BackupStatusResponse {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    isHealthy: false,
    status: 'unknown',
    retentionDays,
    full: null,
    hot: null,
    recentManifests: [],
    recommendations: [{ type: 'critical', message, action: 'Check the R2 settings on the Worker and the backup cron logs.' }],
  };
}

async function computeBackupStatus(
  blobStore: BackupBlobStore,
  now: Date,
  retentionDays: number,
): Promise<BackupStatusResponse> {
  const manifestObjs = (await listManifests(blobStore)).slice(0, 40);
  const loaded: Array<BackupManifestV1 | null> = new Array(manifestObjs.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, manifestObjs.length) }, async () => {
      for (let i = next++; i < manifestObjs.length; i = next++) {
        loaded[i] = await loadManifest(blobStore, manifestObjs[i]!.pathname);
      }
    }),
  );
  const summaries: ManifestSummary[] = loaded
    .filter((m): m is BackupManifestV1 => m !== null)
    .map((m) => toSummary(m, now));

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

export { createMemoryBlobStore };
