import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  CONFIG_HUB_TAB,
  CONFIG_TAB_IDS,
  configPathAliasToHref,
  normalizeConfigSearch,
  normalizeTabParam,
} from '../../components/aurora/config/config-nav'
import { AURORA_ALIAS_REDIRECTS, CONFIG_PATH_REDIRECTS } from '../../components/aurora/config/config-redirects.mjs'

const BRIEF_ALIASES: Record<string, string> = {
  hub: CONFIG_HUB_TAB,
  resumen: CONFIG_HUB_TAB,
  general: 'profile',
  productos: 'inventory',
  campos: 'fields',
  estados: 'statuses',
  clientes: 'clients',
  cuentas: 'social',
  canales: 'social',
  integraciones: 'integrations',
  envios: 'shipping-config',
  shipping: 'shipping-config',
  importar: 'import',
  eliminacion: 'bulk-delete',
  equipo: 'users',
  plan: 'billing',
  auditoria: 'audit',
}

test('every brief alias maps to its canonical tab (case and accent insensitive)', () => {
  for (const [alias, canonical] of Object.entries(BRIEF_ALIASES)) {
    assert.equal(normalizeTabParam(alias), canonical, alias)
    assert.equal(normalizeTabParam(alias.toUpperCase()), canonical, alias.toUpperCase())
  }
  assert.equal(normalizeTabParam('Eliminación'), 'bulk-delete')
  assert.equal(normalizeTabParam('Auditoría'), 'audit')
})

test('canonical ids pass through; unknown and staff tabs go to the hub', () => {
  for (const id of CONFIG_TAB_IDS) assert.equal(normalizeTabParam(id), id)
  assert.equal(normalizeTabParam('nope'), CONFIG_HUB_TAB)
  assert.equal(normalizeTabParam(''), CONFIG_HUB_TAB)
  assert.equal(normalizeTabParam(undefined), CONFIG_HUB_TAB)
  assert.equal(normalizeTabParam('ai-assistant'), CONFIG_HUB_TAB)
})

test('normalizeConfigSearch: aliases redirect, canonical stays put', () => {
  assert.deepEqual(normalizeConfigSearch('tab=general'), { href: '/config?tab=profile', changed: true })
  assert.deepEqual(normalizeConfigSearch('tab=profile'), { href: '/config?tab=profile', changed: false })
  assert.deepEqual(normalizeConfigSearch(''), { href: '/config', changed: false })
  assert.deepEqual(normalizeConfigSearch('tab=hub'), { href: '/config', changed: true })
  assert.deepEqual(normalizeConfigSearch('tab=resumen'), { href: '/config', changed: true })
  assert.deepEqual(normalizeConfigSearch('tab=ai-assistant'), { href: '/config', changed: true })
  assert.deepEqual(normalizeConfigSearch('tab=nope'), { href: '/config', changed: true })
})

test('normalizeConfigSearch is idempotent', () => {
  for (const alias of [...Object.keys(BRIEF_ALIASES), 'nope', 'ai-assistant', 'billing', '']) {
    const first = normalizeConfigSearch(`tab=${alias}&x=1`)
    const second = normalizeConfigSearch(first.href.split('?')[1] ?? '')
    assert.equal(second.href, first.href, alias)
    assert.equal(second.changed, false, alias)
  }
})

test('other params (Tilopay, OAuth) are preserved in original order', () => {
  assert.equal(normalizeConfigSearch('tab=plan&payment=approved').href, '/config?tab=billing&payment=approved')
  assert.equal(normalizeConfigSearch('success=true&tab=billing').href, '/config?tab=billing&success=true')
  assert.equal(normalizeConfigSearch('tab=billing&canceled=true').changed, false)
  assert.equal(normalizeConfigSearch('tab=billing&status=success').changed, false)
  assert.equal(normalizeConfigSearch('tab=hub&code=abc&state=xyz').href, '/config?code=abc&state=xyz')
})

test('agent deep links stay canonical', () => {
  const r = normalizeConfigSearch('tab=agentes&agente=a1&seccion=conocimiento&card=precios')
  assert.equal(r.changed, false)
  assert.equal(r.href, '/config?tab=agentes&agente=a1&seccion=conocimiento&card=precios')
})

test('configPathAliasToHref maps /config/<x> paths', () => {
  assert.equal(configPathAliasToHref(['clientes'], 'q=a'), '/config?tab=clients&q=a')
  assert.equal(configPathAliasToHref(['xyz', 'abc'], 'y=2'), '/config?y=2')
  assert.equal(configPathAliasToHref(['equipo']), '/config?tab=users')
  assert.equal(configPathAliasToHref(['plan']), '/config?tab=billing')
  assert.equal(configPathAliasToHref(['integraciones']), '/config?tab=integrations')
  assert.equal(configPathAliasToHref(['ai-assistant']), '/config')
  assert.equal(configPathAliasToHref([], ''), '/config')
  assert.equal(configPathAliasToHref(['%E0%A4%A'], ''), '/config')
})

test('static redirect list: 307s, ordered, canonical destinations, live pages excluded', () => {
  for (const r of CONFIG_PATH_REDIRECTS) {
    assert.equal(r.permanent, false, r.source)
    const dest = new URL(r.destination, 'http://x')
    const norm = normalizeConfigSearch(dest.searchParams)
    assert.equal(norm.changed, false, `${r.source} -> ${r.destination} must be canonical`)
    assert.notEqual(normalizeTabParam(dest.searchParams.get('tab')), CONFIG_HUB_TAB, r.source)
  }
  const sources = CONFIG_PATH_REDIRECTS.map((r) => r.source)
  assert.ok(sources.indexOf('/config/agentes/conocimiento') < sources.indexOf('/config/agentes/:rest+'))
  assert.ok(!sources.includes('/config/social'), '/config/social must stay a real page')
  assert.ok(!sources.some((s) => s.startsWith('/config/ai-assistant')))
  const byS = Object.fromEntries(CONFIG_PATH_REDIRECTS.map((r) => [r.source, r.destination]))
  assert.equal(byS['/canales'], '/config?tab=social')
  assert.equal(byS['/agentes'], '/config?tab=agentes')
  assert.equal(byS['/config/agentes'], '/config?tab=agentes')
  assert.equal(byS['/config/integrations'], '/config?tab=integrations')
})

test('/inicio redirects to /dashboard (307, not permanent) and is wired into next.config.js', () => {
  const rule = AURORA_ALIAS_REDIRECTS.find((r) => r.source === '/inicio')
  assert.ok(rule)
  assert.equal(rule.destination, '/dashboard')
  assert.equal(rule.permanent, false)
  assert.ok(!AURORA_ALIAS_REDIRECTS.some((r) => r.destination.includes('?')), 'no query on destination: Next preserves the request query')
  const cfg = readFileSync(resolve(process.cwd(), 'next.config.js'), 'utf8')
  assert.match(cfg, /\.\.\.AURORA_ALIAS_REDIRECTS/)
})
