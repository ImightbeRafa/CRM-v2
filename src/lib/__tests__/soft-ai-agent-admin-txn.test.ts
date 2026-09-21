/**
 * Agent admin: audit must stay outside interactive $transaction (P2028 fix),
 * plus clear Spanish API error mapping for SCHEMA_NOT_READY / P2028 / name conflicts.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import {
  CHAT_AGENT_ADMIN_TX,
  mapChatAgentAdminError,
} from '../soft-ai/agent-admin'

describe('chat agent admin txn + audit (P2028)', () => {
  it('exposes raised interactive txn timeouts as belt-and-suspenders', () => {
    assert.equal(CHAT_AGENT_ADMIN_TX.timeout, 20_000)
    assert.equal(CHAT_AGENT_ADMIN_TX.maxWait, 20_000)
  })

  it('createChatAgent / updateChatAgent do not nest logAuditEvent inside $transaction', () => {
    const admin = readFileSync(
      join(process.cwd(), 'src/lib/soft-ai/agent-admin.ts'),
      'utf8',
    )

    function assertAuditOutsideTxn(fnName: string) {
      const start = admin.indexOf(`export async function ${fnName}`)
      assert.ok(start >= 0, `${fnName} missing`)
      const nextExport = admin.indexOf('\nexport async function ', start + 1)
      const body = admin.slice(start, nextExport === -1 ? undefined : nextExport)
      assert.doesNotMatch(
        body,
        /\$transaction\s*\(\s*async/,
        `${fnName} must not use interactive $transaction`,
      )
      assert.match(body, /await logAuditEvent\(/, `${fnName} must still audit`)
      assert.match(
        body,
        /prisma\.chatAgent\.(create|update)\(/,
        `${fnName} must write via prisma.chatAgent`,
      )
    }

    assertAuditOutsideTxn('createChatAgent')
    assertAuditOutsideTxn('updateChatAgent')
  })
})

describe('mapChatAgentAdminError', () => {
  it('maps SCHEMA_NOT_READY to 503 with Spanish copy', () => {
    const mapped = mapChatAgentAdminError(new Error('SCHEMA_NOT_READY'))
    assert.ok(mapped)
    assert.equal(mapped.status, 503)
    assert.equal(mapped.body.code, 'SCHEMA_NOT_READY')
    assert.match(mapped.body.error, /SQL 027/)
    assert.equal(mapped.body.schemaReady, false)
  })

  it('maps P2028 to retryable Spanish timeout', () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      'Transaction already closed: A timeout has occurred.',
      { code: 'P2028', clientVersion: 'test' },
    )
    const mapped = mapChatAgentAdminError(err)
    assert.ok(mapped)
    assert.equal(mapped.status, 503)
    assert.equal(mapped.body.code, 'P2028')
    assert.match(mapped.body.error, /tardó demasiado|Reintentá/i)
  })

  it('maps P2002 on name to NAME_CONFLICT 409', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['tenantId', 'name'] },
    })
    const mapped = mapChatAgentAdminError(err)
    assert.ok(mapped)
    assert.equal(mapped.status, 409)
    assert.equal(mapped.body.code, 'NAME_CONFLICT')
    assert.match(mapped.body.error, /nombre/i)
  })

  it('returns null for unknown errors', () => {
    assert.equal(mapChatAgentAdminError(new Error('SOMETHING_ELSE')), null)
  })
})
