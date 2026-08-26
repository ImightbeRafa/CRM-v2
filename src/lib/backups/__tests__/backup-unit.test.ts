import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BACKUP_FORMAT_VERSION,
  REQUIRED_LM_TABLES,
  encodeTableFileName,
  isHotTable,
} from '../config';
import { fingerprintsEqual } from '../postgres';
import { isBackupManifestV1, type TableFingerprint } from '../types';
import { applyRetention, createMemoryBlobStore } from '../service';
import { MANIFEST_PREFIX, OBJECT_PREFIX } from '../config';

describe('backup config', () => {
  it('requires 25 lm_* tables', () => {
    assert.equal(REQUIRED_LM_TABLES.length, 25);
    assert.ok(REQUIRED_LM_TABLES.includes('lm_orders'));
    assert.ok(REQUIRED_LM_TABLES.includes('lm_employees'));
    assert.ok(REQUIRED_LM_TABLES.includes('lm_retiro_order_allocations'));
  });

  it('marks all lm_* and key CRM tables as hot', () => {
    assert.equal(isHotTable('lm_orders'), true);
    assert.equal(isHotTable('Order'), true);
    assert.equal(isHotTable('Seller'), false);
  });

  it('encodes table file names safely', () => {
    assert.equal(encodeTableFileName('Order'), 'Order');
    assert.equal(encodeTableFileName('ShippingGuia'), 'ShippingGuia');
  });
});

describe('fingerprints', () => {
  it('compares fingerprints', () => {
    const a: TableFingerprint = {
      rowCount: 2,
      watermarkColumn: 'updated_at',
      maxWatermark: '2026-01-01',
      maxPrimaryKey: 'x',
      schemaHash: 'abc',
      reuseSafe: true,
    };
    assert.equal(fingerprintsEqual(a, { ...a }), true);
    assert.equal(fingerprintsEqual(a, { ...a, rowCount: 3 }), false);
  });
});

describe('manifest validation', () => {
  it('accepts v1 manifests only', () => {
    assert.equal(isBackupManifestV1({ formatVersion: BACKUP_FORMAT_VERSION, kind: 'full', runId: 'r', tables: [], schema: {} }), true);
    assert.equal(isBackupManifestV1({ formatVersion: 99, kind: 'full', runId: 'r', tables: [], schema: {} }), false);
  });
});

describe('retention mark-and-sweep', () => {
  it('keeps objects referenced by retained manifests', async () => {
    const store = createMemoryBlobStore();
    const oldRun = '2020-01-01T00-00-00-000Z';
    const newRun = '2026-07-30T00-00-00-000Z';
    const sharedPath = `${OBJECT_PREFIX}/${oldRun}/tables/Order.jsonl.gz`;
    const orphanPath = `${OBJECT_PREFIX}/${oldRun}/tables/orphan.jsonl.gz`;

    await store.putBytes(sharedPath, Buffer.from('a'), 'application/gzip');
    await store.putBytes(orphanPath, Buffer.from('b'), 'application/gzip');
    // Older than retention grace so unreferenced orphan is eligible for sweep
    store.setUploadedAt(orphanPath, new Date('2020-01-01T00:00:00.000Z'));
    store.setUploadedAt(sharedPath, new Date('2020-01-01T00:00:00.000Z'));

    const oldManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      kind: 'full' as const,
      runId: oldRun,
      startedAt: '2020-01-01T00:00:00.000Z',
      finishedAt: '2020-01-01T00:00:01.000Z',
      durationMs: 1,
      database: { fingerprintNote: '' },
      health: { ok: true, requiredLmPresent: [], requiredLmMissing: [], warnings: [] },
      schema: {
        prePath: `${OBJECT_PREFIX}/${oldRun}/schema/pre.sql.gz`,
        postPath: `${OBJECT_PREFIX}/${oldRun}/schema/post.sql.gz`,
        preSha256: 'x',
        postSha256: 'y',
        preBytes: 1,
        postBytes: 1,
        source: 'materialized' as const,
      },
      tables: [{
        tableName: 'Order',
        source: 'materialized' as const,
        artifactPath: sharedPath,
        rowCount: 1,
        fingerprint: {
          rowCount: 1,
          watermarkColumn: 'updatedAt',
          maxWatermark: 't',
          maxPrimaryKey: '1',
          schemaHash: 'h',
          reuseSafe: true,
        },
        sha256: 's',
        compressedBytes: 1,
      }],
      stats: {
        discoveredTables: 1,
        materialized: 1,
        reused: 0,
        carriedForward: 0,
        totalLogicalRows: 1,
        totalCompressedBytes: 1,
      },
    };

    const newManifest = {
      ...oldManifest,
      runId: newRun,
      startedAt: '2026-07-30T00:00:00.000Z',
      finishedAt: '2026-07-30T00:00:01.000Z',
      tables: [{
        ...oldManifest.tables[0],
        source: 'reused' as const,
        artifactPath: sharedPath,
      }],
    };

    await store.putBytes(`${OBJECT_PREFIX}/${oldRun}/schema/pre.sql.gz`, Buffer.from('p'), 'application/gzip');
    await store.putBytes(`${OBJECT_PREFIX}/${oldRun}/schema/post.sql.gz`, Buffer.from('q'), 'application/gzip');
    await store.putBytes(
      `${MANIFEST_PREFIX}/${oldRun}-full.json`,
      Buffer.from(JSON.stringify(oldManifest)),
      'application/json',
    );
    await store.putBytes(
      `${MANIFEST_PREFIX}/${newRun}-full.json`,
      Buffer.from(JSON.stringify(newManifest)),
      'application/json',
    );

    // Retention 14 days from 2026-07-30 → old manifest deleted, but shared object kept via new manifest
    const result = await applyRetention(store, 14, new Date('2026-07-30T12:00:00.000Z'));
    assert.ok(result.deletedManifests >= 1);
    // shared still present
    await store.getBytes(sharedPath);
    // orphan removed (unreferenced)
    await assert.rejects(() => store.getBytes(orphanPath));
  });
});
