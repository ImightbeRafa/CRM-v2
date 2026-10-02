import { createVercelBlobStore, type BackupBlobStore } from './blob-store';
import { createR2BlobStoreFromEnv } from './r2-store';

/**
 * Where backups live. Default: Cloudflare R2 (private bucket, S3 API). `BACKUP_STORE=vercel` only
 * reads the old Vercel Blob dumps (for a restore from before the move, 2026-10); never for new runs
 * from Cloudflare, where Vercel rejected the token.
 */
export function backupStoreKind(env: Record<string, string | undefined> = process.env): 'r2' | 'vercel' {
  return (env.BACKUP_STORE || '').trim().toLowerCase() === 'vercel' ? 'vercel' : 'r2';
}

export function createBackupStore(env: Record<string, string | undefined> = process.env): BackupBlobStore {
  return backupStoreKind(env) === 'vercel' ? createVercelBlobStore(env.BLOB_READ_WRITE_TOKEN) : createR2BlobStoreFromEnv(env);
}
