/**
 * Instagram SocialAccount upsert: same-tenant reconnect vs cross-tenant conflict.
 * In-memory delegate only — no Prisma or Supabase writes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import { Prisma } from '@prisma/client'
import {
  InstagramSocialAccountConflictError,
  instagramAccountOwnedElsewhereHtml,
  upsertInstagramSocialAccount,
  type InstagramSocialAccountDelegate,
  type UpsertInstagramSocialAccountParams,
} from '../instagram-social-account'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-ig-social-account'

const TENANT = 'cmteijij70000jsoyedmtfnl1'
const OTHER = 'other-tenant'
const IG_ID = '17841400000000000'

type Row = {
  id: string
  tenantId: string
  isActive: boolean
  displayName: string | null
  expiresAt: Date | null
}

function p2002(target: string[] | string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  })
}

function baseParams(overrides: Partial<UpsertInstagramSocialAccountParams> = {}): UpsertInstagramSocialAccountParams {
  return {
    tenantId: TENANT,
    userId: 'user-reconnect',
    igBusinessAccountId: IG_ID,
    pageAccessToken: 'EAA_PAGE_TOKEN',
    pageId: 'page-99',
    pageName: 'Betsy Page',
    igUsername: 'betsy.shop',
    isActive: true,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    ...overrides,
  }
}

function isSameTenantWhere(where: Record<string, unknown>): boolean {
  return typeof where.tenantId === 'string'
}

function isForeignActiveWhere(where: Record<string, unknown>): boolean {
  const tenantId = where.tenantId
  return Boolean(tenantId) && typeof tenantId === 'object'
}

function delegateFrom(handlers: {
  findFirst: InstagramSocialAccountDelegate['findFirst']
  create?: InstagramSocialAccountDelegate['create']
  update?: InstagramSocialAccountDelegate['update']
}): InstagramSocialAccountDelegate & { creates: unknown[]; updates: Array<{ id: string; data: Record<string, unknown> }> } {
  const creates: unknown[] = []
  const updates: Array<{ id: string; data: Record<string, unknown> }> = []
  return {
    creates,
    updates,
    findFirst: handlers.findFirst,
    create: async (args) => {
      creates.push(args.data)
      if (handlers.create) return handlers.create(args)
      return { id: 'created-1', ...args.data }
    },
    update: async (args) => {
      updates.push({ id: args.where.id, data: args.data })
      if (handlers.update) return handlers.update(args)
      return { id: args.where.id, ...args.data }
    },
  }
}

describe('upsertInstagramSocialAccount', () => {
  it('updates the same-tenant row and does not create', async () => {
    const keptExpires = new Date('2026-08-01T00:00:00.000Z')
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isSameTenantWhere(where)) {
          return {
            id: 'row-same',
            displayName: 'Mi tienda',
            expiresAt: keptExpires,
          }
        }
        return null
      },
    })

    await upsertInstagramSocialAccount(
      baseParams({ expiresAt: undefined, userId: 'user-2' }),
      db,
    )

    assert.equal(db.creates.length, 0)
    assert.equal(db.updates.length, 1)
    assert.equal(db.updates[0].id, 'row-same')
    const data = db.updates[0].data
    assert.equal(data.userId, 'user-2')
    assert.equal(data.isActive, true)
    assert.equal(data.refreshToken, 'page:page-99')
    assert.equal(data.displayName, 'Mi tienda')
    assert.equal(data.providerUsername, 'betsy.shop')
    assert.equal(data.pageId, 'page-99')
    assert.equal(data.expiresAt, keptExpires)
    assert.equal(data.disconnectedAt, null)
    assert.equal(typeof data.accessToken, 'string')
    assert.match(String(data.accessToken), /^enc:/)
  })

  it('reactivates an inactive same-tenant row instead of creating', async () => {
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isSameTenantWhere(where)) {
          return { id: 'row-inactive', displayName: null, expiresAt: null }
        }
        return null
      },
    })

    await upsertInstagramSocialAccount(baseParams({ isActive: true }), db)

    assert.equal(db.creates.length, 0)
    assert.equal(db.updates.length, 1)
    assert.equal(db.updates[0].id, 'row-inactive')
    assert.equal(db.updates[0].data.isActive, true)
    assert.equal(db.updates[0].data.userId, 'user-reconnect')
  })

  it('conflicts when another tenant actively owns the asset', async () => {
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isForeignActiveWhere(where)) return { id: 'row-foreign' }
        return null
      },
    })

    await assert.rejects(
      () => upsertInstagramSocialAccount(baseParams(), db),
      (error: unknown) => {
        assert.ok(error instanceof InstagramSocialAccountConflictError)
        assert.equal(error.code, 'INSTAGRAM_ACCOUNT_OWNED_ELSEWHERE')
        assert.doesNotMatch(error.message, /P2002|Prisma|cmteijij|other-tenant/i)
        return true
      },
    )
    assert.equal(db.creates.length, 0)
    assert.equal(db.updates.length, 0)
  })

  it('does not reactivate our row when another tenant is the active owner', async () => {
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isSameTenantWhere(where)) {
          return { id: 'row-ours-inactive', displayName: null, expiresAt: null }
        }
        if (isForeignActiveWhere(where)) return { id: 'row-foreign-active' }
        return null
      },
    })

    await assert.rejects(
      () => upsertInstagramSocialAccount(baseParams({ isActive: true }), db),
      InstagramSocialAccountConflictError,
    )
    assert.equal(db.creates.length, 0)
    assert.equal(db.updates.length, 0)
  })

  it('creates an inactive row when another tenant is active and subscribe failed', async () => {
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isSameTenantWhere(where)) return null
        if (isForeignActiveWhere(where)) return { id: 'row-foreign-active' }
        return null
      },
    })

    await upsertInstagramSocialAccount(baseParams({ isActive: false }), db)

    assert.equal(db.updates.length, 0)
    assert.equal(db.creates.length, 1)
    const created = db.creates[0] as Record<string, unknown>
    assert.equal(created.tenantId, TENANT)
    assert.equal(created.accountId, IG_ID)
    assert.equal(created.isActive, false)
    assert.notEqual(created.id, 'row-foreign-active')
  })

  it('recovers a create P2002 race by updating the same-tenant row', async () => {
    let created = false
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isSameTenantWhere(where)) {
          return created
            ? { id: 'row-raced', displayName: 'Alias', expiresAt: null }
            : null
        }
        return null
      },
      create: async () => {
        created = true
        throw p2002(['platform', 'accountId', 'tenantId'])
      },
    })

    await upsertInstagramSocialAccount(baseParams(), db)

    assert.equal(db.creates.length, 1)
    assert.equal(db.updates.length, 1)
    assert.equal(db.updates[0].id, 'row-raced')
    assert.equal(db.updates[0].data.displayName, 'Alias')
    assert.equal(db.updates[0].data.userId, 'user-reconnect')
  })

  it('maps a reactivation P2002 to a conflict and does not create', async () => {
    const db = delegateFrom({
      findFirst: async ({ where }) => {
        if (isSameTenantWhere(where)) {
          return { id: 'row-ours', displayName: null, expiresAt: null }
        }
        return null
      },
      update: async () => {
        throw p2002(['platform', 'accountId'])
      },
    })

    await assert.rejects(
      () => upsertInstagramSocialAccount(baseParams(), db),
      InstagramSocialAccountConflictError,
    )
    assert.equal(db.creates.length, 0)
    assert.equal(db.updates.length, 1)
    assert.equal(db.updates[0].id, 'row-ours')
  })

  it('maps a legacy global unique P2002 to conflict without touching the other row', async () => {
    const foreign: Row = {
      id: 'row-foreign-inactive',
      tenantId: OTHER,
      isActive: false,
      displayName: 'Theirs',
      expiresAt: null,
    }
    const db = delegateFrom({
      findFirst: async () => null,
      create: async () => {
        throw p2002('SocialAccount_platform_accountId_key')
      },
    })

    await assert.rejects(
      () => upsertInstagramSocialAccount(baseParams({ isActive: false }), db),
      InstagramSocialAccountConflictError,
    )
    assert.equal(db.updates.length, 0)
    assert.equal(foreign.tenantId, OTHER)
    assert.equal(foreign.isActive, false)
  })

  it('rethrows unrelated P2002 and non-Prisma errors', async () => {
    const unrelated = delegateFrom({
      findFirst: async () => null,
      create: async () => {
        throw p2002(['email'])
      },
    })
    await assert.rejects(
      () => upsertInstagramSocialAccount(baseParams(), unrelated),
      (error: unknown) => {
        assert.ok(error instanceof Prisma.PrismaClientKnownRequestError)
        assert.equal(error instanceof InstagramSocialAccountConflictError, false)
        return true
      },
    )

    const down = delegateFrom({
      findFirst: async () => null,
      create: async () => {
        throw new Error('db down')
      },
    })
    await assert.rejects(
      () => upsertInstagramSocialAccount(baseParams(), down),
      (error: unknown) => error instanceof Error && error.message === 'db down',
    )
  })
})

describe('instagram connect conflict responses', () => {
  it('Spanish HTML names the conflict and leaks neither Prisma nor tenant ids', () => {
    const html = instagramAccountOwnedElsewhereHtml()
    assert.match(html, /otro espacio de trabajo/)
    assert.match(html, /Desconectala/)
    assert.doesNotMatch(html, /P2002|Prisma|tenantId|accountId/)

    const callback = readFileSync(
      resolve('src/app/api/auth/instagram/callback/route.ts'),
      'utf8',
    )
    const complete = readFileSync(
      resolve('src/app/api/auth/instagram/complete/route.ts'),
      'utf8',
    )
    for (const src of [callback, complete]) {
      assert.match(src, /InstagramSocialAccountConflictError/)
      assert.match(src, /instagramAccountOwnedElsewhereHtml/)
      assert.match(src, /409/)
    }
  })
})
