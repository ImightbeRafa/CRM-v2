import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (p: string) => readFileSync(p, 'utf8')

test('AuroraShell is context-aware: nested shells render only their children', () => {
  const src = read('src/components/aurora/AuroraShell.tsx')
  assert.match(src, /createContext\(false\)/)
  assert.match(src, /if \(nested\) return <>\{children\}<\/>/)
})

test('/config/social stays a real page inside the Config chrome, with the server permission gate', () => {
  const layout = read('src/app/config/social/layout.tsx')
  assert.match(layout, /await requirePermission\('update_config'\)/)
  assert.match(layout, /<ConfigShell activeTab="social">/)
  assert.ok(!/redirect\(/.test(layout))
})

test('/config server page normalises ?tab= and /config/[...slug] redirects into tabs', () => {
  const page = read('src/app/config/page.tsx')
  assert.match(page, /normalizeConfigSearch/)
  assert.match(page, /redirect\(href\)/)
  const slug = read('src/app/config/[...slug]/page.tsx')
  assert.match(slug, /configPathAliasToHref/)
})

test('classic MobileBottomNav is gone from /config and /dashboard', () => {
  for (const f of ['src/app/config/ConfigPageClient.tsx', 'src/app/dashboard/components/AuroraHome.tsx']) {
    assert.ok(!/MobileBottomNav/.test(read(f)), f)
  }
  assert.match(read('src/app/dashboard/enhanced-home-content.tsx'), /bottomNav=\{<AuroraMobileNav \/>\}/)
})

test('mobile Canales tab opens /config?tab=social; sub-nav is never hidden on mobile', () => {
  const nav = read('src/components/aurora/AuroraMobileNav.tsx')
  assert.match(nav, /CANALES_HREF = '\/config\?tab=social'/)
  const select = read('src/components/aurora/config/ConfigSectionSelect.tsx')
  assert.match(select, /Sección:/)
  assert.match(select, /md:hidden/)
})

test('Comunicación panels are kept alive and social is permission-gated', () => {
  const page = read('src/app/config/ConfigPageClient.tsx')
  assert.match(page, /hidden=\{activeTab !== 'social'\}/)
  assert.match(page, /<PanelGate permission="update_config"/)
  assert.match(page, /hidden=\{activeTab !== 'agentes'\}/)
  assert.match(page, /hidden=\{activeTab !== 'integrations'\}/)
})

test('Embedded Signup page only changed its header copy; agentes page keeps its locks', () => {
  const social = read('src/app/config/social/page.tsx')
  assert.match(social, />Cuentas conectadas<\/h1>/)
  const agentes = read('src/app/config/agentes/page.tsx')
  assert.match(agentes, /Detener agente/)
  assert.ok(!/@\/lib\/bot/.test(agentes))
  assert.ok(!/WHATSAPP_/.test(agentes))
})

test('.aurora-light keeps shadcn tokens light under html.dark', () => {
  const css = read('src/app/components/globals.css')
  assert.match(css, /\.aurora-light \{/)
  assert.match(read('src/components/aurora/config/ConfigShell.tsx'), /aurora-light/)
})

test('next.config.js consumes the shared redirect list and keeps /pedidos', () => {
  const cfg = read('next.config.js')
  assert.match(cfg, /\.\.\.CONFIG_PATH_REDIRECTS/)
  assert.match(cfg, /source: '\/pedidos'/)
  assert.match(cfg, /source: '\/pedidos\/:path\*'/)
})

test('no owner-facing "Soft" copy in the Config chrome / panels', () => {
  for (const f of [
    'src/components/aurora/config/ConfigShell.tsx',
    'src/components/aurora/config/ConfigSubNav.tsx',
    'src/components/aurora/config/ConfigSectionSelect.tsx',
    'src/components/aurora/config/ConfigTopbar.tsx',
    'src/components/aurora/config/ConfigHub.tsx',
    'src/components/aurora/config/panels/UsersPanel.tsx',
    'src/components/aurora/config/panels/IntegrationsPanel.tsx',
    'src/components/aurora/aurora-nav.ts',
  ]) {
    assert.ok(!/soft/i.test(read(f)), f)
  }
})
