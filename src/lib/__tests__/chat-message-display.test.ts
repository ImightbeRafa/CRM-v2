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
