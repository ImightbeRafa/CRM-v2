/**
 * Shared backup store contract + helpers (hashing, gzip, in-memory store for tests). The real
 * store is Cloudflare R2 (see r2-store.ts / store-factory.ts).
 */
import { createHash } from 'crypto';
import { promisify } from 'util';
import { gunzipSync, gzip, gzipSync } from 'zlib';

const gzipAsync = promisify(gzip);

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
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function gzipJsonlLines(lines: string[]): Buffer {
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  return gzipSync(Buffer.from(body, 'utf8'));
}

/**
 * Same as gzipJsonlLines but on the libuv thread pool: backups run inside the container that serves
 * every user, and a synchronous gzip of a large table froze all requests while it ran.
 */
export async function gzipJsonlLinesAsync(lines: string[]): Promise<Buffer> {
  const body = lines.length ? `${lines.join('\n')}\n` : '';
  return gzipAsync(Buffer.from(body, 'utf8'));
}

export async function gzipBufferAsync(data: Buffer): Promise<Buffer> {
  return gzipAsync(data);
}

export function gunzipToString(data: Buffer): string {
  return gunzipSync(data).toString('utf8');
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
