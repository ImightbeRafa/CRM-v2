import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chatPreviewText, describeChatMessage } from '@/lib/chat-message-display'

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

test('Instagram story mention and share link only to https', () => {
  const story = describeChatMessage({
    content: '[story_mention]',
    metadata: { platform: 'instagram', rawMessage: { attachments: [{ type: 'story_mention', payload: { url: 'https://lookaside.fbsbx.com/x' } }] } },
  })
  assert.equal(story?.title, 'Te mencionó en su historia')
  assert.equal(story?.href, 'https://lookaside.fbsbx.com/x')
  const share = describeChatMessage({
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
