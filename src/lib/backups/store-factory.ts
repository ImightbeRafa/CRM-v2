import type { BackupBlobStore } from './blob-store';
import { createR2BlobStoreFromEnv } from './r2-store';

/** Where backups live: Cloudflare R2 (private bucket, S3 API). The only store. */
export function createBackupStore(env: Record<string, string | undefined> = process.env): BackupBlobStore {
  return createR2BlobStoreFromEnv(env);
}
