import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createR2BlobStore, parseListObjectsV2, signV4 } from '../r2-store';
import { backupStoreKind } from '../store-factory';
import { createMemoryBlobStore } from '../blob-store';
import { getBackupStatus } from '../service';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const KEY_ID = 'AKIDEXAMPLEKEYID';
const SECRET = 'super-secret-value-never-in-errors';

test('SigV4 matches the published AWS S3 example (GET Object)', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — "Example: GET Object"
  const signed = signV4({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    canonicalUri: '/test.txt',
    query: {},
    headers: { range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    date: new Date('2013-05-24T00:00:00Z'),
    region: 'us-east-1',
    service: 's3',
  });
  assert.equal(
    signed.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
});

test('ListObjectsV2 parsing: keys (XML-escaped), sizes, dates, continuation', () => {
  const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
    <Contents><Key>betsy/a&amp;b.json</Key><Size>12</Size><LastModified>2026-10-02T02:00:00.000Z</LastModified></Contents>
    <Contents><Key>betsy/c.json</Key><Size>3</Size></Contents>
    <NextContinuationToken>tok/1==</NextContinuationToken></ListBucketResult>`;
  const parsed = parseListObjectsV2(xml);
  assert.deepEqual(parsed.objects.map((o) => o.pathname), ['betsy/a&b.json', 'betsy/c.json']);
  assert.equal(parsed.objects[0]!.size, 12);
  assert.equal(parsed.objects[0]!.uploadedAt?.toISOString(), '2026-10-02T02:00:00.000Z');
  assert.equal(parsed.next, 'tok/1==');
  assert.equal(parseListObjectsV2('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>').next, null);
});

type Call = { url: string; method: string; headers: Record<string, string> };

function fakeR2(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), method: String(init.method), headers: init.headers as Record<string, string> };
    calls.push(call);
    return handler(call, calls.length);
  }) as unknown as typeof fetch;
  const store = createR2BlobStore({
    accountId: ACCOUNT,
    bucket: 'betsy-backups',
    accessKeyId: KEY_ID,
    secretAccessKey: SECRET,
    fetchImpl,
    retryDelayMs: 1,
    timeouts: { listMs: 50, getMs: 50, putBaseMs: 50, putPerMbMs: 0, deleteMs: 50 },
  });
  return { store, calls };
}

test('put / get / list / delete hit the private bucket path with a signed request', async () => {
  const objects = new Map<string, Buffer>();
  const { store, calls } = fakeR2(async (call) => {
    const u = new URL(call.url);
    assert.equal(u.host, `${ACCOUNT}.r2.cloudflarestorage.com`);
    assert.match(call.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLEKEYID\/\d{8}\/auto\/s3\/aws4_request/);
    const key = decodeURIComponent(u.pathname.replace(/^\/betsy-backups\/?/, ''));
    if (call.method === 'PUT') {
      objects.set(key, Buffer.from('x'));
      return new Response('', { status: 200 });
    }
    if (call.method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (u.searchParams.get('list-type') === '2') {
      const body = [...objects.keys()].map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('');
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${body}</ListBucketResult>`);
    }
    return objects.has(key) ? new Response('x') : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  });
  await store.putBytes('betsy/backups/v1/manifests/run 1-full.json', Buffer.from('{}'), 'application/json');
  assert.ok(calls[0]!.url.endsWith('/betsy-backups/betsy/backups/v1/manifests/run%201-full.json'));
  assert.equal((await store.list('betsy/')).length, 1);
  assert.equal((await store.getBytes('betsy/backups/v1/manifests/run 1-full.json')).toString(), 'x');
  await store.deleteMany(['betsy/backups/v1/manifests/run 1-full.json', 'already/gone.json']);
  assert.equal(objects.size, 0);
  await assert.rejects(store.getBytes('missing.json'), /HTTP 404 NoSuchKey/);
  assert.equal(store.getAccessMode(), 'private');
});

test('a storage call that never answers is cut off, retried at most 3 times, and leaks no secret', async () => {
  const { store, calls } = fakeR2(() => new Promise<Response>(() => undefined));
  const started = Date.now();
  await assert.rejects(store.getBytes('x.json'), (err: Error) => {
    assert.match(err.message, /R2 get failed: (timeout|network error)/);
    assert.ok(!err.message.includes(SECRET) && !err.message.includes('AWS4-HMAC') && !err.message.includes(KEY_ID));
    return true;
  });
  assert.equal(calls.length, 3);
  assert.ok(Date.now() - started < 2_000);
});

test('4xx errors are not retried; 5xx are', async () => {
  const denied = fakeR2(() => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
  await assert.rejects(denied.store.list('p/'), /HTTP 403 AccessDenied/);
  assert.equal(denied.calls.length, 1);
  const flaky = fakeR2((_c, n) => (n < 3 ? new Response('', { status: 503 }) : new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')));
  assert.deepEqual(await flaky.store.list('p/'), []);
  assert.equal(flaky.calls.length, 3);
});

test('missing configuration names the variable, never a value', () => {
  assert.throws(
    () => createR2BlobStore({ accountId: ACCOUNT, bucket: 'betsy-backups', accessKeyId: KEY_ID, secretAccessKey: '' }),
    /R2_SECRET_ACCESS_KEY is required/,
  );
  assert.throws(() => createR2BlobStore({ accountId: 'nope', bucket: 'betsy-backups', accessKeyId: KEY_ID, secretAccessKey: SECRET }), /R2_ACCOUNT_ID looks invalid/);
  assert.equal(backupStoreKind({}), 'r2');
  assert.equal(backupStoreKind({ BACKUP_STORE: 'vercel' }), 'vercel');
});

test('backup status never hangs: a stalled store yields "unknown" within the deadline', async () => {
  const stalled = createMemoryBlobStore();
  stalled.list = () => new Promise(() => undefined);
  const started = Date.now();
  const status = await getBackupStatus(stalled, new Date(), 50);
  assert.equal(status.status, 'unknown');
  assert.equal(status.isHealthy, false);
  assert.ok(Date.now() - started < 1_000);
});

test('backup status is platform-admin only and returns no raw error text; page gated too', () => {
  const route = read('src/app/api/backups/status/route.ts');
  assert.match(route, /if \(!\(await isSuperAdmin\(auth\.userId\)\)\) \{\n\s+return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404/);
  assert.doesNotMatch(route, /detail:/);
  assert.match(read('src/app/backups/page.tsx'), /if \(!\(await isSuperAdmin\(userId\)\)\) redirect\('\/dashboard'\)/);
});

test('backups run on R2 with a lock, a deadline and alerts; Worker passes the R2 settings', () => {
  const service = read('src/lib/backups/service.ts');
  assert.match(service, /const store = options\.store \?\? createBackupStore\(\)/);
  assert.match(service, /pg_try_advisory_lock\(\$\{BACKUP_LOCK_KEY\}\)/);
  assert.match(service, /export const BACKUP_DEADLINE_MS = 12 \* 60_000/);
  assert.match(read('src/lib/backups/postgres.ts'), /idle_in_transaction_session_timeout: 120_000/);
  for (const p of ['src/app/api/cron/backup/route.ts', 'src/app/api/cron/backup/hot/route.ts']) {
    const r = read(p);
    assert.match(r, /requireCronBearer\(request\)/);
    assert.match(r, /await sendOpsAlert\(\{/);
    assert.doesNotMatch(r, /authHeader !== `Bearer/);
  }
  const worker = read('src/cf-container-worker.ts');
  for (const k of ['R2_ACCOUNT_ID', 'R2_BACKUP_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'OPS_ALERT_EMAIL']) {
    assert.match(worker, new RegExp(`"${k}",`));
  }
  assert.match(worker, /"0 6 \* \* \*": \["\/api\/cron\/chat-token-health", "\/api\/cron\/ops-daily"\]/);
});
