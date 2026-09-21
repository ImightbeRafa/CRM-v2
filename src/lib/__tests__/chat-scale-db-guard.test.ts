import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertChatScaleDatabaseUrl,
  percentile,
  summarizeLatencies,
} from '../../../scripts/lib/chat-scale-db-guard'

describe('chat-scale-db-guard', () => {
  it('requires CHAT_SCALE_DATABASE_URL', () => {
    const result = assertChatScaleDatabaseUrl('')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /CHAT_SCALE_DATABASE_URL is required/)
  })

  it('refuses supabase hosts', () => {
    const result = assertChatScaleDatabaseUrl(
      'postgresql://postgres:x@db.abcdef.supabase.co:5432/postgres',
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /Supabase/)
  })

  it('refuses pooler port 6543', () => {
    const result = assertChatScaleDatabaseUrl('postgresql://u:p@127.0.0.1:6543/postgres')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /6543/)
  })

  it('refuses non-loopback hosts', () => {
    const result = assertChatScaleDatabaseUrl('postgresql://u:p@10.0.0.5:5432/postgres')
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /non-loopback/)
  })

  it('accepts loopback postgres URLs', () => {
    for (const url of [
      'postgresql://u:p@127.0.0.1:5432/chat_scale',
      'postgres://u:p@localhost:5432/chat_scale',
      'postgresql://u:p@[::1]:5432/chat_scale',
    ]) {
      const result = assertChatScaleDatabaseUrl(url)
      assert.equal(result.ok, true, url)
    }
  })

  it('summarizes latencies with p50/p95', () => {
    const summary = summarizeLatencies([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    assert.equal(summary.count, 10)
    assert.equal(summary.p50Ms, percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50))
    assert.equal(summary.p95Ms, percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95))
  })
})
