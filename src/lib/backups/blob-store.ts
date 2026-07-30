import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';
import { del, get, list, put } from '@vercel/blob';

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

export function gunzipToString(data: Buffer): string {
  return gunzipSync(data).toString('utf8');
}

export function createVercelBlobStore(token = process.env.BLOB_READ_WRITE_TOKEN): BackupBlobStore {
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for backup storage');
  }

  return {
    async putBytes(pathname, data, contentType) {
      const result = await put(pathname, data, {
        access: 'private',
        token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { pathname: result.pathname, size: data.length };
    },

    async getBytes(pathname) {
      const result = await get(pathname, { access: 'private', token });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error(`Blob not found or unreadable: ${pathname}`);
      }
      const chunks: Buffer[] = [];
      const reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
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
      // SDK accepts pathname or URL arrays
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
