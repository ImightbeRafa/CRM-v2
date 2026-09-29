// Live check of chat storage on Supabase (writes + deletes one tiny test file). No secrets printed.
//   npx tsx --env-file=.env.local scripts/storage-live-check.ts
import { CHAT_STORAGE_BUCKET, chatStorageGet, chatStoragePut, chatStorageRemove, chatStorageUsage } from '../src/lib/chat-storage'

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a50000000049454e44ae426082', 'hex')
const path = `chat-quick-replies/_healthcheck/check${Date.now().toString(36)}.png`
const step = async (name: string, fn: () => Promise<unknown>) => {
  const t = Date.now()
  try {
    const r = await fn()
    console.log(`OK   ${name} ${Date.now() - t}ms`, r === undefined ? '' : JSON.stringify(r))
  } catch (e) {
    console.log(`FAIL ${name} ${Date.now() - t}ms`, e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    process.exitCode = 1
  }
}
console.log('bucket:', CHAT_STORAGE_BUCKET)
await step('put (creates bucket if missing)', () => chatStoragePut(path, png, 'image/png'))
await step('get', async () => {
  const r = await chatStorageGet(path)
  return { bytes: r.bytes.length, same: r.bytes.equals(png), type: r.contentType }
})
await step('put again same name (must be refused, no overwrite)', async () => {
  try {
    await chatStoragePut(path, png, 'image/png')
    return 'UNEXPECTED: overwrite allowed'
  } catch (e) {
    return `refused: ${(e as Error).message.slice(0, 60)}`
  }
})
await step('usage', () => chatStorageUsage('chat-quick-replies/_healthcheck'))
await step('delete', () => chatStorageRemove([path]))
await step('get after delete (must be not found)', async () => {
  try {
    await chatStorageGet(path)
    return 'UNEXPECTED: still there'
  } catch (e) {
    return `gone: ${(e as Error).message.slice(0, 50)}`
  }
})
