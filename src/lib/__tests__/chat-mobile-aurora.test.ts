import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (p: string) => readFileSync(p, 'utf8')

describe('PR-G mobile chats (CHAT-M01 / CHAT-M02)', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  const list = read('src/components/chats/SoftConversationList.tsx')
  const thread = read('src/components/chats/SoftThreadPane.tsx')
  const nav = read('src/components/aurora/AuroraMobileNav.tsx')
  const shell = read('src/components/aurora/AuroraShell.tsx')

  it('bottom nav is mobile-only with Chats / Pedidos / Canales / Más', () => {
    assert.match(nav, /md:hidden/)
    for (const label of ['Chats', 'Pedidos', 'Canales', 'Más']) assert.ok(nav.includes(label), label)
    assert.match(nav, /href="\/chats"/)
    assert.match(nav, /href="\/ventas"/)
    assert.match(nav, /CANALES_HREF = '\/config\?tab=social'/)
  })

  it('shell exposes an opt-in bottomNav slot; inbox passes it only on the list view', () => {
    assert.match(shell, /bottomNav/)
    assert.match(inbox, /mobileView === 'list' \?\s*\(\s*<AuroraMobileNav/)
  })

  it('desktop layout from PR-C is preserved (md: split + desktop header hidden on mobile)', () => {
    assert.match(inbox, /className="hidden min-h-0 min-w-0 flex-1 md:flex"/)
    assert.match(inbox, /className="flex min-h-0 min-w-0 flex-1 md:hidden"/)
    assert.match(inbox, /<header className="hidden shrink-0[^"]*md:flex"/)
    assert.match(read('src/components/chats/SoftCopilotRail.tsx'), /hidden h-full w-\[268px\][^']*xl:flex/)
  })

  it('bandeja tabs map onto existing buckets and the line filter stays reachable', () => {
    for (const id of ["'abiertos'", "'tus_chats'", "'sin_asignar'", "'ia_manejando'"]) {
      assert.ok(list.includes(`id: ${id}`), id)
    }
    for (const label of ['Todos', 'Míos', 'Sin asignar', 'IA']) assert.ok(list.includes(`label: '${label}'`), label)
    assert.match(list, /variant=\{compact \? 'card' : 'pill'\}/)
  })

  it('thread keeps send + agent controls reachable on mobile', () => {
    assert.match(thread, /aria-label="Volver a chats"/)
    assert.match(thread, /aria-label="Enviar"/)
    assert.match(thread, /aria-label="Pausar agente"/)
    assert.match(thread, /Tomar\n/)
    assert.match(thread, /onSubmit=\{onSend\}/)
    assert.match(thread, /text-\[16px\]/) // avoids iOS focus zoom
  })

  it('no Soft wording in user-visible mobile strings', () => {
    for (const src of [nav, list, thread]) {
      const strings = src.match(/>[^<>{}\n]*[A-Za-zÁ-ú][^<>{}\n]*</g) ?? []
      for (const s of strings) assert.ok(!/\bSoft\b/.test(s), s)
    }
  })
})
