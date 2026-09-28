/**
 * Chat feedback batch (Rafael 2026-09-28): default Humano, media serving, composer
 * (quick replies, emojis), client link, order → guía flow, per-chat drafts, route loading.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { describe } from 'node:test'
import { conversationAgentMode, defaultAgentMode, isSoftHumanComposerEnabled } from '../soft-ai/agent-state'
import {
  applyQuickReply,
  fillQuickReply,
  filterQuickReplies,
  normalizeShortcut,
  quickRepliesFromSettings,
  sanitizeQuickReplies,
  slashQueryAt,
} from '../chat-quick-replies'
import { guiaCaption, guiaPdfFilename, nextOrderStep } from '../chat-order-flow'
import { orderDraftStorageKey } from '../order-draft'
import { isAuroraFrameRoute, isFullBleedAuroraRoute } from '../../components/aurora/aurora-frame-routes'
import { pushRecentEmoji, searchEmojis } from '../../components/chats/composer/emoji-data'

const read = (p: string) => readFileSync(p, 'utf8')

describe('default mode is Humano', () => {
  test('server NULL / unknown / legacy mean Humano; only explicit modes pass through', () => {
    assert.equal(conversationAgentMode(null), 'human')
    assert.equal(conversationAgentMode(undefined), 'human')
    assert.equal(conversationAgentMode('human_takeover'), 'human')
    assert.equal(conversationAgentMode('garbage'), 'human')
    assert.equal(conversationAgentMode('ai_active'), 'ai_active')
    assert.equal(conversationAgentMode('paused'), 'paused')
  })
  test('real chats start with the composer unlocked; DEMO keeps AI on', () => {
    assert.equal(defaultAgentMode(false), 'human')
    assert.equal(isSoftHumanComposerEnabled(defaultAgentMode(false)), true)
    assert.equal(defaultAgentMode(true), 'ai_active')
  })
  test('inbox uses the server mode when the conversation exists', () => {
    assert.match(read('src/components/chats/SoftCopilotInboxV2.tsx'), /selectedDto \? conversationAgentMode\(selectedDto\.aiMode\)/)
  })
})

describe('media serving', () => {
  test('Graph mime wins over a generic CDN content type', async () => {
    const { pickMediaContentType } = await import('../chat-media')
    assert.equal(pickMediaContentType('image/jpeg', 'application/octet-stream'), 'image/jpeg')
    assert.equal(pickMediaContentType(null, 'binary/octet-stream', 'audio/ogg; codecs=opus'), 'audio/ogg; codecs=opus')
    assert.equal(pickMediaContentType(undefined, ''), 'application/octet-stream')
  })
  test('a failed cache write still serves the downloaded bytes', async () => {
    const { cacheProviderMediaToBlob } = await import('../chat-media')
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const fetchImpl = (async (url: string) => {
      if (url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg' }), { status: 200 })
      }
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    }) as unknown as typeof fetch
    const res = await cacheProviderMediaToBlob({
      tenantId: 't',
      messageId: 'm',
      providerMediaId: '123',
      accessToken: 'tok',
      purpose: 'whatsapp',
      fetchImpl,
      putFn: async () => {
        throw new Error('BLOB_READ_WRITE_TOKEN is required for chat media cache')
      },
    })
    assert.equal(res.ok, true)
    if (!res.ok) return
    assert.equal(res.ref.mediaCacheStatus, 'pending')
    assert.equal(res.ref.mediaMimeType, 'image/jpeg')
    assert.equal(res.bytes.length, bytes.length)
    assert.match(res.cacheError || '', /BLOB_READ_WRITE_TOKEN/)
  })
  test('route only persists a blob path when the cache really worked', () => {
    const route = read('src/app/api/chat/media/[messageId]/route.ts')
    assert.match(route, /if \(cached\.ref\.mediaCacheStatus !== 'ready'\)/)
  })
  test('failure reasons are Spanish and specific', async () => {
    const { mediaFailureReason } = await import('../../components/chats/ChatMediaBubble')
    assert.match(mediaFailureReason(413, ''), /25 MB/)
    assert.match(mediaFailureReason(502, '(#100) Param media_id does not exist'), /ya no guarda/)
    assert.match(mediaFailureReason(400, 'Missing channel token'), /reconectarse/)
  })
})

describe('outbound media is on by default (kill switch)', () => {
  test('capabilities + send routes use the default-on check', () => {
    assert.match(read('src/app/api/chat/capabilities/route.ts'), /isTenantFeatureNotDisabled\(auth\.tenantId, CHAT_OUTBOUND_MEDIA_FLAG\)/)
    assert.match(read('src/app/api/chat/send-guia/route.ts'), /isTenantFeatureNotDisabled\(tenantId, CHAT_OUTBOUND_MEDIA_FLAG\)/)
    assert.match(read('src/lib/feature-flags.ts'), /return flag \? flag\.enabled === true : true/)
  })
  test('re-sending a recent file is tenant-scoped', () => {
    const core = read('src/lib/chat-send-media-core.ts')
    assert.match(core, /where: \{ id: messageId, tenantId, direction: 'outbound'/)
    assert.match(read('src/app/api/chat/recent-media/route.ts'), /tenantId: auth\.tenantId/)
  })
})

describe('quick replies', () => {
  test('shortcuts are normalized (accents, spaces, leading slash)', () => {
    assert.equal(normalizeShortcut('/Envío GAM'), 'envio-gam')
    assert.equal(normalizeShortcut('  Precio!! '), 'precio')
  })
  test('sanitize drops empties, rejects duplicates and oversize', () => {
    assert.deepEqual(sanitizeQuickReplies([{ shortcut: '', text: 'x' }, { shortcut: 'a', text: ' ' }]).items, [])
    assert.match(sanitizeQuickReplies([{ shortcut: 'a', text: '1' }, { shortcut: 'A', text: '2' }]).error || '', /repetido/)
    assert.match(sanitizeQuickReplies([{ shortcut: 'a', text: 'x'.repeat(1001) }]).error || '', /supera/)
    assert.equal(quickRepliesFromSettings({ chatQuickReplies: [{ id: 'q1', shortcut: 'sinpe', text: 'SINPE 8888' }] })[0].shortcut, 'sinpe')
    assert.deepEqual(quickRepliesFromSettings(null), [])
  })
  test('slash opens only at the start of a line (never in URLs or 1/2)', () => {
    assert.deepEqual(slashQueryAt('/pre', 4), { query: 'pre', start: 0 })
    assert.deepEqual(slashQueryAt('hola\n/sin', 9), { query: 'sin', start: 5 })
    assert.equal(slashQueryAt('https://x.com/a', 15), null)
    assert.equal(slashQueryAt('son 1/2', 7), null)
    assert.equal(slashQueryAt('/pre cio', 8), null)
  })
  test('filter ranks prefix matches first; apply fills {nombre}', () => {
    const items = [
      { id: '1', shortcut: 'envio', text: 'Envío GAM' },
      { id: '2', shortcut: 'precio', text: 'El precio es' },
      { id: '3', shortcut: 'pago-sinpe', text: 'Precio y SINPE' },
    ]
    assert.deepEqual(filterQuickReplies(items, 'pre').map((i) => i.id), ['2', '3'])
    const out = applyQuickReply('Hola\n/pre', { query: 'pre', start: 5 }, { id: 'x', shortcut: 'precio', text: 'Hola {nombre}, cuesta ₡10' }, 'María José')
    assert.equal(out.text, 'Hola\nHola María, cuesta ₡10')
    assert.equal(out.caret, out.text.length)
    assert.equal(fillQuickReply('Hola {nombre}, gracias', ''), 'Hola, gracias')
  })
  test('PUT only touches settings.chatQuickReplies', () => {
    const route = read('src/app/api/chat/quick-replies/route.ts')
    assert.match(route, /'\{chatQuickReplies\}', \$\{payload\}::jsonb, true/)
    assert.match(route, /WHERE "id" = \$\{auth\.tenantId\}/)
  })
})

describe('emojis', () => {
  test('Spanish search finds commerce emojis; recents dedupe and cap', () => {
    assert.ok(searchEmojis('envio').some((e) => e[0] === '📦'))
    assert.ok(searchEmojis('gracias').some((e) => e[0] === '🙏'))
    assert.deepEqual(pushRecentEmoji(['a', 'b'], 'b'), ['b', 'a'])
    assert.equal(pushRecentEmoji(Array.from({ length: 30 }, (_, i) => String(i)), 'x').length, 24)
  })
})

describe('client link + order flow', () => {
  test('link route checks both the chat and the client belong to the tenant', () => {
    const route = read('src/app/api/chat/conversations/[id]/client/route.ts')
    assert.match(route, /chatConversation\.findFirst\(\{\s*where: \{ id, tenantId \}/)
    assert.match(route, /where: \{ id: clientId, tenantId \}/)
    assert.match(route, /logAuditEvent/)
  })
  test('a guía only goes to the chat its order belongs to', () => {
    const route = read('src/app/api/chat/send-guia/route.ts')
    assert.match(route, /if \(!linkedFromChat && !samePhone && !sameClient\)/)
    assert.match(route, /Este pedido no es de este chat/)
  })
  test('next step: RA never needs a guía; EA goes guía → enviar → listo', () => {
    assert.equal(nextOrderStep({ orderType: 'RA', guia: null, guiaSentAt: null }), 'retiro')
    assert.equal(nextOrderStep({ orderType: 'EA', guia: null, guiaSentAt: null }), 'guia')
    const guia = { id: 'g', number: 'CR1', createdAt: '' }
    assert.equal(nextOrderStep({ orderType: 'EA', guia, guiaSentAt: null }), 'enviar-guia')
    assert.equal(nextOrderStep({ orderType: 'EA', guia, guiaSentAt: '2026-09-28' }), 'listo')
  })
  test('guía caption + filename', () => {
    assert.equal(guiaPdfFilename('CR 123/45', 'EA-1'), 'guia-CR12345.pdf')
    assert.match(guiaCaption({ customerName: 'Ana Pérez', orderNumber: 'EA-9', guiaNumber: 'CR1' }), /^¡Hola Ana! Tu pedido EA-9 .*CR1\.$/)
  })
})

describe('per-chat order drafts', () => {
  test('each chat has its own slot; /ventas keeps the legacy key', () => {
    assert.equal(orderDraftStorageKey(), 'betsy_autosave')
    assert.equal(orderDraftStorageKey('chat:abc'), 'betsy_autosave:chat:abc')
    assert.match(read('src/components/chats/SoftCopilotInboxV2.tsx'), /draftKey=\{selectedConversationId \? `chat:\$\{selectedConversationId\}` : undefined\}/)
  })
})

describe('persistent Aurora frame (route loading)', () => {
  test('frame routes: app pages yes; auth / logistics / classic full-screen pages no', () => {
    for (const p of ['/dashboard', '/chats', '/ventas', '/ventas/dashboard', '/config', '/config/social', '/help/x'])
      assert.equal(isAuroraFrameRoute(p), true, p)
    for (const p of ['/', '/auth/signin', '/logistics', '/config/ai-assistant', '/config/agentes/conocimiento', '/chatsx', null])
      assert.equal(isAuroraFrameRoute(p), false, String(p))
    assert.equal(isFullBleedAuroraRoute('/chats'), true)
    assert.equal(isFullBleedAuroraRoute('/dashboard'), false)
  })
  test('root layout mounts the frame; every app loading.tsx is an Aurora skeleton', () => {
    assert.match(read('src/app/layout.tsx'), /<AuroraFrame>\{children\}<\/AuroraFrame>/)
    for (const seg of ['dashboard', 'ventas', 'produccion', 'estadisticas', 'chats']) {
      assert.match(read(`src/app/${seg}/loading.tsx`), /AuroraRouteLoading/, seg)
    }
    assert.match(read('src/app/loading.tsx'), /AppRouteLoading/)
    assert.doesNotMatch(read('src/app/loading.tsx'), /border-gray-900/)
  })
})

describe('SecureDog / verifier fixes', () => {
  test('quick replies: managers edit, audited, versioned', () => {
    const route = read('src/app/api/chat/quick-replies/route.ts')
    assert.match(route, /PUT[\s\S]*authenticateAPIWithPermission\(request, 'update_config'\)/)
    assert.match(route, /logAuditEvent/)
    assert.match(route, /code: 'stale'/)
    assert.match(read('src/lib/rbac.ts'), /'PUT \/api\/chat\/quick-replies': 'update_config'/)
    assert.equal(sanitizeQuickReplies([{ shortcut: 'x', text: 'a\u0000b' }]).items[0].text, 'ab')
  })
  test('manual client link with another phone needs confirmation; guía to another phone too', () => {
    assert.match(read('src/app/api/chat/conversations/[id]/client/route.ts'), /code: 'phone_mismatch'/)
    const guia = read('src/app/api/chat/send-guia/route.ts')
    assert.match(guia, /if \(!samePhone && body\?\.confirm !== true\)/)
    assert.match(guia, /logAuditEvent/)
  })
  test('AI ownership: a linked client counts only when its phone is the chat phone', () => {
    const runner = read('src/lib/soft-ai/llm/tool-runner.ts')
    assert.match(runner, /phoneMatches\(client\.normalizedPhone\) \|\| phoneMatches\(client\.phone\)/)
  })
  test('re-send: only our outbound photos / videos / documents, never guías', () => {
    const core = read('src/lib/chat-send-media-core.ts')
    assert.match(core, /direction: 'outbound', messageType: \{ in: \['image', 'video', 'document'\] \}/)
    assert.match(core, /if \(meta\.guiaId\)/)
  })
  test('maskPhone keeps only the last 4 digits', async () => {
    const { maskPhone } = await import('../chat-order-flow')
    assert.equal(maskPhone('+506 8888-1234'), '••••-1234')
    assert.equal(maskPhone(''), null)
  })
})
