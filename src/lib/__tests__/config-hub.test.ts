import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONFIG_HUB_TAB,
  CONFIG_NAV,
  CONFIG_TAB_IDS,
  LEGACY_TAB_REDIRECTS,
  configTabHref,
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
  assert.ok(!allItems.some((i) => i.href?.includes('ai-assistant') || i.tab === ('ai-assistant' as never)))
  assert.ok(!CONFIG_TAB_IDS.includes('ai-assistant' as never))
  assert.ok(!AURORA_NAV.flatMap((s) => s.items).some((i) => i.href.includes('ai-assistant')))
  assert.equal(resolveConfigTab('ai-assistant'), CONFIG_HUB_TAB)
  assert.equal(LEGACY_TAB_REDIRECTS['ai-assistant'], '/config')
})

test('no owner-facing "Soft" wording in Config nav', () => {
  for (const i of allItems) assert.doesNotMatch(i.label, /soft/i)
})

test('existing utilities stay reachable: canales, agentes, integraciones, perfil, usuarios, facturación, campos', () => {
  const hrefs = allItems.map((i) => i.href).filter(Boolean)
  assert.ok(hrefs.includes('/config/social'))
  assert.ok(hrefs.includes('/config/agentes'))
  assert.ok(hrefs.includes('/config/integrations'))
  for (const t of ['profile', 'users', 'billing', 'fields', 'statuses', 'inventory', 'clients', 'shipping-config', 'import', 'bulk-delete', 'audit']) {
    assert.ok(CONFIG_TAB_IDS.includes(t as never), `missing tab ${t}`)
  }
})

test('every item is either a tab or an href, never both', () => {
  for (const i of allItems) assert.equal(Boolean(i.tab) !== Boolean(i.href), true, i.key)
})

test('legacy pass-through tabs redirect to their real routes', () => {
  assert.equal(LEGACY_TAB_REDIRECTS.social, '/config/social')
  assert.equal(LEGACY_TAB_REDIRECTS.agentes, '/config/agentes')
  assert.equal(LEGACY_TAB_REDIRECTS.integrations, '/config/integrations')
  assert.equal(configTabHref(CONFIG_HUB_TAB), '/config')
  assert.equal(configTabHref('users'), '/config?tab=users')
})
