/** Phase 2a stages / tags (2026-09-29): defaults, validation, closed semantics, wiring. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_CLIENT_STAGES,
  defaultStages,
  isClosedCategory,
  stageCategoryOf,
  stageKeyFromLabel,
  stageLabelOf,
  validateStageList,
  validateTagList,
} from '../crm-stages'
import { filterSoftConversations, isConversationClosed } from '../chat-soft-copilot'
import { summarizeLineCounts } from '../chat-line-filter'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('client lifecycle defaults = Rafael’s list, in order', () => {
  assert.deepEqual(DEFAULT_CLIENT_STAGES.map((s) => s.label), ['Nuevo lead', 'Cotizando', 'Esperando pago', 'Pagado', 'En producción', 'Enviado', 'Entregado', 'Recurrente'])
})

test('chat system stages stay; they can be relabelled; category fixed', () => {
  const chat = defaultStages('chat')
  const relabelled = chat.map((s) => (s.key === 'hecho' ? { ...s, label: 'Cerrado', category: 'open' } : s))
  const ok = validateStageList('chat', [...relabelled, { label: 'Esperando depósito', category: 'open' }, { label: 'Perdido', category: 'lost' }])
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.stages.find((s) => s.key === 'hecho')?.label, 'Cerrado')
    assert.equal(ok.stages.find((s) => s.key === 'hecho')?.category, 'won', 'system chat category cannot change')
    assert.equal(ok.stages.find((s) => s.key === 'esperando_deposito')?.category, 'open')
    assert.equal(ok.stages.find((s) => s.key === 'perdido')?.category, 'lost')
  }
  const missing = validateStageList('chat', chat.filter((s) => s.key !== 'hecho'))
  assert.equal(missing.ok, false)
  assert.equal(validateStageList('chat', [...chat, { label: 'Nuevo' , key: 'nuevo' }]).ok, false, 'duplicates refused')
  assert.equal(validateStageList('chat', []).ok, false)
})

test('keys from labels are stable ascii', () => {
  assert.equal(stageKeyFromLabel('Esperando depósito'), 'esperando_deposito')
  assert.equal(stageKeyFromLabel('¡¡¡'), 'etapa')
})

test('closed = won or lost; unknown keys count as open; labels for archived stages', () => {
  const stages = defaultStages('chat').concat([{ key: 'perdido', label: 'Perdido', color: null, position: 3, category: 'lost', targetMinutes: null, isSystem: false, archived: true }])
  assert.equal(isClosedCategory(stageCategoryOf(stages, 'hecho')), true)
  assert.equal(isClosedCategory(stageCategoryOf(stages, 'perdido')), true)
  assert.equal(isClosedCategory(stageCategoryOf(stages, 'algo_viejo')), false)
  assert.equal(stageLabelOf(stages, 'perdido'), 'Perdido (archivada)')
})

test('buckets and counters use the closed flag (custom closed stages leave Abiertos)', () => {
  const base = { messages: [], socialAccountId: 'a', platform: 'whatsapp', accountLabel: 'x', recipientId: 'r', unreadCount: 1 } as never
  const convs = [
    { ...(base as object), id: '1', status: 'perdido', closed: true },
    { ...(base as object), id: '2', status: 'esperando_pago', closed: false },
    { ...(base as object), id: '3', status: 'hecho' },
  ] as never[]
  const open = filterSoftConversations(convs, { bucket: 'abiertos', channel: 'all', accountId: 'all', search: '' } as never)
  assert.deepEqual((open as unknown as Array<{ id: string }>).map((c) => c.id), ['2'])
  assert.equal(isConversationClosed({ status: 'hecho' }), true, 'legacy fallback')
  assert.equal(summarizeLineCounts(convs as never).total.open, 1)
})

test('tags: legacy keys kept, custom allowed, duplicates refused', () => {
  const ok = validateTagList([{ key: 'VIP', label: 'Cliente VIP' }, { label: 'Mayorista' }])
  assert.equal(ok.ok, true)
  if (ok.ok) assert.deepEqual(ok.tags.map((t) => t.key), ['VIP', 'Mayorista'])
  assert.equal(validateTagList([{ label: 'A' }, { label: 'a' }]).ok, false)
})

test('wiring: PATCH validates the key per business; list maps categories; custom tags pass through', () => {
  const patch = read('src/app/api/chat/conversations/[id]/route.ts')
  assert.match(patch, /isAllowedChatStage\(auth\.tenantId, body\.status\)/)
  // The list maps every row with the business's chat stages (loaded alongside the page query).
  const list = read('src/app/api/chat/conversations/route.ts')
  assert.match(list, /\{ stages: chatStages \}/)
  assert.match(list, /loadStages\(auth\.tenantId, 'chat'\)/)
  assert.match(list, /mapConversationToListDto\(\s*mapRawConversationRow\([\s\S]*?\),\s*chatStages,/)
  // The changes poll only loads stages when something changed.
  assert.match(read('src/app/api/chat/conversations/changes/route.ts'), /const chatStages = rows\.length \? \(await loadStages\(auth\.tenantId, 'chat'\)\)\.stages : \[\]/)
  assert.doesNotMatch(read('src/lib/chat-inbox-v2-client.ts'), /coerceSoftTags/)
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.doesNotMatch(inbox, /status !== 'hecho'/)
  const cfg = read('src/app/api/config/crm-stages/route.ts')
  assert.match(cfg, /authenticateAPIWithPermission\(request, 'update_config'\)/)
  assert.match(read('src/lib/crm-stages-server.ts'), /Stages removed from the list are archived, never deleted/)
})

test('SecureDog regressions: AUTH-37 list reads, AUTH-38 guía GET, DATA-07 tag/stage writes', () => {
  for (const f of ['src/app/api/config/crm-stages/route.ts', 'src/app/api/config/chat-tags/route.ts']) {
    assert.match(read(f), /!hasPermission\(auth\.role, 'update_sales'\) && !hasPermission\(auth\.role, 'view_config'\)/, f)
  }
  const guia = read('src/app/api/shipping/generate-guia/route.ts')
  assert.match(guia, /authenticateAPIWithPermission\(request, 'view_production'\)/)
  assert.match(guia, /omit: \{ pdfData: true \}/)
  assert.match(guia, /shippingGuia\.findMany\(\{ where: \{ tenantId \}/)
  const patch = read('src/app/api/chat/conversations/[id]/route.ts')
  assert.match(patch, /loadTags\(auth\.tenantId\)/)
  assert.match(patch, /workspaceWriteRateLimit\(/)
  const imp = read('src/app/api/chat/conversations/import-local-state/route.ts')
  assert.match(imp, /isAllowedChatStage\(/)
  assert.match(imp, /loadTags\(/)
  assert.match(imp, /workspaceWriteRateLimit\(/)
  const server = read('src/lib/crm-stages-server.ts')
  assert.equal((server.match(/Date\.now\(\) < tablesMissingUntil/g) || []).length, 2, 'INFRA-09 memo on stages and tags')
})

test('DATA-11: note edits and deletes only touch a live note of this business', () => {
  const src = read('src/lib/crm-notes.ts')
  assert.equal((src.match(/updateMany\(\{\s*where: \{ id: existing\.id, tenantId: args\.tenantId, deletedAt: null \}/g) || []).length, 2)
  assert.doesNotMatch(src, /crmNote\.update\(/)
})
