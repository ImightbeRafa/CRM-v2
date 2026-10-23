/**
 * Lane I · Betsy visual identity: avatar variants are deterministic, motion respects
 * reduced-motion, brand colors stay out of Tailwind hex classes, the agents UI has no emoji
 * chrome, one shared wordmark, and the help button only shows on allowlisted routes.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test, { describe } from 'node:test'
import {
  BETSY_VARIANT,
  normalizePersonaName,
  resolveAvatarVariant,
  stableHash,
} from '../../components/brand/betsy-avatar/variants'
import { helpButtonPlacement } from '../../components/brand/help-routes'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n)
    return statSync(f).isDirectory() ? files(f) : /\.(tsx?|css)$/.test(n) ? [f] : []
  })
}
/** Emoji glyphs (plain marks like ✓✓ for WhatsApp read ticks, or ↔ in comments, are fine). */
const EMOJI = /\p{Emoji_Presentation}|️/u

describe('avatar variants', () => {
  test('curated personas by customer-facing first name (accents and case ignored)', () => {
    assert.equal(normalizePersonaName(' Andrés '), 'andres')
    assert.equal(resolveAvatarVariant({ id: 'x', name: 'Ventas', introductionNames: ['Sofi'] }).key, 'sofi')
    assert.equal(resolveAvatarVariant({ id: 'x', name: 'Ventas', introductionNames: ['', 'andres'] }).key, 'andres')
    assert.equal(resolveAvatarVariant({ introductionNames: ['Betsy'] }).palette, BETSY_VARIANT.palette)
  })
  test('generated variants are deterministic and do not depend on the id once named', () => {
    const a = resolveAvatarVariant({ id: 'a1', name: 'Reservas', introductionNames: ['Mila'] })
    const b = resolveAvatarVariant({ id: 'zz', name: 'Otro nombre', introductionNames: ['Mila'] })
    assert.deepEqual(a, { ...b, displayName: a.displayName })
    assert.equal(stableHash('betsy'), stableHash('betsy'))
    const c = resolveAvatarVariant({ id: null, name: 'Citas' })
    assert.deepEqual(c, resolveAvatarVariant({ id: 'saved-id', name: 'Citas' }))
    assert.equal(c.displayName, 'Citas')
    assert.match(c.key, /^gen-/)
  })
})

describe('brand source shape', () => {
  test('avatar motion stops under prefers-reduced-motion and data-still', () => {
    const css = read('src/components/brand/betsy-avatar/betsy-avatar.module.css')
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/)
    assert.match(css, /\.root\[data-still\][\s\S]*animation: none !important/)
  })
  test('no Tailwind arbitrary-hex classes in src/components/brand (colors live in CSS / SVG attrs)', () => {
    for (const f of files('src/components/brand').filter((p) => p.endsWith('.tsx'))) {
      assert.doesNotMatch(read(f), /className=[^>]*\[#[0-9a-fA-F]{3,8}\]/, f)
    }
  })
  test('agents UI renders faces, not emojis', () => {
    const agentFiles = [...files('src/components/aurora/agentes'), ...files('src/app/config/agentes')]
    for (const f of agentFiles) assert.doesNotMatch(read(f), EMOJI, f)
    assert.doesNotMatch(read('src/components/aurora/agentes/AgentListPanel.tsx'), /\.emoji\b/)
    assert.doesNotMatch(read('src/app/config/agentes/page.tsx'), /patch\(\{ emoji/)
    assert.match(read('src/components/aurora/agentes/AgentListPanel.tsx'), /<AgentFace agent=\{a\}/)
    assert.match(read('src/components/aurora/agentes/AgentDetailHeader.tsx'), /<AgentFace agent=\{agent\}/)
  })
  test('one shared wordmark in the shell, auth, homes and soporte', () => {
    for (const f of [
      'src/components/aurora/AuroraSidebar.tsx',
      'src/components/aurora/auth/BetsyWordmark.tsx',
      'src/app/home/components/LandingPage.tsx',
      'src/components/landing-v2/islands/Nav.tsx',
      'src/components/landing-v2/sections/Closing.tsx',
      'src/app/soporte/page.tsx',
      'src/app/dashboard/enhanced-home-content.tsx',
    ]) {
      assert.match(read(f), /<BetsyLogo\b/, f)
    }
    assert.match(read('src/components/brand/betsy-logo.module.css'), /#1e5bf6[\s\S]*#9425f9/)
  })
  test('the avatar showcase is super-admin only', () => {
    const page = read('src/app/super-admin/avatar/page.tsx')
    assert.match(page, /if \(!userId\) redirect\('\/auth\/signin'\)/)
    assert.match(page, /if \(!\(await isSuperAdmin\(userId\)\)\) redirect\('\/dashboard'\)/)
  })
})

describe('help button placement', () => {
  test('public pages: every size', () => {
    for (const p of ['/home', '/home-preview', '/privacy', '/terms', '/docs/inicio']) assert.equal(helpButtonPlacement(p), 'all', p)
  })
  test('app shell: desktop only, never over composers, sandboxes or dense tables', () => {
    assert.equal(helpButtonPlacement('/dashboard'), 'desktop')
    assert.equal(helpButtonPlacement('/config/general'), 'desktop')
    for (const p of ['/chats', '/chats/abc', '/config/agentes', '/ventas', '/pedidos', '/produccion', '/estadisticas', '/logistics', '/soporte', '/auth/signin', '/work-clock', '/super-admin', '/homework', null]) {
      assert.equal(helpButtonPlacement(p), null, String(p))
    }
  })
  test('mounted once, as a plain link to /soporte (no session fetch)', () => {
    assert.match(read('src/app/components/ClientProviders.tsx'), /<BetsyHelpButton \/>/)
    const btn = read('src/components/brand/BetsyHelpButton.tsx')
    assert.match(btn, /href="\/soporte"/)
    assert.doesNotMatch(btn, /useSession/)
  })
})
