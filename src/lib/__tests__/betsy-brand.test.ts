/**
 * Lane I · Betsy identity: the official mark (docs/design/betsy-mascot-handoff), agent "costumes"
 * (plate + ring + label, never a recolored mark), one shared logo, agents UI without emoji chrome,
 * the help button allowlist, and the appearance route guards. Appearance never reaches the agent runtime.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test, { describe } from 'node:test'
import {
  AGENT_PLATES,
  normalizePersonaName,
  parseAgentAppearance,
  resolveAgentAppearance,
} from '../agent-appearance'
import { helpButtonPlacement } from '../../components/brand/help-routes'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
function files(dir: string, re = /\.(tsx?|css)$/): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n)
    return statSync(f).isDirectory() ? files(f, re) : re.test(n) ? [f] : []
  })
}
/** Emoji glyphs (plain marks like ✓✓ for WhatsApp read ticks, or ↔ in comments, are fine). */
const EMOJI = /\p{Emoji_Presentation}|️/u

describe('agent appearance', () => {
  test('defaults: live personas by first name, others deterministic, ring off, label = first introduction name', () => {
    assert.equal(normalizePersonaName(' Andrés '), 'andres')
    assert.deepEqual(resolveAgentAppearance({ name: 'Ventas', introductionNames: ['Sofi'] }), { plate: 'teal', ring: false, displayName: 'Sofi' })
    assert.equal(resolveAgentAppearance({ name: 'Ventas', introductionNames: ['', 'andres'] }).plate, 'amber')
    const a = resolveAgentAppearance({ id: 'a1', name: 'Reservas', introductionNames: ['Mila'] })
    assert.deepEqual(a, resolveAgentAppearance({ id: 'zz', name: 'Otro', introductionNames: ['Mila'] }))
    assert.ok(AGENT_PLATES.includes(a.plate))
    assert.equal(resolveAgentAppearance({ id: null, name: 'Citas' }).plate, resolveAgentAppearance({ id: 'saved', name: 'Citas' }).plate)
    assert.equal(resolveAgentAppearance({ name: 'Citas' }).displayName, null)
  })
  test('saved values win; parse is tolerant and only accepts palette ids', () => {
    assert.deepEqual(resolveAgentAppearance({ name: 'X', introductionNames: ['Sofi'] }, { plate: 'rose', ring: true, displayName: 'Sofi PH' }), {
      plate: 'rose',
      ring: true,
      displayName: 'Sofi PH',
    })
    assert.equal(parseAgentAppearance(null), null)
    assert.equal(parseAgentAppearance({ plate: '#ff0000', ring: 'yes' }), null)
    assert.deepEqual(parseAgentAppearance({ plate: 'sky', extra: 1 }), { plate: 'sky' })
    assert.deepEqual(parseAgentAppearance({ displayName: '  ‮Sofi\u0007 ' }), { displayName: 'Sofi' })
    assert.deepEqual(parseAgentAppearance({ displayName: '   ' }), { displayName: null })
    assert.equal(parseAgentAppearance({ displayName: 'x'.repeat(80) })?.displayName?.length, 40)
  })
  test('the agent runtime never reads appearance (owner UI only)', () => {
    for (const f of files('src/lib/soft-ai', /\.ts$/)) assert.doesNotMatch(read(f), /agent[_-]appearance/, f)
  })
  test('route: session tenant, update_config + same-origin + rate limit on PUT, own agent only, palette ids, audited', () => {
    const route = read('src/app/api/chat/agents/appearance/route.ts')
    assert.match(route, /authenticateAgentAPI\(request, 'view_config'\)/)
    assert.match(route, /authenticateAgentAPI\(request, 'update_config'\)/)
    assert.match(route, /isSameOriginRequest\(request\)/)
    assert.match(route, /appearanceRateLimit\(`\$\{auth\.tenantId\}:\$\{auth\.userId\}`\)/)
    assert.match(route, /chatAgent\.findFirst\(\{ where: \{ id: agentId, tenantId: auth\.tenantId \}/)
    assert.match(route, /status: 404/)
    assert.match(route, /AGENT_PLATES as readonly unknown\[\]\)\.includes\(body\.plate\)/)
    assert.match(route, /logAuditEvent\(/)
    const store = read('src/lib/agent-appearance-store.ts')
    assert.match(store, /where: \{ tenantId, scope: tenantId, key: \{ startsWith: AGENT_APPEARANCE_KEY_PREFIX \} \}/)
    assert.match(store, /enabled: false, config/)
    assert.match(store, /own\.has\(agentId\)/)
  })
})

describe('brand source shape', () => {
  test('mark motion stops under prefers-reduced-motion; still pose is data-driven', () => {
    const css = read('src/components/brand/betsy-mark.module.css')
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/)
    assert.match(read('src/components/brand/BetsyMark.tsx'), /data-on=\{on \? '' : undefined\}/)
  })
  test('the mark keeps the official gradient (never recolored per agent)', () => {
    const mark = read('src/components/brand/BetsyMark.tsx')
    assert.match(mark, /blue: '#2F6BFF',\n  mid: '#5644E4',\n  violet: '#7A3FF0'/)
    assert.doesNotMatch(read('src/components/brand/AgentMark.tsx'), /tone=|stopColor/)
  })
  test('no Tailwind arbitrary-hex classes in src/components/brand (colors live in CSS / SVG attrs)', () => {
    for (const f of files('src/components/brand').filter((p) => p.endsWith('.tsx'))) {
      assert.doesNotMatch(read(f), /className=[^>]*\[#[0-9a-fA-F]{3,8}\]/, f)
    }
  })
  test('agents UI renders plates with the mark, not emojis; lists keep the mark still', () => {
    const agentFiles = [...files('src/components/aurora/agentes'), ...files('src/app/config/agentes')]
    for (const f of agentFiles) assert.doesNotMatch(read(f), EMOJI, f)
    const list = read('src/components/aurora/agentes/AgentListPanel.tsx')
    assert.doesNotMatch(list, /\.emoji\b/)
    assert.match(list, /<AgentFace agent=\{a\} size=\{48\} animated=\{false\} \/>/)
    assert.match(read('src/components/aurora/agentes/AgentDetailHeader.tsx'), /<AgentFace agent=\{agent\}/)
    assert.doesNotMatch(read('src/app/config/agentes/page.tsx'), /patch\(\{ emoji/)
    assert.match(read('src/app/config/agentes/page.tsx'), /<AgentAppearanceCard/)
  })
  test('one shared logo in the shell, auth, old home and soporte (landing-v2 wires it in its own brand.tsx)', () => {
    for (const f of [
      'src/components/aurora/AuroraSidebar.tsx',
      'src/components/aurora/auth/BetsyWordmark.tsx',
      'src/app/home/components/LandingPage.tsx',
      'src/app/soporte/page.tsx',
      'src/app/dashboard/enhanced-home-content.tsx',
    ]) {
      assert.match(read(f), /<BetsyLogo\b/, f)
    }
    assert.match(read('src/components/brand/BetsyLogo.tsx'), /BETSY_WORDMARK_PATH/)
  })
  test('the brand showcase is super-admin only', () => {
    const page = read('src/app/super-admin/avatar/page.tsx')
    assert.match(page, /if \(!userId\) redirect\('\/auth\/signin'\)/)
    assert.match(page, /if \(!\(await isSuperAdmin\(userId\)\)\) redirect\('\/dashboard'\)/)
  })
})

describe('help button placement', () => {
  test('public pages: every size', () => {
    for (const p of ['/privacy', '/terms', '/data-deletion', '/docs/inicio']) assert.equal(helpButtonPlacement(p), 'all', p)
  })
  test('never inside the app (the sidebar already shows the mark: one per view) nor over soporte/auth/kiosk', () => {
    for (const p of ['/home', '/home-preview', '/dashboard', '/config/general', '/chats', '/chats/abc', '/config/agentes', '/ventas', '/pedidos', '/produccion', '/estadisticas', '/logistics', '/soporte', '/auth/signin', '/work-clock', '/super-admin', '/homework', null]) {
      assert.equal(helpButtonPlacement(p), null, String(p))
    }
  })
  test('mounted once, a plain link to /soporte (no session fetch), mark listens on hover', () => {
    assert.match(read('src/app/components/ClientProviders.tsx'), /<BetsyHelpButton \/>/)
    const btn = read('src/components/brand/BetsyHelpButton.tsx')
    assert.match(btn, /href="\/soporte"/)
    assert.match(btn, /state=\{hover \? 'listen' : 'idle'\}/)
    assert.doesNotMatch(btn, /useSession/)
  })
})
