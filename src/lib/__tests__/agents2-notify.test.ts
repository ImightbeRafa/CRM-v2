/**
 * Agentes IA 2.0 · notify — a receipt / cash-on-delivery order handed to a person tags the chat
 * ("Pago por verificar" / "Pedido por confirmar"), alerts the whole chat team with its own kind, and the
 * bell / inbox make it hard to miss. Pure functions + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  handoffDedupeKey,
  normalizeHandoffReason,
  reviewRecipients,
  reviewTagForHandoffCode,
  reviewDedupeKey,
} from '@/lib/soft-ai/handoff-notify'
import {
  HANDOFF_REASON_LABELS,
  isReviewNotificationKind,
  reviewKindForHandoffCode,
  paymentReviewVariant,
  paymentVariantFromDedupeKey,
  reviewNotificationText,
} from '@/lib/workspace-notifications'
import {
  allowedChatTagKeys,
  BUILTIN_CHAT_TAGS,
  DEFAULT_CHAT_TAGS,
  isBuiltinChatTag,
  ORDER_REVIEW_TAG,
  PAYMENT_REVIEW_TAG,
  withBuiltinTags,
  type TagDef,
} from '@/lib/crm-stages'
import {
  detectNewReviewAlerts,
  FIRST_LOAD_FRESH_MS,
  notificationPollMs,
  POLL_HIDDEN_MS,
  POLL_VISIBLE_MS,
  titleWithCount,
  unreadReviewCount,
  type AlertItem,
} from '@/lib/notification-alerts'
import {
  filterSoftConversations,
  REVIEW_CHIP_DEFS,
  reviewTagCounts,
  type SoftConversation,
} from '@/lib/chat-soft-copilot'
import { patchConversationBodySchema } from '@/lib/chat-conversation-api'

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8')
const NOW = Date.UTC(2026, 9, 16, 15, 0, 0)

describe('notify · reason codes', () => {
  it("'order_ready' is a known code; receipts stay 'payment'", () => {
    assert.equal(normalizeHandoffReason('order_ready', 'handoff'), 'order_ready')
    assert.equal(normalizeHandoffReason('Pedido contra entrega por confirmar', 'handoff'), 'order_ready')
    assert.equal(normalizeHandoffReason('cash_on_delivery_complete', 'handoff'), 'order_ready')
    // "pago contra entrega" is an order, not a receipt.
    assert.equal(normalizeHandoffReason('pago contra entrega', 'handoff'), 'order_ready')
    assert.equal(normalizeHandoffReason('payment', 'handoff'), 'payment')
    assert.equal(normalizeHandoffReason('payment_receipt', 'handoff'), 'payment')
    assert.equal(normalizeHandoffReason('payment_details_not_shareable', 'review'), 'payment_details')
    assert.equal(normalizeHandoffReason('opt_out', 'handoff'), 'human_request')
    assert.ok(HANDOFF_REASON_LABELS.order_ready)
  })

  it('dedupe stays per conversation + customer message + code', () => {
    assert.equal(handoffDedupeKey('handoff', 'conv_12345678', 'msg_aaaa1111', 'order_ready'), 'ai_handoff:conv_12345678:msg_aaaa1111:order_ready')
    assert.notEqual(
      handoffDedupeKey('handoff', 'conv_12345678', 'msg_aaaa1111', 'payment'),
      handoffDedupeKey('handoff', 'conv_12345678', 'msg_aaaa1111', 'order_ready'),
    )
  })
})

describe('notify · chat tag on settle', () => {
  it('payment → Pago por verificar, order_ready → Pedido por confirmar, others → none', () => {
    assert.equal(reviewTagForHandoffCode('payment'), PAYMENT_REVIEW_TAG)
    assert.equal(reviewTagForHandoffCode('order_ready'), ORDER_REVIEW_TAG)
    for (const code of ['payment_details', 'human_request', 'complaint', 'escalate', 'review', '', null]) {
      assert.equal(reviewTagForHandoffCode(code), null)
    }
    assert.equal(PAYMENT_REVIEW_TAG, 'Pago por verificar')
    assert.equal(ORDER_REVIEW_TAG, 'Pedido por confirmar')
  })

  it('the tag is added idempotently, tenant-scoped, by the server (no PATCH, no customer text)', () => {
    const src = read('src/lib/soft-ai/handoff-notify.ts')
    assert.match(src, /const reviewTag = reviewTagForHandoffCode\(code\)/)
    assert.match(src, /where: \{ id: conv\.id, tenantId: input\.tenantId, NOT: \{ tags: \{ has: reviewTag \} \} \}/)
    assert.match(src, /data: \{ tags: \{ push: reviewTag \} \}/)
    // Never touches aiMode (settleHandoff in agent-turn.ts owns that).
    assert.doesNotMatch(src, /aiMode:/)
  })
})

describe('notify · recipients and text', () => {
  it('assignee first, then the chat team, also when the chat has an owner; unique, max 10', () => {
    assert.deepEqual(reviewRecipients('u_owner', ['u_a', 'u_owner', 'u_b']), ['u_owner', 'u_a', 'u_b'])
    assert.deepEqual(reviewRecipients(null, ['u_a', 'u_b']), ['u_a', 'u_b'])
    const team = Array.from({ length: 15 }, (_, i) => `u_${i}`)
    assert.equal(reviewRecipients('u_x', team).length, 10)
    assert.equal(reviewRecipients('u_x', team)[0], 'u_x')
    const src = read('src/lib/soft-ai/handoff-notify.ts')
    assert.match(src, /const recipients = reviewRecipients\(assignee, await chatTeam\(input\.tenantId\)\)/)
    assert.match(src, /kind: reviewKind,/)
    // Other codes keep the old behaviour (assignee only, else team; kind ai_no_reply).
    assert.match(src, /const userIds = assignee \? \[assignee\] : await chatTeam\(input\.tenantId\)/)
    assert.match(src, /kind: 'ai_no_reply'/)
  })

  it('kinds and Spanish text (customer name or number, no message text)', () => {
    assert.equal(reviewKindForHandoffCode('payment'), 'payment_review')
    assert.equal(reviewKindForHandoffCode('order_ready'), 'order_review')
    assert.equal(reviewKindForHandoffCode('human_request'), null)
    assert.ok(isReviewNotificationKind('payment_review'))
    assert.ok(!isReviewNotificationKind('ai_no_reply'))
    assert.deepEqual(reviewNotificationText('payment_review', 'Ana'), {
      title: '💳 Verificá un pago · Ana',
      snippet: 'Mandó el comprobante — revisalo y confirmá el pedido',
    })
    assert.deepEqual(reviewNotificationText('order_review', '50688887777'), {
      title: '📦 Pedido por confirmar · 50688887777',
      snippet: 'Pidió contra entrega — confirmá los datos',
    })
    assert.equal(reviewNotificationText('payment_review', '  ').title, '💳 Verificá un pago · un cliente')
    const notes = read('src/lib/workspace-notifications.ts')
    assert.match(notes, /\| 'payment_review'/)
    assert.match(notes, /\| 'order_review'/)
    assert.match(notes, /isReviewNotificationKind\(r\.kind\)/)
    // Kinds allowed by SQL 049 (no new SQL needed).
    const sql = read('supabase/migrations/049_chat_agent_settings.sql')
    assert.match(sql, /'payment_review', 'order_review'/)
  })
})

describe('notify · built-in tags are always valid', () => {
  const tenant: TagDef[] = [{ key: 'VIP', label: 'VIP', color: 'amber', position: 0, isSystem: true, archived: false }]

  it('catalog gets the built-ins (once, active, own colour) without changing the tenant list', () => {
    const merged = withBuiltinTags(tenant)
    assert.deepEqual(merged.map((t) => t.key), ['VIP', PAYMENT_REVIEW_TAG, ORDER_REVIEW_TAG])
    const archivedCopy: TagDef[] = [...tenant, { key: PAYMENT_REVIEW_TAG, label: 'x', color: 'slate', position: 1, isSystem: false, archived: true }]
    const again = withBuiltinTags(archivedCopy)
    assert.equal(again.filter((t) => t.key === PAYMENT_REVIEW_TAG).length, 1)
    assert.equal(again.find((t) => t.key === PAYMENT_REVIEW_TAG)?.archived, false)
    assert.equal(again.find((t) => t.key === PAYMENT_REVIEW_TAG)?.color, 'rose')
    assert.equal(BUILTIN_CHAT_TAGS.find((t) => t.key === ORDER_REVIEW_TAG)?.color, 'orange')
    assert.ok(isBuiltinChatTag(PAYMENT_REVIEW_TAG) && isBuiltinChatTag(ORDER_REVIEW_TAG) && !isBuiltinChatTag('VIP'))
    assert.equal(tenant.length, 1)
  })

  it('PATCH validation accepts them (add and remove), still rejects unknown tags', () => {
    const allowed = allowedChatTagKeys(tenant)
    assert.ok(allowed.has(PAYMENT_REVIEW_TAG))
    assert.ok(allowed.has(ORDER_REVIEW_TAG))
    assert.ok(allowed.has('VIP'))
    assert.ok(!allowed.has('Hackeado'))
    assert.ok(allowedChatTagKeys(DEFAULT_CHAT_TAGS).has(PAYMENT_REVIEW_TAG))
    const route = read('src/app/api/chat/conversations/[id]/route.ts')
    assert.match(route, /const allowed = allowedChatTagKeys\(\(await loadTags\(auth\.tenantId\)\)\.tags\)/)
    assert.match(route, /const unknown = body\.tags\.filter\(\(t\) => !allowed\.has\(t\) && !had\.has\(t\)\)/)
    // Inbox catalog shows them with their colour.
    assert.match(read('src/components/chats/useCrmCatalog.ts'), /withBuiltinTags\(tags\)/)
  })
})

describe('notify · bell polling and new-alert detection', () => {
  const item = (id: string, kind: string, minsAgo: number, readFlag = false): AlertItem => ({
    id,
    kind,
    read: readFlag,
    createdAt: new Date(NOW - minsAgo * 60_000).toISOString(),
    title: id,
    snippet: null,
    href: `/chats?c=${id}`,
  })

  it('15 s while visible; hidden only when browser notifications are allowed (60 s), else paused', () => {
    assert.equal(POLL_VISIBLE_MS, 15_000)
    assert.equal(notificationPollMs({ visible: true, browserNotifyGranted: false }), 15_000)
    assert.equal(notificationPollMs({ visible: false, browserNotifyGranted: true }), POLL_HIDDEN_MS)
    assert.equal(POLL_HIDDEN_MS, 60_000)
    assert.equal(notificationPollMs({ visible: false, browserNotifyGranted: false }), null)
  })

  it('first load: only fresh unread review alerts; later polls: each new one exactly once', () => {
    const first = detectNewReviewAlerts(null, [item('old', 'payment_review', 30), item('fresh', 'order_review', 1), item('m', 'mention', 0)], NOW)
    assert.deepEqual(first.alerts.map((a) => a.id), ['fresh'])
    assert.ok(first.seen.has('old') && first.seen.has('fresh') && !first.seen.has('m'))
    assert.ok(FIRST_LOAD_FRESH_MS <= 5 * 60_000)

    const second = detectNewReviewAlerts(
      first.seen,
      [item('new1', 'payment_review', 5), item('fresh', 'order_review', 1), item('readOne', 'payment_review', 0, true), item('nr', 'ai_no_reply', 0)],
      NOW,
    )
    assert.deepEqual(second.alerts.map((a) => a.id), ['new1'])
    const third = detectNewReviewAlerts(second.seen, [item('new1', 'payment_review', 5)], NOW)
    assert.equal(third.alerts.length, 0)
  })

  it('unread count and tab title prefix (never stacked)', () => {
    assert.equal(unreadReviewCount([item('a', 'payment_review', 0), item('b', 'order_review', 0, true), item('c', 'mention', 0)]), 1)
    assert.equal(titleWithCount('Chats · Betsy', 2), '(2) Chats · Betsy')
    assert.equal(titleWithCount('(2) Chats · Betsy', 3), '(3) Chats · Betsy')
    assert.equal(titleWithCount('(3) Chats · Betsy', 0), 'Chats · Betsy')
    assert.equal(titleWithCount('Betsy', 120), '(99+) Betsy')
    assert.equal(titleWithCount('(99+) Betsy', 0), 'Betsy')
  })

  it('bell wiring: shared poller, chime respects the sound toggle, toast with "Abrir chat", opt-in browser notifications', () => {
    const hook = read('src/components/aurora/shell/useWorkspaceNotifications.ts')
    assert.match(hook, /notificationPollMs\(/)
    assert.match(hook, /export function claimNewAlerts\(\)/)
    assert.doesNotMatch(hook, /setInterval/)
    const bell = read('src/components/aurora/shell/AuroraBell.tsx')
    assert.match(bell, /playNotificationChime\(\)/) // no `force`: the SoundToggle setting applies
    assert.match(bell, /altText="Abrir chat"/)
    assert.match(bell, /Activar avisos del navegador/)
    assert.match(bell, /Notification\.requestPermission\(\)/)
    assert.match(bell, /window\.Notification\.permission === 'granted'/)
    assert.match(bell, /data-testid="aurora-bell-review-count"/)
    assert.match(bell, /titleWithCount\(document\.title, reviewUnread\)/)
    // Never prompts on its own: requestPermission only inside the button's onClick.
    assert.equal(bell.match(/requestPermission/g)?.length, 1)
    assert.doesNotMatch(bell, /serviceWorker/)
  })
})

describe('notify · inbox chips and thread banner', () => {
  const conv = (id: string, tags: string[], extra: Partial<SoftConversation> = {}): SoftConversation =>
    ({
      id,
      socialAccountId: 'acc_1',
      platform: 'whatsapp',
      accountLabel: 'Línea',
      recipientId: id,
      recipientName: id,
      lastMessage: '',
      status: 'en_curso',
      tags,
      messages: [],
      ...extra,
    }) as unknown as SoftConversation

  it('counts open chats per review tag', () => {
    const list = [
      conv('a', [PAYMENT_REVIEW_TAG]),
      conv('b', [PAYMENT_REVIEW_TAG, ORDER_REVIEW_TAG]),
      conv('c', [ORDER_REVIEW_TAG], { status: 'hecho' }),
      conv('d', ['VIP']),
    ]
    assert.deepEqual(reviewTagCounts(list), { [PAYMENT_REVIEW_TAG]: 2, [ORDER_REVIEW_TAG]: 1 })
    assert.deepEqual(REVIEW_CHIP_DEFS.map((f) => f.tag), [PAYMENT_REVIEW_TAG, ORDER_REVIEW_TAG])
  })

  it('a review chip shows every open tagged chat, whatever the bucket (owner, snooze); channel/search still apply', () => {
    const later = new Date(NOW + 3_600_000).toISOString()
    const list = [
      conv('mine', [PAYMENT_REVIEW_TAG], { assignee: { id: 'u_me', name: null, image: null } }),
      conv('other', [PAYMENT_REVIEW_TAG], { assignee: { id: 'u_other', name: null, image: null } }),
      conv('snoozed', [PAYMENT_REVIEW_TAG], { snoozedUntil: later }),
      conv('closed', [PAYMENT_REVIEW_TAG], { status: 'hecho' }),
      conv('ig', [PAYMENT_REVIEW_TAG], { platform: 'instagram' }),
      conv('plain', []),
    ]
    const base = { bucket: 'tus_chats' as const, channel: 'whatsapp' as const, accountId: 'all' as const, search: '', viewerUserId: 'u_me', nowMs: NOW }
    assert.deepEqual(filterSoftConversations(list, { ...base, tag: PAYMENT_REVIEW_TAG }).map((c) => c.recipientId), ['mine', 'other', 'snoozed'])
    assert.deepEqual(filterSoftConversations(list, { ...base, tag: PAYMENT_REVIEW_TAG, search: 'oth' }).map((c) => c.recipientId), ['other'])
    // No chip / a normal tag: bucket rules unchanged.
    assert.deepEqual(filterSoftConversations(list, base).map((c) => c.recipientId), ['mine'])
    assert.deepEqual(filterSoftConversations(list, { ...base, tag: 'VIP' }).map((c) => c.recipientId), ['mine'])
  })

  it('inbox pins tagged chats, shows the chips, and the banner only clears on an explicit press', () => {
    const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
    assert.match(inbox, /new URLSearchParams\(\{ tag, limit: '50' \}\)/)
    assert.match(inbox, /reviewFilters=\{REVIEW_CHIP_DEFS\.map/)
    assert.match(inbox, /async function resolveReviewTag\(tag: SoftTag\)/)
    assert.match(inbox, /removeTag: tag,/)
    // The banner never sends a whole tags array.
    const resolve = inbox.slice(inbox.indexOf('async function resolveReviewTag'), inbox.indexOf('async function setAgentControl'))
    assert.doesNotMatch(resolve, /tags: /)
    const list = read('src/components/chats/SoftConversationList.tsx')
    assert.match(list, /data-testid="chat-review-filters"/)
    const pane = read('src/components/chats/SoftThreadPane.tsx')
    assert.match(pane, /'💳 Pago por verificar'/)
    assert.match(pane, /'el cliente mandó el comprobante'/)
    assert.match(pane, /resolveLabel: 'Pago verificado'/)
    assert.match(pane, /resolveLabel: 'Confirmado'/)
    assert.match(pane, /onClick=\{onCreateOrder\}/)
    // Linking an order never clears the review tags.
    assert.doesNotMatch(read('src/lib/chat-order-attach.ts'), /Pago por verificar|Pedido por confirmar|PAYMENT_REVIEW_TAG|ORDER_REVIEW_TAG/)
  })
})

describe('notify · F8 payment snippet: receipt vs claim', () => {
  it('only a photo / file customer message is a receipt', () => {
    assert.equal(paymentReviewVariant('image'), 'receipt')
    assert.equal(paymentReviewVariant('document'), 'receipt')
    for (const t of ['text', 'audio', 'sticker', '', null, undefined]) assert.equal(paymentReviewVariant(t), 'claim')
  })

  it('a claim travels as a ":claim" key suffix (payment only); receipts and orders keep the plain key', () => {
    const base = 'ai_handoff:conv_12345678:msg_aaaa1111:payment'
    assert.equal(reviewDedupeKey(base, 'payment_review', 'image'), base)
    assert.equal(reviewDedupeKey(base, 'payment_review', 'text'), `${base}:claim`)
    assert.equal(reviewDedupeKey('ai_handoff:c:m:order_ready', 'order_review', 'text'), 'ai_handoff:c:m:order_ready')
    assert.equal(paymentVariantFromDedupeKey(`${base}:claim`), 'claim')
    assert.equal(paymentVariantFromDedupeKey(base), 'receipt')
    const src = read('src/lib/soft-ai/handoff-notify.ts')
    assert.match(src, /select: \{ id: true, messageType: true \}/)
    assert.match(src, /dedupeKey: \(\) => reviewDedupeKey\(key, reviewKind, lastInbound\?\.messageType\)/)
    assert.match(read('src/lib/workspace-notifications.ts'), /reviewNotificationText\(r\.kind, who, paymentVariantFromDedupeKey\(r\.dedupeKey\)\)/)
  })

  it('snippets: receipt vs "ya pagó" claim; the title stays the same', () => {
    const receipt = reviewNotificationText('payment_review', 'Ana', 'receipt')
    const claim = reviewNotificationText('payment_review', 'Ana', 'claim')
    assert.equal(receipt.snippet, 'Mandó el comprobante — revisalo y confirmá el pedido')
    assert.equal(claim.snippet, 'Dice que ya pagó o tiene una duda de pago — revisalo')
    assert.equal(receipt.title, claim.title)
    assert.equal(claim.title, '💳 Verificá un pago · Ana')
  })
})

describe('notify · F10 atomic single-tag removal', () => {
  it('PATCH accepts { removeTag } alone, refuses it combined with tags', () => {
    assert.ok(patchConversationBodySchema.safeParse({ removeTag: PAYMENT_REVIEW_TAG }).success)
    assert.ok(patchConversationBodySchema.safeParse({ removeTag: ORDER_REVIEW_TAG, status: 'en_curso' }).success)
    assert.ok(!patchConversationBodySchema.safeParse({ removeTag: PAYMENT_REVIEW_TAG, tags: [] }).success)
    assert.ok(!patchConversationBodySchema.safeParse({ removeTag: '' }).success)
    assert.ok(!patchConversationBodySchema.safeParse({ removeTag: 'x'.repeat(41) }).success)
  })

  it('the route removes one tag with array_remove, scoped by tenant, same update_sales permission', () => {
    const route = read('src/app/api/chat/conversations/[id]/route.ts')
    assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(route, /SET "tags" = array_remove\("tags", \$\{body\.removeTag\}\)/)
    assert.match(route, /WHERE "id" = \$\{existing\.id\} AND "tenantId" = \$\{auth\.tenantId\}/)
    // Parameterised tagged template only (no string-built SQL).
    assert.doesNotMatch(route, /\$executeRawUnsafe|\$queryRawUnsafe/)
  })
})
