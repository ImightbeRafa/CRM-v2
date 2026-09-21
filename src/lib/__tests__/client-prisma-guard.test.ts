import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function read(rel: string) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/** Strip block + line comments so docstring mentions don't false-positive. */
function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('client bundle must not import Prisma / server auth', () => {
  it('session-permissions stays client-safe (no prisma / auth-options / db)', () => {
    const src = codeOnly(read('src/lib/session-permissions.ts'))
    assert.doesNotMatch(src, /@prisma\/client/)
    assert.doesNotMatch(src, /auth-options/)
    assert.doesNotMatch(src, /billing-access/)
    assert.doesNotMatch(src, /from ['"]@\/lib\/db['"]/)
    assert.doesNotMatch(src, /from ['"]\.\/db['"]/)
    assert.match(src, /from ['"]\.\/rbac['"]/)
  })

  it('auth-helpers is marked server-only', () => {
    const src = read('src/lib/auth-helpers.ts')
    assert.match(src, /import ['"]server-only['"]/)
  })

  it('agentes + social client pages import session-permissions, not auth-helpers', () => {
    for (const rel of [
      'src/app/config/agentes/page.tsx',
      'src/app/config/social/page.tsx',
    ]) {
      const src = codeOnly(read(rel))
      assert.match(read(rel), /['"]use client['"]/)
      assert.match(src, /from ['"]@\/lib\/session-permissions['"]/)
      assert.doesNotMatch(src, /from ['"]@\/lib\/auth-helpers['"]/)
      assert.doesNotMatch(src, /from ['"]@\/lib\/db['"]/)
      assert.doesNotMatch(src, /from ['"]@prisma\/client['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*agent-admin['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*agent-resolver['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*agent-inbox-enrich['"]/)
    }
  })

  it('Soft trust-label client modules avoid prisma server paths', () => {
    for (const rel of [
      'src/components/chats/SoftThreadPane.tsx',
      'src/components/chats/SoftConversationList.tsx',
      'src/components/chats/SoftCopilotInboxV2.tsx',
      'src/components/chats/SoftCopilotInboxLegacy.tsx',
    ]) {
      const src = codeOnly(read(rel))
      assert.doesNotMatch(src, /from ['"]@\/lib\/auth-helpers['"]/)
      assert.doesNotMatch(src, /from ['"]@\/lib\/db['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*agent-admin['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*agent-resolver['"]/)
      assert.doesNotMatch(src, /from ['"][^'"]*agent-inbox-enrich['"]/)
      assert.doesNotMatch(src, /@prisma\/client/)
    }
  })

  it('soft-ai public barrel does not re-export Prisma agent-resolver', () => {
    const src = codeOnly(read('src/lib/soft-ai/index.ts'))
    assert.doesNotMatch(src, /from ['"][^'"]*agent-resolver['"]/)
    assert.doesNotMatch(src, /from ['"][^'"]*agent-admin['"]/)
    assert.doesNotMatch(src, /from ['"][^'"]*agent-inbox-enrich['"]/)
    assert.doesNotMatch(src, /composeEffectiveBehavior/)
  })

  it('agent-admin / agent-resolver / agent-inbox-enrich are server-only', () => {
    for (const rel of [
      'src/lib/soft-ai/agent-admin.ts',
      'src/lib/soft-ai/agent-resolver.ts',
      'src/lib/soft-ai/agent-inbox-enrich.ts',
    ]) {
      const src = read(rel)
      assert.match(src, /import ['"]server-only['"]/)
    }
  })
})
