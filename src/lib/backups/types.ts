import { BACKUP_FORMAT_VERSION } from './config';

export type BackupKind = 'full' | 'hot';

export type ArtifactSource = 'materialized' | 'reused' | 'carried-forward';

export type WatermarkColumn = string | null;

export interface TableFingerprint {
  rowCount: number;
  watermarkColumn: WatermarkColumn;
  maxWatermark: string | null;
  maxPrimaryKey: string | null;
  schemaHash: string;
  /** False when only count+max(pk) is available — unsafe to reuse for mutable data. */
  reuseSafe: boolean;
}

export interface TableArtifact {
  tableName: string;
  source: ArtifactSource;
  artifactPath: string;
  rowCount: number;
  fingerprint: TableFingerprint;
  sha256: string;
  compressedBytes: number;
}

export interface SchemaArtifacts {
  prePath: string;
  postPath: string;
  preSha256: string;
  postSha256: string;
  preBytes: number;
  postBytes: number;
  source: ArtifactSource;
}

export interface BackupManifestV1 {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  kind: BackupKind;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  database: {
    fingerprintNote: string;
  };
  health: {
    ok: boolean;
    requiredLmPresent: string[];
    requiredLmMissing: string[];
    warnings: string[];
  };
  schema: SchemaArtifacts;
  tables: TableArtifact[];
  stats: {
    discoveredTables: number;
    materialized: number;
    reused: number;
    carriedForward: number;
    totalLogicalRows: number;
    totalCompressedBytes: number;
  };
}

export interface BackupRunResult {
  success: boolean;
  kind: BackupKind;
  runId: string;
  manifestPath: string;
  manifest: BackupManifestV1;
  error?: string;
}

export interface BackupStatusResponse {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  isHealthy: boolean;
  status: 'healthy' | 'degraded' | 'missing';
  retentionDays: number;
  full: ManifestSummary | null;
  hot: ManifestSummary | null;
  recentManifests: ManifestSummary[];
  recommendations: Array<{ type: string; message: string; action: string }>;
}

export interface ManifestSummary {
  kind: BackupKind;
  runId: string;
  startedAt: string;
  finishedAt: string;
  hoursAgo: number;
  discoveredTables: number;
  totalLogicalRows: number;
  totalCompressedBytes: number;
  requiredLmMissing: string[];
  materialized: number;
  reused: number;
  carriedForward: number;
  ok: boolean;
}

export function isBackupManifestV1(value: unknown): value is BackupManifestV1 {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.formatVersion === BACKUP_FORMAT_VERSION
    && (m.kind === 'full' || m.kind === 'hot')
    && typeof m.runId === 'string'
    && Array.isArray(m.tables)
    && typeof m.schema === 'object'
    && m.schema !== null;
}
