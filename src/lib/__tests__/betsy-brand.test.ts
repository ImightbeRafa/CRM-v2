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
    assert.deepEqual(parseAgentAppearance({ displayName: '  \u202eSofi\u0007 ' }), { displayName: 'Sofi' })
    assert.deepEqual(parseAgentAppearance({ displayName: '   ' }), { displayName: null })
    assert.equal(parseAgentAppearance({ displayName: 'x'.repeat(80) })?.displayName?.length, 40)
    // SecureDog Info-1: BiDi marks / C1 / line separators out; never half an emoji at the cut.
    assert.deepEqual(parseAgentAppearance({ displayName: '\u200fSo\u0085fi\u2028' }), { displayName: 'Sofi' })
    const cut = parseAgentAppearance({ displayName: 'a'.repeat(39) + '😀😀' })?.displayName ?? ''
    assert.equal(Array.from(cut).length, 40)
    assert.ok(cut.endsWith('😀'))
    assert.equal(parseAgentAppearance({ displayName: 'Ana 👩‍💻' })?.displayName, 'Ana 👩‍💻')
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
    // Exact keys of the business's own agents (SecureDog Info-2) and a body cap before parsing (Low-1).
    assert.match(store, /where: \{ tenantId, scope: tenantId, key: \{ in: agents\.map\(\(a\) => appearanceKey\(a\.id\)\) \} \}/)
    assert.match(route, /if \(declared > MAX_BODY_BYTES\)/)
    assert.match(route, /if \(raw\.length > MAX_BODY_BYTES\)/)
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
  test('agents UI renders plates with the mark, not emojis; only the hovered card moves', () => {
    const agentFiles = [...files('src/components/aurora/agentes'), ...files('src/app/config/agentes')]
    for (const f of agentFiles) assert.doesNotMatch(read(f), EMOJI, f)
    const list = read('src/components/aurora/agentes/AgentListPanel.tsx')
    assert.doesNotMatch(list, /\.emoji\b/)
    // Only the hovered / focused card moves (listen); drafts show the paused mark.
    assert.match(list, /state=\{a\.status !== 'live' \? 'paused' : active === a\.id \? 'listen' : 'idle'\}/)
    assert.match(list, /animated=\{active === a\.id\}/)
    assert.match(read('src/components/aurora/agentes/AgentDetailHeader.tsx'), /state=\{publishing \? 'think' : status === 'live' \? 'idle' : 'paused'\}/)
    assert.match(read('src/components/aurora/agentes/AgentDetailHeader.tsx'), /<AgentFace agent=\{agent\}/)
    assert.doesNotMatch(read('src/app/config/agentes/page.tsx'), /patch\(\{ emoji/)
    assert.match(read('src/app/config/agentes/page.tsx'), /<AgentAppearanceCard/)
  })
  test('one shared logo in the shell, auth, old home and soporte (landing-v2 wires it in its own brand.tsx)', () => {
    for (const f of [
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

describe('Betsy presence (animated mark)', () => {
  test('signals: only the known names pass; emit is a no-op without a window', async () => {
    const { isBetsySignal, emitBetsySignal } = await import('../../components/brand/betsy-signals')
    assert.equal(isBetsySignal('read'), true)
    assert.equal(isBetsySignal('hack'), false)
    assert.doesNotThrow(() => emitBetsySignal('read'))
  })
  test('machine: reactions never cancel a reply in progress; watchdog; read blink hands back to idle', async () => {
    const { PRESENCE_IDLE, PRESENCE_TIMING: T, presenceReduce: r, presenceView: v, nextDeadline } = await import('../../components/brand/presence-machine')
    let s = PRESENCE_IDLE
    assert.equal(v(s, 0).state, 'idle')
    // think, then a customer message: listen shows, then back to think (not idle).
    s = r(s, 'think', 1000)
    s = r(s, 'listen', 1500)
    assert.equal(v(s, 1600).state, 'listen')
    assert.equal(v(s, 1500 + T.listenMs + 1).state, 'think')
    // listen, then typing within 1.2 s: typing is not undone by the listen ending.
    s = r(PRESENCE_IDLE, 'listen', 0)
    s = r(s, 'typing', 500)
    assert.equal(v(s, T.listenMs + 10).state, 'typing')
    // yes during typing hops, then returns to typing; a listen does not cut the hop.
    s = r(s, 'yes', 2000)
    s = r(s, 'listen', 2100)
    assert.equal(v(s, 2200).state, 'yes')
    assert.equal(v(s, 2000 + T.yesMs + 1).state, 'typing')
    // done → idle; the watchdog ends a reply that never got its done.
    assert.equal(v(r(s, 'done', 5000), 5001).state, 'idle')
    const lost = r(PRESENCE_IDLE, 'think', 0)
    assert.equal(v(lost, T.replyWatchdogMs - 1).state, 'think')
    assert.equal(v(lost, T.replyWatchdogMs + 1).state, 'idle')
    // Re-sending typing re-arms the watchdog (long streams).
    const long = r(r(PRESENCE_IDLE, 'typing', 0), 'typing', 15_000)
    assert.equal(v(long, 25_000).state, 'typing')
    // read / replied: double blink for 700 ms on top of the current state, then undefined (idle blink back).
    let b = r(PRESENCE_IDLE, 'think', 0)
    b = r(b, 'read', 100)
    assert.deepEqual(v(b, 200), { state: 'think', readSignal: 1 })
    assert.equal(v(b, 100 + T.readBlinkMs + 1).readSignal, undefined)
    b = r(b, 'replied', 1000)
    assert.equal(v(b, 1100).readSignal, 2)
    // One re-render at the next deadline only.
    assert.equal(nextDeadline(b, 1100), 1000 + T.readBlinkMs)
    assert.equal(nextDeadline(PRESENCE_IDLE, 0), null)
  })
  test('sidebar: the live mark is its own component (signals re-render only the logo), 32 px+ so think shows', () => {
    const side = read('src/components/aurora/AuroraSidebar.tsx')
    assert.match(side, /<LiveBetsyLogo mark size=\{26\} \/>/)
    assert.match(side, /<LiveBetsyLogo lockup size=\{18\} \/>/)
    assert.doesNotMatch(side, /useBetsyPresence/)
    assert.match(read('src/components/brand/LiveBetsyLogo.tsx'), /const presence = useBetsyPresence\(\)/)
    assert.match(read('src/components/brand/useBetsyPresence.ts'), /window\.removeEventListener\(BETSY_SIGNAL_EVENT, onSignal\)/)
  })
  test('the hop remounts only on entering yes (no blink restart on other state changes)', () => {
    assert.match(read('src/components/brand/BetsyMark.tsx'), /key=\{state === 'yes' \? 'hop-yes' : 'hop'\}/)
  })
  test('inside a logo the typing state shows the think light (dots would shift the wordmark)', () => {
    assert.match(read('src/components/brand/BetsyLogo.tsx'), /markState\?\.state === 'typing' \? \{ \.\.\.markState, state: 'think' as const \}/)
  })
  test('agent cards: no flicker moving focus inside a card; focused card keeps listening on mouse leave', () => {
    const list = read('src/components/aurora/agentes/AgentListPanel.tsx')
    assert.match(list, /if \(e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)\) return/)
    assert.match(list, /if \(e\.currentTarget\.contains\(document\.activeElement\)\) return/)
    assert.match(read('src/components/aurora/agentes/NewAgentForm.tsx'), /state="paused"/)
  })
})
