import { createHash, createHmac } from 'crypto';
import type { BackupBlobStore, StoredObject } from './blob-store';

/**
 * Cloudflare R2 backup store over the S3 API (AWS Signature V4, signed here with node:crypto, no
 * extra dependency). Private bucket, bucket-scoped token. Every call has a hard timeout and at
 * most 2 retries (5xx / 429 / network only), so a stalled storage call can never hang a backup or
 * the status page (2026-10-02: the Vercel Blob calls had no timeout and backups failed silently).
 *
 * Error messages never contain the keys, the Authorization header or a signed URL.
 */
export interface R2StoreConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetchImpl?: typeof fetch;
  /** Overrides for tests. */
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>;
  retryDelayMs?: number;
  now?: () => Date;
}

export const DEFAULT_TIMEOUTS = {
  listMs: 8_000,
  /** Whole download incl. body; restores pull large artifacts (R2_GET_TIMEOUT_MS overrides). */
  getMs: 120_000,
  putBaseMs: 30_000,
  putPerMbMs: 1_000,
  deleteMs: 10_000,
};

const MAX_ATTEMPTS = 3;
const REGION = 'auto';
const SERVICE = 's3';
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export class R2Error extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'R2Error';
  }
}

/** RFC 3986 encoding as S3 SigV4 expects (unreserved: A-Z a-z 0-9 - . _ ~). */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function amzDate(d: Date): { amz: string; day: string } {
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz, day: amz.slice(0, 8) };
}

/**
 * Pure SigV4 header signing (exported for the published AWS test vector).
 * `canonicalUri` must already be encoded; query values are encoded here.
 */
export function signV4(input: {
  method: string;
  host: string;
  canonicalUri: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
  region?: string;
  service?: string;
}): { authorization: string; amzDate: string; signedHeaders: string } {
  const region = input.region ?? REGION;
  const service = input.service ?? SERVICE;
  const { amz, day } = amzDate(input.date);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...input.headers, host: input.host, 'x-amz-date': amz, 'x-amz-content-sha256': input.payloadHash })) {
    headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(input.query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(input.query[k] ?? '')}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate: amz,
    signedHeaders,
  };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]!) : null;
}

/** ListObjectsV2 response → objects + continuation token. */
export function parseListObjectsV2(xml: string): { objects: StoredObject[]; next: string | null } {
  const objects: StoredObject[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1]!;
    const key = tag(block, 'Key');
    if (!key) continue;
    const size = Number(tag(block, 'Size') ?? '0');
    const modified = tag(block, 'LastModified');
    objects.push({
      pathname: key,
      size: Number.isFinite(size) ? size : 0,
      uploadedAt: modified ? new Date(modified) : undefined,
    });
  }
  const truncated = tag(xml, 'IsTruncated') === 'true';
  return { objects, next: truncated ? tag(xml, 'NextContinuationToken') : null };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bounded even when the fetch implementation ignores the abort signal (or the body never ends):
 * the request is aborted AND the wait is raced against a timer.
 */
async function withHardTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createR2BlobStore(config: R2StoreConfig): BackupBlobStore {
  for (const [name, value] of [
    ['R2_ACCOUNT_ID', config.accountId],
    ['R2_BACKUP_BUCKET', config.bucket],
    ['R2_ACCESS_KEY_ID', config.accessKeyId],
    ['R2_SECRET_ACCESS_KEY', config.secretAccessKey],
  ] as const) {
    if (!value || !String(value).trim()) throw new Error(`${name} is required for R2 backup storage`);
  }
  if (!/^[a-f0-9]{32}$/i.test(config.accountId.trim())) throw new Error('R2_ACCOUNT_ID looks invalid');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket.trim())) throw new Error('R2_BACKUP_BUCKET looks invalid');

  const host = `${config.accountId.trim().toLowerCase()}.r2.cloudflarestorage.com`;
  const bucket = config.bucket.trim();
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
  const retryDelayMs = config.retryDelayMs ?? 500;
  const now = config.now ?? (() => new Date());

  async function call(opts: {
    method: 'GET' | 'PUT' | 'DELETE';
    key?: string;
    query?: Record<string, string>;
    body?: Buffer;
    contentType?: string;
    timeoutMs: number;
    what: string;
    okStatuses?: number[];
  }): Promise<{ ok: true; status: number; body: Buffer }> {
    const canonicalUri = `/${encodeRfc3986(bucket)}${opts.key !== undefined ? `/${encodeKeyPath(opts.key)}` : ''}`;
    const query = opts.query ?? {};
    const qs = Object.keys(query)
      .sort()
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k]!)}`)
      .join('&');
    const url = `https://${host}${canonicalUri}${qs ? `?${qs}` : ''}`;
    const payloadHash = opts.body ? sha256(opts.body) : EMPTY_SHA256;
    let lastError: R2Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const extraHeaders: Record<string, string> = {};
      if (opts.contentType) extraHeaders['content-type'] = opts.contentType;
      const signed = signV4({
        method: opts.method,
        host,
        canonicalUri,
        query,
        headers: extraHeaders,
        payloadHash,
        accessKeyId: config.accessKeyId.trim(),
        secretAccessKey: config.secretAccessKey.trim(),
        date: now(),
      });
      try {
        // The whole exchange (headers AND body) is inside the hard timeout.
        const outcome = await withHardTimeout(opts.timeoutMs, async (signal) => {
          const res = await fetchImpl(url, {
            method: opts.method,
            headers: {
              ...extraHeaders,
              authorization: signed.authorization,
              'x-amz-date': signed.amzDate,
              'x-amz-content-sha256': payloadHash,
            },
            body: opts.body,
            signal,
            cache: 'no-store',
          });
          if (res.ok || opts.okStatuses?.includes(res.status)) {
            return { ok: true as const, status: res.status, body: Buffer.from(await res.arrayBuffer()) };
          }
          // Only an S3 error code (never echoed request data) goes into the message.
          const text = await res.text().catch(() => '');
          return { ok: false as const, status: res.status, code: tag(text, 'Code') ?? 'unknown' };
        });
        if (outcome.ok) return outcome;
        const retryable = outcome.status >= 500 || outcome.status === 429;
        lastError = new R2Error(`R2 ${opts.what} failed: HTTP ${outcome.status} ${outcome.code}`, outcome.status, retryable);
      } catch (err) {
        const name = err instanceof Error ? err.name : 'Error';
        const timedOut = name === 'TimeoutError' || name === 'AbortError';
        lastError = new R2Error(`R2 ${opts.what} failed: ${timedOut ? 'timeout' : 'network error'}`, null, true);
      }
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(retryDelayMs * attempt);
    }
    throw lastError ?? new R2Error(`R2 ${opts.what} failed`, null, false);
  }

  return {
    getAccessMode() {
      return 'private';
    },

    async putBytes(pathname, data, contentType) {
      const mb = Math.ceil(data.length / (1024 * 1024));
      await call({
        method: 'PUT',
        key: pathname,
        body: data,
        contentType,
        timeoutMs: timeouts.putBaseMs + mb * timeouts.putPerMbMs,
        what: 'put',
      });
      return { pathname, size: data.length };
    },

    async getBytes(pathname) {
      return (await call({ method: 'GET', key: pathname, timeoutMs: timeouts.getMs, what: 'get' })).body;
    },

    async list(prefix) {
      const out: StoredObject[] = [];
      let token: string | null = null;
      for (let page = 0; page < 1000; page++) {
        const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
        if (token) query['continuation-token'] = token;
        const res = await call({ method: 'GET', query, timeoutMs: timeouts.listMs, what: 'list' });
        const parsed = parseListObjectsV2(res.body.toString('utf8'));
        out.push(...parsed.objects);
        token = parsed.next;
        if (!token) break;
      }
      return out;
    },

    async deleteMany(pathnames) {
      // One DELETE per object (DeleteObjects needs Content-MD5), 8 at a time. Missing = done.
      const queue = [...pathnames];
      const worker = async () => {
        for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
          await call({ method: 'DELETE', key: p, timeoutMs: timeouts.deleteMs, what: 'delete', okStatuses: [404] });
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
    },
  };
}

/** Builds the store from env; the error names a missing variable, never a value. */
export function createR2BlobStoreFromEnv(env: Record<string, string | undefined> = process.env): BackupBlobStore {
  return createR2BlobStore({
    accountId: env.R2_ACCOUNT_ID || '',
    bucket: env.R2_BACKUP_BUCKET || '',
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
    timeouts: Number(env.R2_GET_TIMEOUT_MS) > 0 ? { getMs: Number(env.R2_GET_TIMEOUT_MS) } : undefined,
  });
}
