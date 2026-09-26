import assert from 'node:assert/strict'
import test from 'node:test'
import { AURORA_NAV, getActiveAuroraHref } from '../../components/aurora/aurora-nav'

const items = AURORA_NAV.flatMap((s) => s.items)

test('sections are Principal / Atajos / Sistema in Figma order', () => {
  assert.deepEqual(
    AURORA_NAV.map((s) => [s.title, s.items.map((i) => i.label)]),
    [
      ['Principal', ['Inicio', 'Chats', 'Pedidos', 'Estadísticas']],
      ['Atajos', ['Agentes', 'Canales']],
      ['Sistema', ['Configuración', 'Ayuda']],
    ],
  )
})

test('no Pronto badge and no Conocimiento in the sidebar', () => {
  for (const i of items) {
    assert.equal('badge' in i, false, i.label)
    assert.doesNotMatch(i.label, /conocimiento|pronto|soft/i)
  }
})

test('shortcuts point at Config tabs and are never active', () => {
  const shortcuts = items.filter((i) => i.shortcut)
  assert.deepEqual(shortcuts.map((i) => i.href), ['/config?tab=agentes', '/config?tab=social'])
  for (const path of ['/config', '/config/social', '/chats']) {
    const active = getActiveAuroraHref(path)
    assert.ok(!shortcuts.some((s) => s.href === active), path)
  }
})

test('anything under /config highlights Configuración', () => {
  for (const p of ['/config', '/config/social', '/config/ai-assistant', '/config/agentes/conocimiento']) {
    assert.equal(getActiveAuroraHref(p), '/config', p)
  }
})

test('top-level routes keep longest-prefix matching', () => {
  assert.equal(getActiveAuroraHref('/ventas/x'), '/ventas')
  assert.equal(getActiveAuroraHref('/dashboard'), '/dashboard')
  assert.equal(getActiveAuroraHref('/estadisticas'), '/estadisticas')
  assert.equal(getActiveAuroraHref(null), null)
})
