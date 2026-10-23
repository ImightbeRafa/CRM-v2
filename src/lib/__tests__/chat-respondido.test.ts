import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  agentDisplayName,
  customerHandle,
  lineChannelLabel,
  orderStatusTone,
  orderTotalLabel,
  shortOrderNumber,
  withoutEmoji,
} from '../chat-row-display'
import { INBOX_VIEW_DEFS, isWaitingOnUs } from '../chat-inbox-views'

// Checkouts may use CRLF (Windows): the assertions are written for LF.
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

describe('Respondido (Rafael 2026-10-22)', () => {
  const route = read('src/app/api/chat/conversations/[id]/answered/route.ts')

  it('is a same-origin, update_sales, rate-limited, tenant-scoped write; hidden until SQL 063', () => {
    assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(route, /if \(!isSameOriginRequest\(request\)\)/)
    assert.match(route, /workspaceWriteRateLimit\(`\$\{auth\.tenantId\}:\$\{auth\.userId\}`\)/)
    assert.match(route, /where: \{ id, tenantId: auth\.tenantId \}/)
    assert.match(route, /WHERE id = \$\{convo\.id\} AND "tenantId" = \$\{auth\.tenantId\}/)
    assert.match(route, /if \(!\(await answeredMarkerReady\(\)\)\)[\s\S]{0,160}status: 409/)
    assert.match(route, /"answeredByUserId" = \$\{auth\.userId\}/)
    // Audited.
    assert.match(route, /logAuditEvent\(\{[\s\S]*entityType: 'ChatConversation'[\s\S]*userId: auth\.userId/)
  })

  it('gives a handed-off chat back to the agent only on a line that answers, and never answers the waiting message', () => {
    assert.match(route, /if \(convo\.aiMode && PERSON_MODES\.has\(convo\.aiMode\)\)/)
    // SecureDog INT-RSP-1: only an OPEN agent hand-off (no person wrote since) that nobody took on after it.
    assert.match(route, /if \(lineOn && handoffSince && !\(await staffControlledAfter\(auth\.tenantId, conversationKey, handoffSince\)\)\)/)
    assert.match(read('src/lib/chat-unanswered-server.ts'), /WHERE \$\{HANDOFF_MARKERS_SQL\} AND NOT \$\{PERSON_WROTE_SINCE_SQL\}/)
    // INT-RSP-2: conditional on the chat still being with a person (a concurrent Pausar wins).
    assert.match(route, /onlyIfAiModeIn: \[\.\.\.PERSON_MODES\]/)
    assert.match(read('src/lib/chat-agent-control.ts'), /if \(args\.onlyIfAiModeIn && res\.count === 0\) return \{ mode, keyParts, applied: false \}/)
    // Audit always written, even when the resume fails.
    assert.match(route, /resumeError = true/)
    assert.match(route, /action: 'resume'/)
    // Unlike "Devolver a IA" (control route), no sweep: the agent attends the customer's NEXT message.
    assert.doesNotMatch(route, /sweepWaitingConversation/)
    assert.match(read('src/app/api/chat/soft-ai/control/route.ts'), /sweepWaitingConversation/)
  })

  it('the server flag (incl. Respondido) wins over the client guess', () => {
    assert.equal(isWaitingOnUs({ lastMessageDirection: 'inbound', waiting: false }), false)
    assert.equal(isWaitingOnUs({ lastMessageDirection: 'outbound', waiting: true }), true)
    assert.equal(isWaitingOnUs({ lastMessageDirection: 'inbound' }), true)
    const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
    assert.match(inbox, /next\.set\(conversationId, \{ \.\.\.row, waiting: false, needsPerson: false \}\)/)
    assert.match(inbox, /if \(res\.status === 409\) setAnsweredAvailable\(false\)/)
  })

  it('SQL 063 is additive only', () => {
    const sql = read('supabase/migrations/063_chat_answered_marker.sql').replace(/--.*$/gm, '')
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMP\(3\)/)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "answeredByUserId" TEXT/)
    // DATA-RSP-1: the covered customer message, same clock as the message times.
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "answeredThroughAt" TIMESTAMP\(3\)/)
    assert.match(route, /"answeredThroughAt" = LEAST\(\s*GREATEST\(COALESCE\("lastInboundAt", "lastMessageAt"\)/)
    // Verifier #4/#5: never covers more than the person saw; a chat that is no longer waiting is a no-op.
    assert.match(route, /COALESCE\(\$\{seenThrough\}::timestamp\(3\), 'infinity'::timestamp\)/)
    assert.match(route, /if \(flags\.get\(convo\.id\)\?\.waiting === false\)/)
    assert.match(read('src/components/chats/SoftCopilotInboxV2.tsx'), /body: JSON\.stringify\(\{ seenThrough: before\.lastMessageAt \}\)/)
    assert.match(read('src/lib/rbac.ts'), /'POST \/api\/chat\/conversations\/\*\/answered': 'update_sales'/)
    assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i)
    assert.doesNotMatch(read('prisma/schema.prisma'), /answeredAt/)
  })
})

describe('chat rows: line, channel and a readable order', () => {
  it('names the business line and channel', () => {
    assert.equal(lineChannelLabel('Sleeping Patches', 'whatsapp'), 'Sleeping Patches · WhatsApp')
    assert.equal(lineChannelLabel('@forge.costarica', 'instagram'), '@forge.costarica · Instagram')
    assert.equal(lineChannelLabel('🌙 Luna Shop', 'whatsapp'), 'Luna Shop · WhatsApp')
    assert.equal(lineChannelLabel(null, 'instagram'), 'Instagram')
  })

  it('shortens generated order numbers; status tone; total in colones', () => {
    assert.equal(shortOrderNumber('ORDER-1792438318163'), '#…18163')
    assert.equal(shortOrderNumber('1042'), '#1042')
    assert.equal(shortOrderNumber('#ORD-77'), '#77')
    assert.equal(orderStatusTone('Pendiente'), 'open')
    assert.equal(orderStatusTone('Enviado'), 'shipped')
    assert.equal(orderStatusTone('Entregado'), 'done')
    assert.equal(orderStatusTone('Cancelado'), 'cancelled')
    assert.equal(orderTotalLabel(12500), '₡12 500')
    assert.equal(orderTotalLabel(0), null)
  })

  it('customer handle, agent name without emoji', () => {
    assert.equal(customerHandle({ platform: 'whatsapp', recipientId: '50688887777' }), '+506 8888 7777')
    assert.equal(customerHandle({ platform: 'instagram', recipientId: '1784', recipientUsername: 'cliente.cr' }), '@cliente.cr')
    assert.equal(agentDisplayName('Agente: 🌙 Luna · Responder'), 'Luna')
    assert.equal(withoutEmoji('IA 🤖 activa'), 'IA activa')
  })
})

describe('no emojis in /chats chrome', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(f)) files.push(p)
    }
  }
  walk('src/components/chats')
  // Message content (the emoji picker's catalogue) and the Legacy inbox are out of scope.
  const chrome = files.filter((f) => !/emoji-data|Legacy|SoftInboxBuckets|SoftSlimNav|SoftCopilotRail/.test(f))
  chrome.push('src/lib/chat-inbox-views.ts', 'src/components/aurora/states/AuroraEmptyState.tsx', 'src/components/aurora/states/AuroraErrorState.tsx', 'src/components/aurora/states/ChannelDownBanner.tsx')

  it('no pictographs or symbol icons in UI code (lucide icons instead)', () => {
    const bad: string[] = []
    for (const f of chrome) {
      read(f)
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim()
          if (/^(\/\/|\*|\/\*)/.test(t)) return
          if (/\p{Extended_Pictographic}|[◌▾ⓘ↻✦⚒∅⌕]/u.test(line)) bad.push(`${f}:${i + 1}: ${t.slice(0, 80)}`)
        })
    }
    assert.deepEqual(bad, [])
  })

  it('view tabs carry no emoji field', () => {
    for (const def of INBOX_VIEW_DEFS) assert.ok(!('emoji' in def), def.id)
  })
})
