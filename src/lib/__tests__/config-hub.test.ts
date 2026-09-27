import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONFIG_HUB_TAB,
  CONFIG_NAV,
  CONFIG_TAB_IDS,
  configTabHref,
  normalizeTabParam,
  resolveConfigTab,
} from '../../components/aurora/config/config-nav'
import { AURORA_NAV } from '../../components/aurora/aurora-nav'

const allItems = CONFIG_NAV.flatMap((g) => g.items)

test('no tab param lands on the hub; unknown tabs fall back to the hub', () => {
  assert.equal(resolveConfigTab(null), CONFIG_HUB_TAB)
  assert.equal(resolveConfigTab('nope'), CONFIG_HUB_TAB)
  assert.equal(resolveConfigTab('billing'), 'billing')
})

test('staff ai-assistant is not reachable from owner Config nav, hub tabs or Aurora nav', () => {
  assert.ok(!allItems.some((i) => i.tab === ('ai-assistant' as never)))
  assert.ok(!CONFIG_TAB_IDS.includes('ai-assistant' as never))
  assert.ok(!AURORA_NAV.flatMap((s) => s.items).some((i) => i.href.includes('ai-assistant')))
  assert.equal(normalizeTabParam('ai-assistant'), CONFIG_HUB_TAB)
})

test('no owner-facing "Soft" wording in Config nav', () => {
  for (const i of allItems) assert.doesNotMatch(i.label, /soft/i)
})

test('every item is a tab and all 14 canonical ids exist', () => {
  for (const i of allItems) assert.equal(i.key, i.tab)
  assert.equal(CONFIG_TAB_IDS.length, 14)
  for (const t of [
    'profile', 'inventory', 'fields', 'statuses', 'clients',
    'social', 'agentes', 'integrations',
    'shipping-config', 'import', 'bulk-delete',
    'users', 'billing', 'audit',
  ]) {
    assert.ok(CONFIG_TAB_IDS.includes(t as never), `missing tab ${t}`)
  }
})

test('sub-nav labels/order follow the Figma frames', () => {
  assert.deepEqual(
    CONFIG_NAV.map((g) => [g.title, g.items.map((i) => i.label)]),
    [
      ['Negocio', ['General', 'Productos', 'Campos', 'Estados', 'Clientes']],
      ['Comunicación', ['Cuentas conectadas', 'Agentes IA', 'Integraciones API']],
      ['Operación', ['Envíos', 'Importar', 'Eliminación masiva']],
      ['Cuenta', ['Equipo', 'Plan', 'Auditoría']],
    ],
  )
})

test('Comunicación items are tabs now (single layout), not standalone hrefs', () => {
  assert.equal(configTabHref('social'), '/config?tab=social')
  assert.equal(configTabHref('agentes'), '/config?tab=agentes')
  assert.equal(configTabHref('integrations'), '/config?tab=integrations')
  assert.equal(configTabHref(CONFIG_HUB_TAB), '/config')
  assert.equal(configTabHref('users'), '/config?tab=users')
  assert.equal((allItems.find((i) => i.tab === 'social') as { href?: string }).href, undefined)
})
