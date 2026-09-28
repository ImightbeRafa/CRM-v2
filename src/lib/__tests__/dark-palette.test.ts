/**
 * Dark mode palette contract (Config › General › Apariencia): single source, generated CSS in
 * sync, light mode = Tailwind defaults, dark text pairs meet WCAG AA.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test, { describe } from 'node:test'

const require = createRequire(import.meta.url)
const palette = require('../theme/palette.cjs')
const twColors = require('tailwindcss/colors')

const read = (p: string) => readFileSync(p, 'utf8')
const DARK = palette.DARK as Record<string, string>

describe('palette source', () => {
  test('generated CSS is in sync with src/lib/theme/palette.cjs (npm run theme:gen)', () => {
    assert.equal(read('src/app/theme-palette.css').replace(/\r\n/g, '\n'), palette.buildCss())
  })
  test('light values are exactly the Tailwind defaults (light mode unchanged)', () => {
    for (const v of palette.paletteVars() as Array<{ name: string; light: string }>) {
      const m = /^--p-(bg|bd|tx)-([a-z]+)-(\d+)$/.exec(v.name)
      if (!m) continue
      assert.equal(v.light.toLowerCase(), String(twColors[m[2]][m[3]]).toLowerCase(), v.name)
    }
  })
  test('every hex token keeps its original light color', () => {
    for (const [name, t] of Object.entries(palette.loadHexTokens() as Record<string, { light: string }>)) {
      assert.equal(t.light.toLowerCase().replace('#', ''), name.split('-').pop(), name)
    }
  })
  test('no arbitrary-hex class is left that should be a theme token', () => {
    const out = execFileSync('node', ['scripts/theme-hex-codemod.cjs', '--check'], { encoding: 'utf8' })
    assert.match(out, /^ok/)
  })
})

describe('dark contrast (WCAG AA ≥ 4.5)', () => {
  const surfaces = [DARK.canvas, DARK.surface, DARK.elevated]
  const vars = Object.fromEntries(
    (palette.paletteVars() as Array<{ name: string; dark: string }>).map((v) => [v.name, v.dark]),
  )
  test('neutral text 400–950 on canvas / surface / elevated', () => {
    for (const c of palette.NEUTRALS as string[]) {
      for (const s of [400, 500, 600, 700, 800, 900, 950]) {
        for (const bg of surfaces) {
          const ratio = palette.contrast(vars[`--p-tx-${c}-${s}`], bg)
          assert.ok(ratio >= 4.5, `text-${c}-${s} on ${bg}: ${ratio.toFixed(2)}`)
        }
      }
    }
  })
  test('status pairs: text-X-600…900 on bg-X-50…200 and on the surface', () => {
    for (const c of palette.HUES as string[]) {
      for (const s of [600, 700, 800, 900]) {
        const fg = vars[`--p-tx-${c}-${s}`]
        for (const bgShade of [50, 100, 200]) {
          const bg = vars[`--p-bg-${c}-${bgShade}`]
          const ratio = palette.contrast(fg, bg)
          assert.ok(ratio >= 4.5, `text-${c}-${s} on bg-${c}-${bgShade}: ${ratio.toFixed(2)}`)
        }
        assert.ok(palette.contrast(fg, DARK.surface) >= 4.5, `text-${c}-${s} on surface`)
      }
    }
  })
  test('ink tokens are readable on the surface', () => {
    for (const [name, t] of Object.entries(palette.loadHexTokens() as Record<string, { dark: string }>)) {
      if (!name.startsWith('ink-')) continue
      assert.ok(palette.contrast(t.dark, DARK.surface) >= 4.5, name)
    }
  })
})

describe('theme wiring', () => {
  test('tailwind reads the palette; dark: never applies inside .theme-light', () => {
    const tw = read('tailwind.config.ts')
    assert.match(tw, /require\("\.\/src\/lib\/theme\/palette\.cjs"\)/)
    assert.match(tw, /&:is\(\.dark \*\):not\(:is\(\.theme-light, \.theme-light \*\)\)/)
  })
  test('.aurora-light only forces light when the theme is light; print is always light', () => {
    const css = read('src/app/components/globals.css')
    assert.match(css, /html:not\(\.dark\) \.aurora-light,\n  \.theme-light \{/)
    assert.match(css, /@media print \{\n    html\.dark \{/)
    assert.match(read('src/app/theme-palette.css'), /@media print/)
  })
  test('the switch lives in Config › General, the profile menu and the mobile Más sheet', () => {
    assert.match(read('src/app/config/ConfigPageClient.tsx'), /<AppearanceSettings \/>/)
    assert.match(read('src/components/aurora/shell/AuroraProfileMenu.tsx'), /<ThemeSegmented \/>/)
    assert.match(read('src/components/aurora/AuroraMobileNav.tsx'), /<ThemeSegmented \/>/)
    assert.match(read('src/app/layout.tsx'), /defaultTheme="system" enableSystem/)
  })
  test('always-dark / own-look islands are fenced', () => {
    assert.match(read('src/app/logistics/layout.tsx'), /lm-root theme-static/)
    assert.match(read('src/app/home/page.tsx'), /theme-static/)
    assert.match(read('src/components/aurora/AuroraSidebar.tsx'), /bg-au-sidebar/)
    assert.doesNotMatch(read('src/components/aurora/AuroraSidebar.tsx'), /\bbg-white\//)
  })
})
