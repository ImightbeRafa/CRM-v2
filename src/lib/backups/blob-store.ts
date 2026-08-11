import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { del, get, list, put, type BlobAccessType } from '@vercel/blob';

export interface StoredObject {
  pathname: string;
  size: number;
  uploadedAt?: Date;
}

export interface BackupBlobStore {
  putBytes(pathname: string, data: Buffer, contentType: string): Promise<{ pathname: string; size: number }>;
  getBytes(pathname: string): Promise<Buffer>;
  list(prefix: string): Promise<StoredObject[]>;
  deleteMany(pathnames: string[]): Promise<void>;
  /** Effective Blob access mode after any public-store fallback. */
  getAccessMode(): BlobAccessType;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function gzipJsonlLines(lines: string[]): Buffer {
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  return gzipSync(Buffer.from(body, 'utf8'));
}

export function gunzipToString(data: Buffer): string {
  return gunzipSync(data).toString('utf8');
}

function isPublicStorePrivateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /private access on a public store/i.test(msg);
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Vercel Blob store for backups.
 * Prefers private access. Silent fallback to public is DISABLED because full DB
 * dumps contain CRM/logistics PII. Explicit break-glass: BACKUP_BLOB_ACCESS=public.
 */
export function createVercelBlobStore(token = process.env.BLOB_READ_WRITE_TOKEN): BackupBlobStore {
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for backup storage');
  }

  const forced = process.env.BACKUP_BLOB_ACCESS;
  let access: BlobAccessType =
    forced === 'public' || forced === 'private' ? forced : 'private';

  if (access === 'public') {
    console.warn(
      '⚠️ BACKUP_BLOB_ACCESS=public — backup objects will be publicly readable. Prefer a private Blob store.',
    );
  }

  return {
    getAccessMode() {
      return access;
    },

    async putBytes(pathname, data, contentType) {
      try {
        const result = await put(pathname, data, {
          access,
          token,
          contentType,
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        return { pathname: result.pathname, size: data.length };
      } catch (err) {
        if (access === 'private' && isPublicStorePrivateError(err)) {
          throw new Error(
            'Backup aborted: linked Vercel Blob store is public-only. ' +
              'Create a private Blob store and update BLOB_READ_WRITE_TOKEN, ' +
              'or set BACKUP_BLOB_ACCESS=public only as explicit break-glass.',
          );
        }
        throw err;
      }
    },

    async getBytes(pathname) {
      const tryAccess = async (mode: BlobAccessType) => {
        const result = await get(pathname, { access: mode, token });
        if (!result || result.statusCode !== 200 || !result.stream) {
          return null;
        }
        return readStream(result.stream);
      };

      const primary = await tryAccess(access);
      if (primary) return primary;

      // Retry the other mode for manifests written before/after fallback
      const other: BlobAccessType = access === 'private' ? 'public' : 'private';
      try {
        const secondary = await tryAccess(other);
        if (secondary) return secondary;
      } catch {
        // ignore and throw original-style error
      }
      throw new Error(`Blob not found or unreadable: ${pathname}`);
    },

    async list(prefix) {
      const out: StoredObject[] = [];
      let cursor: string | undefined;
      do {
        const res = await list({ prefix, token, cursor, limit: 1000 });
        for (const blob of res.blobs) {
          out.push({
            pathname: blob.pathname,
            size: blob.size,
            uploadedAt: blob.uploadedAt,
          });
        }
        cursor = res.hasMore ? res.cursor : undefined;
      } while (cursor);
      return out;
    },

    async deleteMany(pathnames) {
      if (!pathnames.length) return;
      const chunkSize = 100;
      for (let i = 0; i < pathnames.length; i += chunkSize) {
        await del(pathnames.slice(i, i + chunkSize), { token });
      }
    },
  };
}

/** In-memory store for unit/round-trip tests (no network). */
export function createMemoryBlobStore(): BackupBlobStore & {
  objects: Map<string, Buffer>;
  uploadedAt: Map<string, Date>;
  setUploadedAt(pathname: string, date: Date): void;
} {
  const objects = new Map<string, Buffer>();
  const uploadedAt = new Map<string, Date>();
  return {
    objects,
    uploadedAt,
    getAccessMode() {
      return 'private';
    },
    setUploadedAt(pathname, date) {
      uploadedAt.set(pathname, date);
    },
    async putBytes(pathname, data) {
      objects.set(pathname, Buffer.from(data));
      if (!uploadedAt.has(pathname)) uploadedAt.set(pathname, new Date());
      return { pathname, size: data.length };
    },
    async getBytes(pathname) {
      const data = objects.get(pathname);
      if (!data) throw new Error(`Memory blob missing: ${pathname}`);
      return Buffer.from(data);
    },
    async list(prefix) {
      return [...objects.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([pathname, buf]) => ({
          pathname,
          size: buf.length,
          uploadedAt: uploadedAt.get(pathname) ?? new Date(0),
        }));
    },
    async deleteMany(pathnames) {
      for (const p of pathnames) {
        objects.delete(p);
        uploadedAt.delete(p);
      }
    },
  };
}
