import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAuroraAlerts, showBellDot, ALERTS_EMPTY_LABEL } from '../aurora-alerts'

const base = {
  channelsNeedingAction: 0,
  metaReady: null,
  unassigned: { count: 0, more: false },
  sinpePending: 0,
  porEnviar: 0,
  isAdmin: true,
}

test('no signals -> no alerts, no dot, "Todo al día" label', () => {
  const alerts = buildAuroraAlerts(base)
  assert.deepEqual(alerts, [])
  assert.equal(showBellDot(alerts), false)
  assert.equal(ALERTS_EMPTY_LABEL, 'Todo al día')
})

test('dot shows only when at least one alert exists', () => {
  assert.equal(showBellDot(buildAuroraAlerts({ ...base, porEnviar: 1 })), true)
})

test('channels alert links to Canales for admins and Chats for others', () => {
  const admin = buildAuroraAlerts({ ...base, channelsNeedingAction: 2 })
  assert.equal(admin[0].title, '2 líneas necesitan atención')
  assert.equal(admin[0].href, '/config?tab=social')
  const member = buildAuroraAlerts({ ...base, channelsNeedingAction: 1, isAdmin: false })
  assert.equal(member[0].title, '1 línea necesita atención')
  assert.equal(member[0].href, '/chats')
})

test('meta readiness alert is admin-only and only when explicitly false', () => {
  assert.equal(buildAuroraAlerts({ ...base, metaReady: null }).length, 0)
  assert.equal(buildAuroraAlerts({ ...base, metaReady: true }).length, 0)
  assert.equal(buildAuroraAlerts({ ...base, metaReady: false, isAdmin: false }).length, 0)
  const alerts = buildAuroraAlerts({ ...base, metaReady: false })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].key, 'meta')
  assert.equal(alerts[0].href, '/config?tab=social')
})

test('unassigned chats: exact count, "50+" when there are more', () => {
  assert.equal(buildAuroraAlerts({ ...base, unassigned: { count: 3, more: false } })[0].title, '3 chats sin asignar')
  assert.equal(buildAuroraAlerts({ ...base, unassigned: { count: 1, more: false } })[0].title, '1 chat sin asignar')
  assert.equal(buildAuroraAlerts({ ...base, unassigned: { count: 50, more: true } })[0].title, '50+ chats sin asignar')
})

test('SINPE and por enviar link to Pedidos, singular/plural', () => {
  const alerts = buildAuroraAlerts({ ...base, sinpePending: 1, porEnviar: 4 })
  assert.deepEqual(
    alerts.map((a) => [a.title, a.href]),
    [
      ['1 pago SINPE por confirmar', '/ventas'],
      ['4 pedidos por enviar', '/ventas'],
    ],
  )
})

test('negative / fractional counts never produce alerts', () => {
  assert.deepEqual(buildAuroraAlerts({ ...base, sinpePending: -2, porEnviar: 0.4 }), [])
})

import { buildPaletteItems, filterPaletteItems } from '../aurora-palette'
import { AURORA_NAV } from '../../components/aurora/aurora-nav'
import { CONFIG_NAV } from '../../components/aurora/config/config-nav'

const paletteInput = {
  nav: AURORA_NAV,
  configNav: CONFIG_NAV,
  isAdmin: true,
  canViewSales: true,
  canCreateSales: true,
  canViewConfig: true,
}

test('palette lists real destinations only (nav + config tabs + crear pedido)', () => {
  const items = buildPaletteItems(paletteInput)
  const hrefs = items.map((i) => i.href)
  assert.ok(hrefs.includes('/ventas?nuevo=1'))
  assert.ok(hrefs.includes('/estadisticas'))
  assert.ok(hrefs.includes('/help'))
  assert.ok(hrefs.includes('/config?tab=users'))
  assert.ok(items.every((i) => i.href.startsWith('/')))
})

test('palette hides admin destinations from non-admins', () => {
  const items = buildPaletteItems({ ...paletteInput, isAdmin: false, canCreateSales: false })
  const hrefs = items.map((i) => i.href)
  assert.ok(!hrefs.includes('/config'))
  assert.ok(!hrefs.some((h) => h.startsWith('/config?tab=')))
  assert.ok(!hrefs.includes('/ventas?nuevo=1'))
})

test('a query prepends a Pedidos search hand-off and filters accent-insensitively', () => {
  const items = buildPaletteItems(paletteInput)
  const filtered = filterPaletteItems(items, 'estadisticas', true)
  assert.equal(filtered[0].kind, 'search')
  assert.equal(filtered[0].href, '/ventas?buscar=estadisticas')
  assert.ok(filtered.some((i) => i.href === '/estadisticas'))
  const none = filterPaletteItems(items, 'zzzz', false)
  assert.deepEqual(none, [])
})
