/**
 * SD58-01 — knowledge create must reject cross-tenant socialAccountId (404).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireTenantSocialAccount } from '../soft-ai/agent-admin'
import { mapKnowledgeAdminError } from '../soft-ai/knowledge-admin'
import { formatKnowledgeLayersForPrompt } from '../soft-ai/llm/prompt'
import type { ApprovedKnowledgeSlice, KnowledgeSourceDto } from '../soft-ai/knowledge-types'

describe('SD58-01 knowledge socialAccountId tenant ownership', () => {
  it('requireTenantSocialAccount rejects cross-tenant id (same gate create uses)', async () => {
    await assert.rejects(
      () =>
        requireTenantSocialAccount('tenant-a', 'account-from-tenant-b', {
          findFirst: async () => null,
        }),
      (err: unknown) =>
        err instanceof Error && err.message === 'SOCIAL_ACCOUNT_NOT_FOUND',
    )
  })

  it('mapKnowledgeAdminError maps SOCIAL_ACCOUNT_NOT_FOUND to 404', () => {
    const mapped = mapKnowledgeAdminError(new Error('SOCIAL_ACCOUNT_NOT_FOUND'))
    assert.ok(mapped)
    assert.equal(mapped.status, 404)
    assert.equal(mapped.body.code, 'SOCIAL_ACCOUNT_NOT_FOUND')
  })

  it('createKnowledgeSource calls requireTenantSocialAccount before create write', () => {
    const admin = readFileSync(
      join(process.cwd(), 'src/lib/soft-ai/knowledge-admin.ts'),
      'utf8',
    )
    const createIdx = admin.indexOf('export async function createKnowledgeSource')
    assert.ok(createIdx >= 0)
    const nextExport = admin.indexOf('\nexport async function ', createIdx + 1)
    const body = admin.slice(createIdx, nextExport === -1 ? undefined : nextExport)
    const requireIdx = body.indexOf('await requireTenantSocialAccount(')
    const writeIdx = body.indexOf('prisma.chatKnowledgeSource.create')
    assert.ok(requireIdx >= 0, 'create must call requireTenantSocialAccount')
    assert.ok(writeIdx > requireIdx, 'ownership check must run before create write')
    assert.match(body, /channel_overlay/)
  })

  it('bindKnowledgeToAgent rejects non-approved sources', () => {
    const admin = readFileSync(
      join(process.cwd(), 'src/lib/soft-ai/knowledge-admin.ts'),
      'utf8',
    )
    const bindIdx = admin.indexOf('export async function bindKnowledgeToAgent')
    const nextExport = admin.indexOf('\nexport async function ', bindIdx + 1)
    const body = admin.slice(bindIdx, nextExport === -1 ? undefined : nextExport)
    assert.match(body, /SOURCE_NOT_APPROVED/)
    assert.match(body, /status !== 'approved'/)
  })

  it('knowledge fence attributes quote-escape name', () => {
    const source: KnowledgeSourceDto = {
      id: 's1',
      tenantId: 't1',
      socialAccountId: null,
      kind: 'policy',
      name: 'Políticas "envío" <test>',
      body: 'texto',
      status: 'approved',
      version: 1,
      contentHash: 'abc',
      metadata: null,
      approvedBy: 'u1',
      approvedAt: '2026-09-21T00:00:00.000Z',
      createdBy: 'u1',
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    }
    const slice: ApprovedKnowledgeSlice = {
      brandBook: [],
      policies: [source],
      faqs: [],
      channelOverlay: [],
      versions: [],
    }
    const { text } = formatKnowledgeLayersForPrompt(slice)
    assert.match(text, /name="Políticas \\"envío\\" &lt;test&gt;"/)
    assert.doesNotMatch(text, /name="Políticas "envío"/)
  })
})
