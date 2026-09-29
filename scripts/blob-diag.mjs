// Read-only-ish storage diagnostic (2026-09-29): reproduces the quick-reply upload against the
// real Vercel Blob store with the same calls the app makes, then deletes its test file.
// Never prints the token. Run from the repo root:
//   node --env-file=.env.local scripts/blob-diag.mjs
import { put, get, list, del } from '@vercel/blob'

const token = process.env.BLOB_READ_WRITE_TOKEN
if (!token) {
  console.log('BLOB_READ_WRITE_TOKEN is not in .env.local')
  process.exit(1)
}
console.log('token present, prefix:', token.slice(0, 18) + '…', 'length', token.length)
const pathname = `chat-quick-replies/_diag/diag${Date.now().toString(36)}.png`
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a50000000049454e44ae426082',
  'hex',
)
const safe = (e) => String(e?.name || '') + ': ' + String(e?.message || e).replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, '[token]')

async function step(name, fn) {
  const t = Date.now()
  try {
    const r = await fn()
    console.log(`OK   ${name} (${Date.now() - t} ms)`, r ?? '')
    return true
  } catch (e) {
    console.log(`FAIL ${name} (${Date.now() - t} ms) → ${safe(e)}`)
    return false
  }
}

// Same options as putChatMediaToBlob (private, fixed name, no overwrite).
const privateOk = await step('put private (app path)', async () => {
  const r = await put(pathname, png, { access: 'private', token, contentType: 'image/png', addRandomSuffix: false, allowOverwrite: false })
  return r.pathname
})
if (privateOk) {
  await step('get private', async () => {
    const r = await get(pathname, { access: 'private', token })
    return `status ${r?.statusCode}`
  })
}
await step('list prefix (quota check)', async () => {
  const r = await list({ prefix: 'chat-quick-replies/', limit: 5, token })
  return `${r.blobs.length} blobs`
})
await step('list chat-media (thread cache)', async () => {
  const r = await list({ prefix: 'chat-media/', limit: 5, token })
  return `${r.blobs.length} blobs`
})
await step('list backups', async () => {
  const r = await list({ prefix: 'backups/', limit: 3, token })
  return `${r.blobs.length} blobs, newest: ${r.blobs.map((b) => b.uploadedAt).sort().pop() || '—'}`
})
if (privateOk) await step('delete test file', () => del(pathname, { token }))
