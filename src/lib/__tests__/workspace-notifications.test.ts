/** Phase 2b S4: @mentions + in-app notifications. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MENTION_MAX, normalizeMentionIds } from '../workspace-notifications'
import { activeMentionQuery, insertMention, matchTeammates, mentionIdsFromText } from '../note-mentions'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const TEAM = [
  { id: 'user_ana_000001', name: 'Ana' },
  { id: 'user_anam_00002', name: 'Ana María' },
  { id: 'user_luis_00003', name: 'Luis Pérez' },
]

test('mention ids: id-shaped strings only, unique, never the author, at most 10', () => {
  assert.deepEqual(normalizeMentionIds(['user_ana_000001', 'user_ana_000001', 'me_author_0001', 42, '<x>', 'short'], 'me_author_0001'), ['user_ana_000001'])
  const many = Array.from({ length: 30 }, (_, i) => `user_${String(i).padStart(10, '0')}`)
  assert.equal(normalizeMentionIds(many, 'x').length, MENTION_MAX)
  assert.deepEqual(normalizeMentionIds('user_ana_000001', 'x'), [])
})

test('picker: @query before the caret, accents folded, self excluded', () => {
  assert.deepEqual(activeMentionQuery('Hola @an', 8), { start: 5, query: 'an' })
  assert.equal(activeMentionQuery('mail a@b.com', 12), null, 'an email is not a mention')
  assert.deepEqual(activeMentionQuery('@', 1), { start: 0, query: '' })
  assert.deepEqual(matchTeammates(TEAM, 'pe').map((t) => t.name), ['Luis Pérez'])
  assert.deepEqual(matchTeammates(TEAM, 'an', 'user_ana_000001').map((t) => t.name), ['Ana María'])
  const ins = insertMention('Hola @an qué tal', 5, 8, TEAM[2])
  assert.equal(ins.text, 'Hola @Luis Pérez  qué tal')
  assert.equal(ins.caret, 17)
})

test('mentions are read from the text: longest name wins, removed names are not mentioned', () => {
  // Order is irrelevant; "@Ana María" must not also count as "@Ana".
  assert.deepEqual(mentionIdsFromText('Ojo @Ana María y @Luis Pérez', TEAM).sort(), ['user_anam_00002', 'user_luis_00003'])
  assert.deepEqual(mentionIdsFromText('Gracias @Ana!', TEAM), ['user_ana_000001'])
  assert.deepEqual(mentionIdsFromText('@Anabel no existe', TEAM), [])
  assert.deepEqual(mentionIdsFromText('Sin menciones', TEAM), [])
  assert.deepEqual(mentionIdsFromText('@Ana', TEAM, 'user_ana_000001'), [], 'never myself')
})

test('server: recipients re-filtered to chat members of THIS business; no note text stored', () => {
  const lib = read('src/lib/workspace-notifications.ts')
  assert.match(lib, /prisma\.membership\.findMany\(\{\s*where: \{ tenantId, userId: \{ in: userIds \}, isActive: true, user: \{ active: true \} \}/)
  assert.match(lib, /hasPermission\(r\.role as Role, 'update_sales'\)/)
  assert.match(lib, /skipDuplicates: true/)
  const create = lib.slice(lib.indexOf('createMany'), lib.indexOf('skipDuplicates'))
  assert.doesNotMatch(create, /body|snippet|title/)
  // Listing and marking are always MY rows of THIS business; deleted notes are hidden.
  assert.match(lib, /where: \{ tenantId, userId \},/)
  assert.match(lib, /where: \{ tenantId, userId, readAt: null, \.\.\.\(idList/)
  // A deleted note is never shown, and its notification stops counting as unread (N4).
  assert.match(lib, /if \(!note \|\| note\.deletedAt\) \{\n\s*if \(!r\.readAt\) hidden\.push\(r\.id\)\n\s*continue/)
  assert.match(lib, /unread: Math\.max\(0, unread - hidden\.length\)/)
})

test('notes: mentions filtered + notified once; edits notify only newly added people', () => {
  const notes = read('src/lib/crm-notes.ts')
  assert.match(notes, /mentionUserIds: mentions,/)
  assert.match(notes, /dedupeKey: \(u\) => `mention:\$\{row\.id\}:\$\{u\}`/)
  assert.match(notes, /newlyMentioned = mentions\.filter\(\(u\) => !existing\.mentionUserIds\.includes\(u\)\)/)
  const route = read('src/app/api/workspace/notifications/route.ts')
  assert.match(route, /listNotifications\(auth\.tenantId, auth\.userId\)/)
  assert.match(route, /markNotificationsRead\(auth\.tenantId, auth\.userId, json\?\.ids\)/)
})

test('chat deep link opens a chat of this business (loaded, or fetched through the tenant-scoped list)', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /if \(dtoMap\.has\(deepLinkId\)\) \{/)
  assert.match(inbox, /c && \/\^\[A-Za-z0-9_-\]\{8,64\}\$\/\.test\(c\)/)
  // The fetch goes through GET /api/chat/conversations?id=…, whose where always starts with the
  // session tenant (buildConversationListWhere).
  assert.match(read('src/lib/chat-conversation-query.ts'), /const and: Prisma\.ChatConversationWhereInput\[\] = \[\{ tenantId: args\.tenantId \}\]\n\s*if \(args\.input\.id\) and\.push\(\{ id: args\.input\.id \}\)/)
})
