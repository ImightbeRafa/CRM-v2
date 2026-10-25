import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chatPreviewText, describeChatMessage, projectRawMessageForClient } from '@/lib/chat-message-display'

test('WhatsApp unsupported (131051) becomes a plain "Mensaje no compatible" notice', () => {
  const notice = describeChatMessage({
    content: '[unsupported]',
    messageType: 'unsupported',
    metadata: {
      platform: 'whatsapp',
      rawMessage: {
        type: 'unsupported',
        errors: [{ code: 131051, title: 'Message type unknown' }],
      },
    },
  })
  assert.ok(notice)
  assert.equal(notice.title, 'Mensaje no compatible')
  assert.equal(notice.tone, 'muted')
  assert.match(notice.detail ?? '', /teléfono/)
  assert.doesNotMatch(JSON.stringify(notice), /\[unsupported\]/)
})

test('unsupported with a known unsupported.type names what it was', () => {
  const notice = describeChatMessage({
    content: '[unsupported]',
    messageType: 'unsupported',
    metadata: { rawMessage: { type: 'unsupported', unsupported: { type: 'poll_creation' } } },
  })
  assert.match(notice?.detail ?? '', /encuesta/)
})

test('rows stored before rawMessage existed still get the notice', () => {
  const notice = describeChatMessage({ content: '[unsupported]', messageType: 'unsupported', metadata: null })
  assert.equal(notice?.title, 'Mensaje no compatible')
})

test('reaction, contacts and location read the raw WhatsApp payload', () => {
  assert.equal(
    describeChatMessage({ content: '', messageType: 'reaction', metadata: { rawMessage: { type: 'reaction', reaction: { emoji: '👍' } } } })?.title,
    'Reaccionó 👍',
  )
  const contact = describeChatMessage({
    content: '[contact]',
    messageType: 'contacts',
    metadata: { rawMessage: { contacts: [{ name: { formatted_name: 'Ana Mora' }, phones: [{ phone: '+506 8888 8888' }] }] } },
  })
  assert.equal(contact?.title, 'Compartió un contacto')
  assert.match(contact?.detail ?? '', /Ana Mora · \+506 8888 8888/)
  const loc = describeChatMessage({
    content: '[location]',
    messageType: 'location',
    metadata: { rawMessage: { location: { latitude: 9.93, longitude: -84.08 } } },
  })
  assert.equal(loc?.href, 'https://www.google.com/maps?q=9.93,-84.08')
})

test('Instagram notices link to our media route, never to the CDN URL', () => {
  const story = describeChatMessage({
    id: 'm1',
    content: '[story_mention]',
    metadata: { platform: 'instagram', rawMessage: { attachments: [{ type: 'story_mention', payload: { url: 'https://lookaside.fbsbx.com/x' } }] } },
  })
  assert.equal(story?.title, 'Te mencionó en su historia')
  assert.equal(story?.href, '/api/chat/media/m1')
  // Client DTO shape (projected): hasUrl instead of the URL.
  const projected = describeChatMessage({
    id: 'm2',
    content: '[story_mention]',
    metadata: { platform: 'instagram', rawMessage: { attachments: [{ type: 'story_mention', hasUrl: true }] } },
  })
  assert.equal(projected?.href, '/api/chat/media/m2')
  const share = describeChatMessage({
    id: 'm3',
    content: '[share]',
    metadata: { platform: 'instagram', rawMessage: { attachments: [{ type: 'share', payload: { url: 'javascript:alert(1)' } }] } },
  })
  assert.equal(share?.title, 'Compartió una publicación')
  assert.equal(share?.href, undefined)
})

test('normal text, captions, media and customer-typed brackets are left alone', () => {
  assert.equal(describeChatMessage({ content: 'hola', messageType: 'text' }), null)
  assert.equal(describeChatMessage({ content: '[ok]', messageType: 'text' }), null)
  assert.equal(describeChatMessage({ content: '[image]', messageType: 'image' }), null)
  assert.equal(describeChatMessage({ content: '', messageType: 'template' }), null)
})

test('conversation preview never shows raw [type] tokens', () => {
  assert.equal(chatPreviewText('[unsupported]'), 'Mensaje no compatible')
  assert.equal(chatPreviewText('[audio]'), 'Audio')
  assert.equal(chatPreviewText('[ok]'), '[ok]')
  assert.equal(chatPreviewText('Deseo crear una orden'), 'Deseo crear una orden')
})

test('SoftThreadPane and SoftConversationList use the display helpers', () => {
  assert.match(readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8'), /describeChatMessage\(msg\)/)
  const list = readFileSync('src/components/chats/SoftConversationList.tsx', 'utf8')
  assert.doesNotMatch(list, /\{conv\.lastMessage \|\| '—'\}/)
  assert.match(list, /chatPreviewText\(conv\.lastMessage\)/)
})

test('projectRawMessageForClient drops every URL but keeps what the notices need', () => {
  const projected = projectRawMessageForClient({
    type: 'unsupported',
    unsupported: { type: 'poll_creation' },
    reaction: { emoji: '👍', message_id: 'wamid.X' },
    attachments: [{ type: 'image', payload: { url: 'https://scontent.cdninstagram.com/a.jpg', title: 'Promo' } }],
    image: { id: 'MEDIA1', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1' },
  })
  const json = JSON.stringify(projected)
  assert.doesNotMatch(json, /https?:\/\//)
  assert.doesNotMatch(json, /cdninstagram|fbsbx|MEDIA1/)
  assert.deepEqual((projected as any).attachments[0], { type: 'image', payload: { title: 'Promo' }, hasUrl: true })
  assert.equal((projected as any).unsupported.type, 'poll_creation')
  assert.equal((projected as any).reaction.emoji, '👍')
})

test('mapMessageToDto sends the projected rawMessage', () => {
  const src = readFileSync('src/lib/chat-conversation-api.ts', 'utf8')
  assert.match(src, /rawMessage: projectRawMessageForClient\(metadata\.rawMessage\)/)
})

test('verifier #5: Instagram unsupported without platform key says Instagram, not WhatsApp', () => {
  const notice = describeChatMessage({
    content: '',
    messageType: 'unsupported',
    metadata: { instagramAccountId: '17841400000000000', rawMessage: { is_unsupported: true } },
  })
  assert.match(notice?.detail ?? '', /Instagram/)
})

test('verifier #2: [share]/[story_mention]/[ig_reel] tokens are never shown next to cached media', async () => {
  const { isPlaceholderToken } = await import('@/lib/chat-message-display')
  for (const t of ['[share]', '[story_mention]', '[ig_reel]', '[image]', '[file]']) assert.equal(isPlaceholderToken(t), true, t)
  assert.equal(isPlaceholderToken('[ok]'), false)
  assert.equal(isPlaceholderToken('hola [image]'), false)
  assert.match(readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8'), /showMedia && isPlaceholderToken\(msg\.content\)/)
})

test('verifier #3: server search hits survive the reconcile replace', () => {
  const src = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
  // Search hits (and, since Phase 2b, deep-linked / snoozed rows) survive the replace.
  // …and the LIVE row wins over the snapshot taken when it was fetched (no stale revert).
  assert.match(src, /\[\.\.\.searchHitsRef\.current, \.\.\.pinnedDtosRef\.current\]\.map\(\(c\) => prev\.get\(c\.id\) \?\? c\)\.filter\(\(c\) => !fresh\.has\(c\.id\)\)/)
})

// Payload shapes below are copied from real rows (2026-10-25 inventory), URLs shortened.
const IG = { instagramAccountId: '17841400000000000' }
const thru = (raw: unknown) => projectRawMessageForClient(raw)

test('IG ig_post: "Compartió una publicación" with the caption and our media link (client DTO too)', () => {
  const raw = {
    mid: 'm1',
    attachments: [{ type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1', title: 'Parches con melatonina', ig_post_media_id: '18' } }],
  }
  for (const rawMessage of [raw, thru(raw)]) {
    const notice = describeChatMessage({ id: 'msg1', content: '[ig_post]', messageType: 'ig_post', metadata: { ...IG, rawMessage } })
    assert.equal(notice?.title, 'Compartió una publicación')
    assert.equal(notice?.detail, 'Parches con melatonina')
    assert.equal(notice?.href, '/api/chat/media/msg1')
  }
  const long = describeChatMessage({ id: 'x', content: '[ig_post]', messageType: 'ig_post', metadata: { ...IG, rawMessage: { attachments: [{ type: 'ig_post', payload: { title: 'a'.repeat(900) } }] } } })
  assert.ok((long?.detail ?? '').length <= 280)
  assert.equal(chatPreviewText('[ig_post]'), 'Publicación compartida')
})

test('IG ig_story: link comes from story_media_url (display, projection and media route)', async () => {
  const raw = { attachments: [{ type: 'ig_story', payload: { story_media_id: '18', story_media_url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2' } }] }
  const projected = thru(raw)
  assert.doesNotMatch(JSON.stringify(projected), /https?:/)
  const notice = describeChatMessage({ id: 's1', content: '[ig_story]', messageType: 'ig_story', metadata: { ...IG, rawMessage: projected } })
  assert.equal(notice?.title, 'Compartió una historia')
  assert.equal(notice?.href, '/api/chat/media/s1')
  const { instagramAttachmentUrl } = await import('@/lib/chat-media')
  assert.equal(instagramAttachmentUrl({ rawMessage: raw }), 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2')
  assert.equal(instagramAttachmentUrl({ rawMessage: { attachments: [{ payload: { story_media_url: 'https://evil.example.com/x' } }] } }), null)
})

test('IG ephemeral ("ver una vez") explains itself instead of "Tipo: ephemeral"', () => {
  const notice = describeChatMessage({ id: 'e1', content: '[ephemeral]', messageType: 'ephemeral', metadata: { ...IG, rawMessage: { attachments: [{ type: 'ephemeral' }] } } })
  assert.equal(notice?.title, 'Foto o video temporal')
  assert.match(notice?.detail ?? '', /ver una vez/)
  assert.doesNotMatch(JSON.stringify(notice), /Tipo:|ephemeral/)
})

test('IG template with empty elements says Instagram sent no preview; with elements shows the card text', () => {
  const empty = describeChatMessage({ id: 't1', content: '[template]', messageType: 'template', metadata: { ...IG, rawMessage: thru({ attachments: [{ type: 'template', payload: { generic: { elements: [] } } }] }) } })
  assert.equal(empty?.title, 'Compartió un enlace')
  assert.match(empty?.detail ?? '', /no envió la vista previa/)
  const card = thru({ attachments: [{ type: 'template', payload: { generic: { elements: [{ title: 'Kit Prototipo', subtitle: '₡14 900', image_url: 'https://x.example/a.jpg' }] } } }] })
  assert.doesNotMatch(JSON.stringify(card), /https?:/)
  const full = describeChatMessage({ id: 't2', content: '[template]', messageType: 'template', metadata: { ...IG, rawMessage: card } })
  assert.equal(full?.detail, 'Kit Prototipo\n₡14 900')
})

test('IG unsupported_type with a URL offers to open it', () => {
  const notice = describeChatMessage({ id: 'u1', content: '[unsupported_type]', messageType: 'unsupported_type', metadata: { ...IG, rawMessage: thru({ attachments: [{ type: 'unsupported_type', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=3' } }] }) } })
  assert.equal(notice?.href, '/api/chat/media/u1')
})

test('WA edit shows the new text; revoke says it was deleted', () => {
  const raw = { type: 'edit', edit: { message: { type: 'text', text: { body: 'Uruca, 200 m norte' } }, original_message_id: 'wamid.A' } }
  for (const rawMessage of [raw, thru(raw)]) {
    const notice = describeChatMessage({ content: '[edit]', messageType: 'edit', metadata: { platform: 'whatsapp', rawMessage } })
    assert.equal(notice?.title, 'Editó un mensaje')
    assert.equal(notice?.detail, 'Ahora dice:\nUruca, 200 m norte')
  }
  const revoke = describeChatMessage({ content: '[revoke]', messageType: 'revoke', metadata: { platform: 'whatsapp', rawMessage: { type: 'revoke', revoke: { original_message_id: 'wamid.B' } } } })
  assert.equal(revoke?.title, 'Eliminó un mensaje')
  assert.equal(chatPreviewText('[edit]'), 'Mensaje editado')
  assert.equal(chatPreviewText('[revoke]'), 'Mensaje eliminado')
})

test('WA 131060 "unavailable" and changed-number system notices are in Spanish', () => {
  const gone = describeChatMessage({ content: '[unsupported]', messageType: 'unsupported', metadata: { platform: 'whatsapp', rawMessage: thru({ type: 'unsupported', errors: [{ code: 131060, title: 'This message is unavailable.' }], unsupported: { type: 'unknown' } }) } })
  assert.equal(gone?.title, 'Mensaje no disponible')
  const album = describeChatMessage({ content: '[unsupported]', messageType: 'unsupported', metadata: { platform: 'whatsapp', rawMessage: { type: 'unsupported', errors: [{ code: 131051 }], unsupported: { type: 'album' } } } })
  assert.match(album?.detail ?? '', /álbum/)
  const moved = describeChatMessage({ content: '[system]', messageType: 'system', metadata: { platform: 'whatsapp', rawMessage: thru({ type: 'system', system: { body: 'User A changed from 50663008726 to 50671545992', type: 'user_changed_number', wa_id: '50671545992' } }) } })
  assert.equal(moved?.title, 'El cliente cambió de número')
  assert.equal(moved?.detail, 'Su número nuevo es +506 7154 5992.')
})

test('an unknown future token never shows the internal Meta type name', () => {
  const notice = describeChatMessage({ content: '[hologram]', messageType: 'hologram', metadata: { ...IG, rawMessage: { attachments: [{ type: 'hologram' }] } } })
  assert.ok(notice)
  assert.doesNotMatch(JSON.stringify(notice), /hologram|Tipo:/)
  assert.match(notice!.detail ?? '', /Instagram/)
})

test('verifier F1: media tokens never get a notice (an IG PDF "[file]" stays a plain document bubble)', () => {
  for (const t of ['image', 'audio', 'voice', 'document', 'video', 'sticker', 'file']) {
    assert.equal(describeChatMessage({ id: 'm', content: `[${t}]`, messageType: t, metadata: IG }), null, t)
  }
  const raw = { attachments: [{ type: 'file', payload: { url: 'https://lookaside.fbsbx.com/x' } }] }
  for (const rawMessage of [raw, thru(raw)]) {
    assert.equal(describeChatMessage({ id: 'p', content: '[file]', messageType: 'document', metadata: { ...IG, rawMessage } }), null)
  }
})

test('verifier F2: an earlier [edit]/[revoke] bubble is not customer text in a burst', async () => {
  const { planBurstInbound } = await import('@/lib/soft-ai/inbound-burst')
  const t0 = new Date('2026-10-25T15:00:00Z').getTime()
  for (const token of ['[edit]', '[revoke]']) {
    const plan = planBurstInbound({
      earlier: [{ direction: 'inbound', content: token, messageType: token.slice(1, -1), sentAt: new Date(t0) }],
      trigger: { content: '[image]', messageType: 'image', sentAt: new Date(t0 + 5_000) },
      awaitingReceipt: () => false,
    })
    assert.equal(plan.reason, 'single', token)
  }
})

test('agent burst treats the new tokens as non-text; cached shared posts keep their label', () => {
  const src = readFileSync('src/lib/soft-ai/inbound-burst.ts', 'utf8')
  for (const t of ['ephemeral', 'edit', 'revoke', 'unsupported_type', 'ig_post', 'ig_story']) assert.match(src, new RegExp(`\\|${t}\\|`), t)
  assert.match(readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8'), /showMedia && !isPlaceholder \? null : describeChatMessage\(msg\)/)
})
