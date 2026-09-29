/** Phase 2a notes (2026-09-29): permissions, ordering, tenant scoping, never reach AI / Meta. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { canDeleteNote, canEditNote, normalizeNoteBody, NOTE_MAX_LENGTH, sortNotes } from '../crm-notes'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('body: trimmed, 1..4000 chars, strings only', () => {
  assert.equal(normalizeNoteBody('  hola \r\n mundo  '), 'hola \n mundo')
  assert.equal(normalizeNoteBody('   '), null)
  assert.equal(normalizeNoteBody('x'.repeat(NOTE_MAX_LENGTH + 1)), null)
  assert.equal(normalizeNoteBody(42), null)
})

test('author edits; author, OWNER or ADMIN delete (Rafael 2026-09-29)', () => {
  assert.equal(canEditNote({ userId: 'a', role: 'SALES' }, 'a'), true)
  assert.equal(canEditNote({ userId: 'b', role: 'OWNER' }, 'a'), false, 'owners delete, they do not rewrite others')
  assert.equal(canEditNote({ userId: 'a', role: 'SALES' }, null), false)
  assert.equal(canDeleteNote({ userId: 'a', role: 'SALES' }, 'a'), true)
  assert.equal(canDeleteNote({ userId: 'b', role: 'OWNER' }, 'a'), true)
  assert.equal(canDeleteNote({ userId: 'b', role: 'ADMIN' }, 'a'), true)
  assert.equal(canDeleteNote({ userId: 'b', role: 'MANAGER' }, 'a'), false)
})

test('pinned first (newest pin first), then newest', () => {
  const d = (s: string) => new Date(s)
  const rows = [
    { id: 'old', pinnedAt: null, createdAt: d('2026-01-01') },
    { id: 'pin1', pinnedAt: d('2026-02-01'), createdAt: d('2025-01-01') },
    { id: 'new', pinnedAt: null, createdAt: d('2026-03-01') },
    { id: 'pin2', pinnedAt: d('2026-02-05'), createdAt: d('2025-01-02') },
  ]
  assert.deepEqual(sortNotes(rows).map((r) => r.id), ['pin2', 'pin1', 'new', 'old'])
})

test('every query and write is tenant-scoped; references are checked against the tenant', () => {
  const src = read('src/lib/crm-notes.ts')
  assert.match(src, /where: \{ tenantId: args\.tenantId, deletedAt: null, kind: 'note', OR: or \}/)
  assert.match(src, /prisma\.client\.findFirst\(\{ where: \{ id: args\.clientId, tenantId: args\.tenantId \}/)
  assert.match(src, /prisma\.chatConversation\.findFirst\(\{ where: \{ id: args\.conversationId, tenantId: args\.tenantId \}/)
  assert.equal((src.match(/where: \{ id: args\.noteId, tenantId: args\.tenantId, deletedAt: null \}/g) || []).length, 2)
  const route = read('src/app/api/chat/conversations/[id]/notes/route.ts')
  assert.match(route, /where: \{ id, tenantId \}/)
  assert.match(route, /clientId: conversation\.clientId,\s*conversationId: conversation\.id/)
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

test('internal notes never reach the AI, Meta or outbound message paths (INT-03)', () => {
  const roots = [
    'src/lib/soft-ai',
    'src/lib/bot',
    'src/app/api/chat/send',
    'src/app/api/chat/send-media',
    'src/app/api/chat/send-guia',
    'src/app/api/chat/soft-ai',
    'src/app/api/chat/webhook',
    'src/app/api/cron/chat-automation',
    'src/lib/meta-api.ts',
    'src/lib/meta-capi.ts',
    'src/lib/meta-chat.ts',
  ]
  let checked = 0
  for (const root of roots) {
    const abs = path.join(process.cwd(), root)
    let files: string[] = []
    try {
      files = statSync(abs).isDirectory() ? walk(abs) : [abs]
    } catch {
      continue
    }
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      checked++
      assert.doesNotMatch(src, /crm-notes|crmNote/, f)
      // Nor the legacy Client.notes free text (select or include).
      assert.doesNotMatch(src, /\bnotes:\s*true/, f)
    }
  }
  assert.ok(checked > 20, `only ${checked} files checked`)
})

test('deleting a note wipes its text; author names never leak emails', () => {
  const src = read('src/lib/crm-notes.ts')
  assert.match(src, /deletedAt: new Date\(\), body: '\[borrada\]'/)
  assert.match(src, /staffDisplayName\(u\.name, u\.username\)/)
})

test('workspace writes use their own rate limit bucket', () => {
  for (const f of ['src/app/api/chat/conversations/[id]/notes/route.ts', 'src/app/api/crm/notes/[id]/route.ts', 'src/app/api/crm/clients/[id]/stage/route.ts']) {
    assert.match(read(f), /workspaceWriteRateLimit\(/, f)
  }
  assert.equal((read('src/app/api/crm/notes/[id]/route.ts').match(/await limited\(/g) || []).length, 2)
})

test('suggestions and search results never carry the legacy client note', () => {
  const src = read('src/app/api/chat/conversations/[id]/client/route.ts')
  const base = src.slice(src.indexOf('const clientSelect'), src.indexOf('} as const'))
  assert.doesNotMatch(base, /notes/)
  assert.equal((src.match(/select: linkedClientSelect/g) || []).length, 1)
})

test('routes need update_sales and are registered', () => {
  for (const f of ['src/app/api/chat/conversations/[id]/notes/route.ts', 'src/app/api/crm/notes/[id]/route.ts']) {
    assert.match(read(f), /authenticateAPIWithPermission\(request, 'update_sales'\)/, f)
  }
  const rbac = read('src/lib/rbac.ts')
  for (const k of ["'GET /api/chat/conversations/*/notes'", "'POST /api/chat/conversations/*/notes'", "'PATCH /api/crm/notes/*'", "'DELETE /api/crm/notes/*'"]) {
    assert.ok(rbac.includes(k), k)
  }
})
