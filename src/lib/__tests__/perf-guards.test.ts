import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

test('no raw BEGIN / COMMIT on the shared Prisma client (breaks with a connection pool > 1)', () => {
  const offenders = walk('src').filter((f) => {
    const src = read(f)
    return /\$(executeRaw|queryRaw)(Unsafe)?\s*\(?\s*[`'"]\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i.test(src)
  })
  assert.deepEqual(offenders, [], 'use prisma.$transaction(async (tx) => …) instead')
  // The two billing-week routes now use one interactive transaction.
  for (const f of ['src/app/api/logistics/billing-weeks/route.ts', 'src/app/api/logistics/billing-weeks/revert/route.ts']) {
    const src = read(f)
    assert.match(src, /await prisma\.\$transaction\(async \(tx\) =>/, f)
    const body = src.slice(src.indexOf('await prisma.$transaction(async (tx) =>'))
    const txBody = body.slice(0, body.indexOf('}, { timeout: 30_000'))
    assert.doesNotMatch(txBody, /prisma\.\$(executeRaw|queryRaw)/, `${f}: every statement inside must use tx`)
  }
  assert.match(read('src/app/api/logistics/billing-weeks/revert/route.ts'), /WHERE billed_week_id = \$1 FOR UPDATE/)
})

test('Serializable order transactions retry a serialization conflict (P2034)', () => {
  const src = read('src/lib/order-lifecycle.ts')
  assert.match(src, /export async function withSerializationRetry/)
  assert.match(src, /\?\.code === 'P2034'/)
  const create = src.slice(src.indexOf('export async function createLifecycleOrder'), src.indexOf('const mutableOrderFields'))
  assert.match(create, /withSerializationRetry\(\(\) => prisma\.\$transaction\(async tx =>/)
  const update = src.slice(src.indexOf('export async function updateLifecycleOrder'), src.indexOf('export async function setLifecycleOrderStatus'))
  assert.match(update, /withSerializationRetry\(\(\) => prisma\.\$transaction\(async tx =>/)
})

test('worker: container gets a real DB pool; only immutable build files are edge-cached', () => {
  const w = read('src/cf-container-worker.ts')
  assert.match(w, /envVars\.PRISMA_CONNECTION_LIMIT = \(source\.PRISMA_CONNECTION_LIMIT \|\| ""\)\.trim\(\) \|\| "6"/)
  const cache = w.slice(w.indexOf('async function edgeCachedStatic'), w.indexOf('export default {'))
  assert.match(cache, /if \(request\.method !== "GET"\) return null/)
  assert.match(cache, /EDGE_CACHEABLE_PREFIX\) \|\| url\.pathname\.includes\("\.\."\)\) return null/)
  assert.match(w, /const EDGE_CACHEABLE_PREFIX = "\/_next\/static\/"/)
  // Key = origin + path (no query, no cookies); only accept-encoding reaches the container.
  assert.match(cache, /new Request\(`\$\{url\.origin\}\$\{url\.pathname\}`, \{ method: "GET" \}\)/)
  assert.match(cache, /headers: \{ "accept-encoding": request\.headers\.get\("accept-encoding"\) \|\| "gzip" \}/)
  assert.match(cache, /fresh\.status === 200 && cc\.includes\("immutable"\) && !fresh\.headers\.has\("set-cookie"\)/)
  // Everything else still goes through the header-stripping path.
  assert.match(w, /const cached = await edgeCachedStatic\(request, env, ctx\)\.catch\(\(\) => null\);\s*if \(cached\) return cached;/)
  assert.match(w, /return fetchWithFailover\(env, new Request\(request, \{ headers \}\)\)/)
})

test('client JS uses Next.js default chunking (no per-package / enforced commons override)', () => {
  const cfg = read('next.config.js')
  assert.doesNotMatch(cfg, /splitChunks|cacheGroups|runtimeChunk/)
})

test('chat inbox: the sync-age label ticks by itself, not the whole inbox', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.doesNotMatch(inbox, /setSyncAgeSeconds|window\.setInterval\(ageTick/)
  assert.match(inbox, /lastSyncAt=\{lastSyncAt\}/)
  const label = read('src/components/chats/SyncAgeLabel.tsx')
  assert.match(label, /document\.visibilityState === 'visible'/)
})

test('withSerializationRetry: retries P2034 only, at most 3 times', async () => {
  const { withSerializationRetry } = await import('../order-lifecycle')
  let calls = 0
  const ok = await withSerializationRetry(async () => {
    calls += 1
    if (calls < 3) throw Object.assign(new Error('conflict'), { code: 'P2034' })
    return 'done'
  })
  assert.equal(ok, 'done')
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(withSerializationRetry(async () => {
    calls += 1
    throw Object.assign(new Error('conflict'), { code: 'P2034' })
  }), /conflict/)
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(withSerializationRetry(async () => {
    calls += 1
    throw Object.assign(new Error('other'), { code: 'P2002' })
  }), /other/)
  assert.equal(calls, 1, 'other errors are never retried')
})

test('worker: container objects are pinned to Eastern North America (next to the database)', () => {
  const w = read('src/cf-container-worker.ts')
  assert.match(w, /const CONTAINER_LOCATION_HINT: DurableObjectLocationHint = "enam"/)
  assert.match(w, /idFromName\(name\), \{\s*locationHint: CONTAINER_LOCATION_HINT,/)
  assert.match(w, /const CONTAINER_INSTANCE_NAME = "betsy-main-enam-1"/)
  assert.match(w, /const STANDBY_INSTANCE_NAME = "betsy-standby-enam-1"/)
  // Every route to a container goes through the pinned stub.
  assert.doesNotMatch(w, /getContainer\(/)
})
