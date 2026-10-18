import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  conversationDisplayName,
  formatPeerDisplayName,
  hasStoredPeerAvatar,
  isPlaceholderPeerName,
  peerAvatarRoute,
  peerAvatarStoragePath,
} from '../chat-peer-display'
import {
  backfillInstagramPeerProfiles,
  cleanProfileName,
  enrichInstagramPeerProfile,
  fetchInstagramUserProfile,
  PEER_PROFILE_RECHECK_MS,
  scheduleInstagramPeerProfile,
} from '../instagram-peer-profile'
import { mapConversationToListDto, type ConversationRow } from '../chat-conversation-api'

const read = (p: string) => readFileSync(p, 'utf8')

type Call = { url: string; init: RequestInit }

function fakeFetch(handler: (url: string) => { status: number; body: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = handler(String(url))
    const body = r.body instanceof Uint8Array ? r.body : JSON.stringify(r.body)
    return new Response(body as BodyInit, { status: r.status, headers: r.headers })
  }) as typeof fetch
  return { impl, calls }
}

function fakeDb(conv: Record<string, any> | null) {
  const updates: Array<{ where: any; data: any }> = []
  const finds: any[] = []
  const db = {
    chatConversation: {
      findFirst: async (q: any) => {
        finds.push(q.where)
        if (!conv) return null
        // A snapshot, like Prisma: later writes don't change the row the code already read.
        return q.where.id === conv.id && q.where.tenantId === conv.tenantId ? { ...conv } : null
      },
      updateMany: async (q: any) => {
        updates.push(q)
        if ('peerProfileCheckedAt' in q.where) {
          const cur = conv?.peerProfileCheckedAt ?? null
          const want = q.where.peerProfileCheckedAt
          const same = (cur?.getTime?.() ?? cur) === (want?.getTime?.() ?? want)
          if (!same) return { count: 0 }
        }
        if (conv) Object.assign(conv, q.data)
        return { count: 1 }
      },
      findMany: async () => (conv ? [{ id: conv.id, tenantId: conv.tenantId }] : []),
    },
  }
  return { db, updates, finds }
}

function igConv(extra: Record<string, any> = {}) {
  return {
    id: 'conv1',
    tenantId: 't1',
    peerId: '1234567890',
    peerName: 'Instagram User 567890',
    peerUsername: null,
    peerAvatarUrl: null,
    peerProfileCheckedAt: null,
    socialAccount: { platform: 'instagram', accessToken: 'page-token', isActive: true, disconnectedAt: null, tokenStatus: 'valid' },
    ...extra,
  }
}

describe('chat-peer-display (pure)', () => {
  it('detects the webhook placeholder only', () => {
    assert.equal(isPlaceholderPeerName('Instagram User 076336'), true)
    assert.equal(isPlaceholderPeerName(''), true)
    assert.equal(isPlaceholderPeerName(null), true)
    assert.equal(isPlaceholderPeerName('Ana Pérez'), false)
    assert.equal(isPlaceholderPeerName('Instagram User Ana'), false)
  })

  it('formats "Name (@username)" and its fallbacks', () => {
    assert.equal(formatPeerDisplayName('Ana Pérez', 'ana.p'), 'Ana Pérez (@ana.p)')
    assert.equal(formatPeerDisplayName('Instagram User 076336', 'ana.p'), '@ana.p')
    assert.equal(formatPeerDisplayName('@ana.p', 'ana.p'), '@ana.p')
    assert.equal(formatPeerDisplayName('Ana Pérez', null), 'Ana Pérez')
    assert.equal(formatPeerDisplayName('Ana', 'bad name!'), 'Ana')
    assert.equal(
      conversationDisplayName({ recipientName: 'Instagram User 076336', recipientUsername: null, recipientId: '9' }),
      'Instagram User 076336',
    )
    assert.equal(conversationDisplayName({ recipientId: '506' }), '506')
  })

  it('avatar path is tenant + conversation scoped; never a URL', () => {
    assert.equal(peerAvatarStoragePath('t1', 'c1'), 'chat-media/t1/avatars/c1')
    assert.equal(hasStoredPeerAvatar({ tenantId: 't1', id: 'c1', peerAvatarUrl: 'chat-media/t1/avatars/c1' }), true)
    assert.equal(hasStoredPeerAvatar({ tenantId: 't2', id: 'c1', peerAvatarUrl: 'chat-media/t1/avatars/c1' }), false)
    assert.equal(hasStoredPeerAvatar({ tenantId: 't1', id: 'c1', peerAvatarUrl: 'https://scontent.cdninstagram.com/x.jpg' }), false)
    assert.equal(peerAvatarRoute('c1', new Date(5)), '/api/chat/conversations/c1/avatar?v=5')
  })

  it('cleans Meta names (control / bidi chars, length)', () => {
    assert.equal(cleanProfileName('  Ana‮  Pérez\n'), 'Ana Pérez')
    assert.equal(cleanProfileName('x'.repeat(200))?.length, 80)
    assert.equal(cleanProfileName(42), null)
  })
})

describe('list DTO', () => {
  const base = {
    id: 'c1', tenantId: 't1', socialAccountId: 's1', peerId: '1234567', peerName: 'Ana', clientId: null,
    status: 'nuevo', assignedUserId: null, aiMode: null, tags: [], lastMessageId: null, lastMessageAt: new Date(0),
    lastMessagePreview: null, lastMessageDirection: null, lastInboundAt: null, inboundCount: 0, revision: BigInt(1),
  }
  it('ships username + our avatar route, never the stored path or a Meta URL', () => {
    const dto = mapConversationToListDto({
      ...base, peerAvatarUrl: 'chat-media/t1/avatars/c1', peerUsername: 'ana.p', peerProfileCheckedAt: new Date(7),
    } as ConversationRow)
    assert.equal(dto.recipientUsername, 'ana.p')
    assert.equal(dto.recipientAvatarUrl, '/api/chat/conversations/c1/avatar?v=7')
    assert.ok(!JSON.stringify(dto).includes('chat-media/'))
    const cdn = mapConversationToListDto({ ...base, peerAvatarUrl: 'https://scontent.cdninstagram.com/a.jpg' } as ConversationRow)
    assert.equal(cdn.recipientAvatarUrl, null)
    assert.ok(!JSON.stringify(cdn).includes('cdninstagram'))
  })
})

describe('fetchInstagramUserProfile', () => {
  it('calls Graph /{IGSID}?fields=name,username,profile_pic with the bearer token', async () => {
    const f = fakeFetch(() => ({
      status: 200,
      body: { name: 'Ana Pérez', username: 'ana.p', profile_pic: 'https://scontent-mia3-1.cdninstagram.com/v/p.jpg' },
    }))
    const r = await fetchInstagramUserProfile({ igsid: '1234567890', accessToken: 'tok', fetchImpl: f.impl })
    assert.deepEqual(r, {
      ok: true,
      profile: { name: 'Ana Pérez', username: 'ana.p', profilePic: 'https://scontent-mia3-1.cdninstagram.com/v/p.jpg' },
    })
    assert.match(f.calls[0].url, /^https:\/\/graph\.facebook\.com\/v[\d.]+\/1234567890\?fields=name,username,profile_pic/)
    assert.equal((f.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok')
  })

  it('refuses a non-numeric IGSID without calling Meta (no path injection)', async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }))
    const r = await fetchInstagramUserProfile({ igsid: '../me/accounts', accessToken: 'tok', fetchImpl: f.impl })
    assert.deepEqual(r, { ok: false, rateLimited: false })
    assert.equal(f.calls.length, 0)
  })

  it('drops a profile_pic that is not on a Meta CDN host', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { name: 'A', profile_pic: 'https://evil.example/fbcdn.net/p.jpg' } }))
    const r = await fetchInstagramUserProfile({ igsid: '1234567890', accessToken: 'tok', fetchImpl: f.impl })
    assert.equal(r.ok && r.profile.profilePic, null)
  })

  it('reports Meta rate limits', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: { code: 4, message: 'limit' } } }))
    assert.deepEqual(await fetchInstagramUserProfile({ igsid: '1234567890', accessToken: 'tok', fetchImpl: f.impl }), {
      ok: false,
      rateLimited: true,
      pageLimited: false,
    })
  })
})

describe('enrichInstagramPeerProfile', () => {
  const profileOk = (pic?: string) =>
    fakeFetch((url) =>
      url.startsWith('https://graph.facebook.com/')
        ? { status: 200, body: { name: 'Ana Pérez', username: 'ana.p', ...(pic ? { profile_pic: pic } : {}) } }
        : { status: 200, body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/jpeg' } },
    )

  it('replaces the placeholder with the real name + username (tenant-scoped reads and writes)', async () => {
    const conv = igConv()
    const { db, updates, finds } = fakeDb(conv)
    const f = profileOk()
    const r = await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db, fetchImpl: f.impl })
    assert.equal(r.status, 'updated')
    assert.equal(conv.peerName, 'Ana Pérez')
    assert.equal(conv.peerUsername, 'ana.p')
    assert.deepEqual(finds[0], { id: 'conv1', tenantId: 't1' })
    assert.ok(updates.every((u) => u.where.tenantId === 't1' && u.where.id === 'conv1'))
  })

  it('never overwrites a real name already on the chat', async () => {
    const conv = igConv({ peerName: 'Ana (cliente VIP)' })
    const { db } = fakeDb(conv)
    await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db, fetchImpl: profileOk().impl })
    assert.equal(conv.peerName, 'Ana (cliente VIP)')
    assert.equal(conv.peerUsername, 'ana.p')
  })

  it('another tenant cannot enrich (or read) the chat', async () => {
    const { db } = fakeDb(igConv())
    const f = profileOk()
    const r = await enrichInstagramPeerProfile({ tenantId: 't2', conversationId: 'conv1' }, { db, fetchImpl: f.impl })
    assert.deepEqual(r, { status: 'skipped', reason: 'not_found' })
    assert.equal(f.calls.length, 0)
  })

  it('skips WhatsApp chats and chats looked up recently', async () => {
    const wa = fakeDb(igConv({ socialAccount: { platform: 'whatsapp', accessToken: 'x', isActive: true } }))
    const f = profileOk()
    assert.equal((await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db: wa.db, fetchImpl: f.impl })).status, 'skipped')
    const now = new Date('2026-10-18T12:00:00Z')
    const recent = fakeDb(igConv({ peerProfileCheckedAt: new Date(now.getTime() - 60_000) }))
    const r = await enrichInstagramPeerProfile(
      { tenantId: 't1', conversationId: 'conv1' },
      { db: recent.db, fetchImpl: f.impl, now: () => now },
    )
    assert.deepEqual(r, { status: 'skipped', reason: 'recent' })
    assert.equal(f.calls.length, 0)
  })

  it('a concurrent lookup that already claimed the chat wins (no second Meta call)', async () => {
    const conv = igConv()
    const { db } = fakeDb(conv)
    const realUpdate = db.chatConversation.updateMany
    db.chatConversation.updateMany = async (q: any) => ('peerProfileCheckedAt' in q.where ? { count: 0 } : realUpdate(q))
    const f = profileOk()
    const r = await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db, fetchImpl: f.impl })
    assert.deepEqual(r, { status: 'skipped', reason: 'claimed_elsewhere' })
    assert.equal(f.calls.length, 0)
  })

  it('a Meta error keeps the current label and retries in hours, not a week', async () => {
    const now = new Date('2026-10-18T12:00:00Z')
    const conv = igConv()
    const { db } = fakeDb(conv)
    const f = fakeFetch(() => ({ status: 400, body: { error: { code: 100, message: 'nope' } } }))
    const r = await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db, fetchImpl: f.impl, now: () => now })
    assert.deepEqual(r, { status: 'failed', rateLimited: false, pageLimited: false })
    assert.equal(conv.peerName, 'Instagram User 567890')
    const wait = now.getTime() - (conv.peerProfileCheckedAt as unknown as Date).getTime()
    assert.ok(wait > 0 && wait < PEER_PROFILE_RECHECK_MS, 'stamped so the next try comes before a full week')
  })

  it('never downloads a photo from a non-Meta host (SSRF) and never sends the token to the CDN', async () => {
    const conv = igConv()
    const { db } = fakeDb(conv)
    const f = profileOk('https://169.254.169.254/latest/meta-data')
    await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db, fetchImpl: f.impl })
    assert.equal(f.calls.length, 1)
    assert.equal(conv.peerAvatarUrl, null)

    const conv2 = igConv()
    const d2 = fakeDb(conv2)
    const f2 = profileOk('https://scontent-mia3-1.cdninstagram.com/v/p.jpg')
    await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db: d2.db, fetchImpl: f2.impl, putAvatar: async () => undefined })
    const cdnCall = f2.calls.find((c) => c.url.includes('cdninstagram.com'))
    assert.ok(cdnCall)
    assert.equal(new Headers(cdnCall!.init.headers).get('authorization'), null)
    // Not a real photo → no avatar saved (initials stay).
    assert.equal(conv2.peerAvatarUrl, null)
  })

  it('saves a real photo as WebP under the tenant/conversation path', async (t) => {
    let png: Buffer
    try {
      const { default: sharp } = await import('sharp')
      png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#f0a' } }).png().toBuffer()
    } catch {
      t.skip('sharp not available')
      return
    }
    const conv = igConv()
    const { db } = fakeDb(conv)
    const f = fakeFetch((url) =>
      url.startsWith('https://graph.facebook.com/')
        ? { status: 200, body: { name: 'Ana', profile_pic: 'https://scontent.xx.fbcdn.net/p.jpg' } }
        : { status: 200, body: new Uint8Array(png), headers: { 'content-type': 'image/png' } },
    )
    const saved: Array<{ path: string; bytes: Buffer }> = []
    const r = await enrichInstagramPeerProfile(
      { tenantId: 't1', conversationId: 'conv1' },
      { db, fetchImpl: f.impl, putAvatar: async (path, bytes) => void saved.push({ path, bytes }) },
    )
    assert.equal(r.status === 'updated' && r.avatar, true)
    assert.equal(saved[0].path, 'chat-media/t1/avatars/conv1')
    assert.equal(saved[0].bytes.subarray(8, 12).toString('ascii'), 'WEBP')
    assert.equal(conv.peerAvatarUrl, 'chat-media/t1/avatars/conv1')
  })
})

describe('backfill + webhook hook', () => {
  it('backfill stops on a Meta rate limit', async () => {
    const conv = igConv()
    const { db } = fakeDb(conv)
    const f = fakeFetch(() => ({ status: 429, body: { error: { code: 4 } } }))
    const r = await backfillInstagramPeerProfiles({ limit: 5 }, { db, fetchImpl: f.impl })
    assert.deepEqual(r, { checked: 1, updated: 0, failed: 1, rateLimited: true })
    // Rate limited: the claim is given back so the next run retries.
    assert.equal(conv.peerProfileCheckedAt, null)
  })

  it('a throttled page does not stop the run for other tenants and backs off ~15 min', async () => {
    const now = new Date('2026-10-18T12:00:00Z')
    const conv = igConv()
    const { db } = fakeDb(conv)
    const f = fakeFetch(() => ({ status: 400, body: { error: { code: 32 } } }))
    const r = await backfillInstagramPeerProfiles({ limit: 5 }, { db, fetchImpl: f.impl, now: () => now })
    assert.deepEqual(r, { checked: 1, updated: 0, failed: 1, rateLimited: false })
    const next = (conv.peerProfileCheckedAt as unknown as Date).getTime() + PEER_PROFILE_RECHECK_MS - now.getTime()
    assert.equal(next, 15 * 60 * 1000)
  })

  it('a new photo gets a newer ?v= than the claim', async (t) => {
    let png: Buffer
    try {
      const { default: sharp } = await import('sharp')
      png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0af' } }).png().toBuffer()
    } catch {
      t.skip('sharp not available')
      return
    }
    const now = new Date('2026-10-18T12:00:00Z')
    const conv = igConv()
    const { db, updates } = fakeDb(conv)
    const f = fakeFetch((url) =>
      url.startsWith('https://graph.facebook.com/')
        ? { status: 200, body: { name: 'Ana', profile_pic: 'https://scontent.xx.fbcdn.net/p.jpg' } }
        : { status: 200, body: new Uint8Array(png), headers: { 'content-type': 'image/png' } },
    )
    await enrichInstagramPeerProfile({ tenantId: 't1', conversationId: 'conv1' }, { db, fetchImpl: f.impl, putAvatar: async () => undefined, now: () => now })
    const claim = updates[0].data.peerProfileCheckedAt as Date
    assert.ok((conv.peerProfileCheckedAt as unknown as Date).getTime() > claim.getTime())
  })

  it('scheduleInstagramPeerProfile ignores non-Instagram events and returns synchronously', () => {
    assert.equal(scheduleInstagramPeerProfile({ tenantId: 't1', conversationId: 'c', platform: 'whatsapp' }), undefined)
  })

  it('webhook fires the lookup without awaiting it, after the message is stored', () => {
    const src = read('src/app/api/chat/webhook/route.ts')
    assert.match(src, /\n\s+scheduleInstagramPeerProfile\(\{/)
    assert.doesNotMatch(src, /await\s+scheduleInstagramPeerProfile/)
    assert.ok(src.indexOf('scheduleInstagramPeerProfile({') > src.indexOf('results.push(await storeMessage(event))'))
  })

  it('avatar route: auth, same tenant, own storage path only, no Meta fetch', () => {
    const src = read('src/app/api/chat/conversations/[id]/avatar/route.ts')
    assert.match(src, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(src, /where: \{ id, tenantId: auth\.tenantId \}/)
    assert.match(src, /hasStoredPeerAvatar\(conversation\)/)
    assert.doesNotMatch(src, /fetch\(|accessToken/)
    assert.match(src, /'X-Content-Type-Options': 'nosniff'/)
  })

  it('SQL 055 is additive only', () => {
    const sql = read('supabase/migrations/055_chat_peer_profile.sql').replace(/--.*$/gm, '')
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "peerUsername" TEXT/)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "peerProfileCheckedAt" TIMESTAMP\(3\)/)
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i)
  })
})
