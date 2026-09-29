/**
 * Chat file storage on Supabase Storage (2026-09-29): private bucket, path fence, bucket
 * auto-create, timeouts, and the quick-reply change endpoint.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { beforeEach, describe } from 'node:test'

process.env.SUPABASE_URL = 'https://proj.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
delete process.env.BLOB_READ_WRITE_TOKEN

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }
let calls: Call[] = []
let responder: (c: Call) => Response | Promise<Response> = () => new Response('{}', { status: 200 })
beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = {
      url: String(input),
      method: String(init?.method || 'GET'),
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) || {})),
      body: init?.body,
    }
    calls.push(c)
    return responder(c)
  }) as typeof fetch
})

describe('chat storage (Supabase)', () => {
  test('upload goes to the private bucket at the same path, with the service key', async () => {
    const { chatStoragePut, CHAT_STORAGE_BUCKET } = await import('../chat-storage')
    responder = () => new Response('{"Key":"x"}', { status: 200 })
    const out = await chatStoragePut('chat-quick-replies/t1/abcdefgh.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg')
    assert.equal(out.size, 3)
    assert.equal(calls[0].url, `https://proj.supabase.co/storage/v1/object/${CHAT_STORAGE_BUCKET}/chat-quick-replies/t1/abcdefgh.jpg`)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers.Authorization, 'Bearer service-key')
    assert.equal(calls[0].headers['x-upsert'], 'false')
  })
  test('refuses anything outside the chat folders (backups, traversal)', async () => {
    const { chatStoragePut } = await import('../chat-storage')
    for (const bad of ['backups/db.json', 'chat-media/../backups/x', 'chat-media//x', '/chat-media/x']) {
      await assert.rejects(chatStoragePut(bad, new Uint8Array([1]), 'image/png'), /outside the chat folders/, bad)
    }
    assert.equal(calls.length, 0)
  })
  test('creates the private bucket on first use, then retries the write', async () => {
    const { chatStoragePut } = await import('../chat-storage')
    let n = 0
    responder = (c) => {
      if (c.url.endsWith('/storage/v1/bucket')) return new Response('{"name":"betsy-chat"}', { status: 200 })
      n += 1
      return n === 1
        ? new Response('{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', { status: 400 })
        : new Response('{"Key":"x"}', { status: 200 })
    }
    await chatStoragePut('chat-media/t1/m1', new Uint8Array([1]), 'image/png', { overwrite: true })
    const bucketCall = calls.find((c) => c.url.endsWith('/storage/v1/bucket'))
    assert.ok(bucketCall)
    assert.equal(JSON.parse(String(bucketCall!.body)).public, false)
    assert.equal(calls.filter((c) => c.url.includes('/object/')).length, 2)
  })
  test('rejected credentials and timeouts become clear categories', async () => {
    const { chatStorageGet, ChatStorageError } = await import('../chat-storage')
    const { describeBlobError } = await import('../chat-media')
    responder = () => new Response('{"message":"Invalid Compact JWS"}', { status: 403 })
    const err = await chatStorageGet('chat-media/t1/m1').catch((e) => e)
    assert.ok(err instanceof ChatStorageError)
    assert.equal(describeBlobError(err).code, 'storage_rejected')
    responder = () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' })
    }
    const t = await chatStorageGet('chat-media/t1/m1').catch((e) => e)
    assert.equal(describeBlobError(t).code, 'storage_timeout')
  })
  test('usage counts files in the tenant folder', async () => {
    const { chatStorageUsage } = await import('../chat-storage')
    responder = () =>
      new Response(JSON.stringify([{ id: 'a', metadata: { size: 10 } }, { id: 'b', metadata: { size: 5 } }, { id: null }]), { status: 200 })
    assert.deepEqual(await chatStorageUsage('chat-quick-replies/t1'), { count: 2, bytes: 15 })
    assert.equal(JSON.parse(String(calls[0].body)).prefix, 'chat-quick-replies/t1')
  })
  test('chat-media no longer talks to Vercel Blob directly; backups still do (off-site)', () => {
    assert.doesNotMatch(readFileSync('src/lib/chat-media.ts', 'utf8'), /from '@vercel\/blob'/)
    assert.match(readFileSync('src/lib/backups/blob-store.ts', 'utf8'), /from '@vercel\/blob'/)
  })
})

describe('quick replies: one change per request, applied under a row lock', () => {
  test('POST applies upsert / delete inside a transaction with SELECT … FOR UPDATE', () => {
    const r = readFileSync('src/app/api/chat/quick-replies/route.ts', 'utf8')
    assert.match(r, /export async function POST/)
    assert.match(r, /prisma\.\$transaction\(async \(tx\) =>/)
    assert.match(r, /SELECT "settings" FROM "Tenant" WHERE "id" = \$\{auth\.tenantId\} FOR UPDATE/)
    assert.match(r, /Ya existe \//)
    assert.match(readFileSync('src/lib/rbac.ts', 'utf8'), /'POST \/api\/chat\/quick-replies': 'update_config'/)
  })
  test('the inbox sends single changes and never a version number', () => {
    const inbox = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
    assert.match(inbox, /body: JSON\.stringify\(change\)/)
    assert.doesNotMatch(inbox, /quickRepliesVersion/)
  })
  test('the worker forwards the Supabase storage settings to the container', () => {
    const w = readFileSync('src/cf-container-worker.ts', 'utf8')
    assert.match(w, /"SUPABASE_URL",\n\s+"SUPABASE_SERVICE_ROLE_KEY",/)
  })
})
