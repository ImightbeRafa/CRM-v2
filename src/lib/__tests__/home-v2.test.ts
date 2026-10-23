/**
 * Home v2 (/home-preview): a preview Rafael can open, not indexed, one price source, accessible demos, honest copy.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel: string) => fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n')
const DIR = 'src/components/landing-v2'
const all = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const files = all(DIR).filter((f) => /\.(tsx?|css)$/.test(f))
const source = files.map((f) => read(f)).join('\n')

test('preview route: public by an exact middleware entry, noindex, own look in any theme', () => {
  const page = read('src/app/home-preview/page.tsx')
  assert.match(page, /robots: \{ index: false, follow: false/)
  assert.match(page, /theme-static/)
  assert.match(read('src/middleware.ts'), /'\/home-preview',/)
  // /home itself is untouched by this slice: it still renders the current landing.
  assert.match(read('src/app/home/page.tsx'), /import LandingPage from '\.\/components\/LandingPage'/)
  // Not linked from the current landing or the app.
  for (const f of ['src/app/home/components/LandingPage.tsx', 'src/app/home/page.tsx']) assert.doesNotMatch(read(f), /home-preview/)
})

test('price and contact come from their single sources; no hand-typed price', () => {
  assert.doesNotMatch(source, /\$\s?20\b|22\.60|₡10[.,]000/)
  const v2 = read(`${DIR}/LandingV2.tsx`)
  assert.match(v2, /planPriceLabels\(\)/)
  assert.match(v2, /getSupportContactConfig\(\)/)
  assert.doesNotMatch(source, /wa\.me\/\d|hola@betsycrm\.com|@betsy_crm/)
})

test('no import from src/app/home (that folder belongs to the /home release split)', () => {
  assert.doesNotMatch(source, /from '@\/app\/home|from '\.\.\/\.\.\/app\/home/)
})

test('styling stays in the CSS module: no arbitrary-hex Tailwind classes (dark theme check)', () => {
  for (const f of files.filter((x) => x.endsWith('.tsx'))) {
    assert.doesNotMatch(read(f), /className=[^>]*\[#[0-9a-fA-F]{3,8}\]/, f)
  }
})

test('demos: animated stage hidden from screen readers, real step list, pause + replay, reduced motion, lazy players', () => {
  assert.match(read(`${DIR}/demos/DemoFrame.tsx`), /className=\{s\.stage\} aria-hidden/)
  assert.match(read(`${DIR}/demos/DemoFrame.tsx`), /'Pausar'/)
  assert.match(read(`${DIR}/demos/DemoFrame.tsx`), /Repetir/)
  assert.match(read(`${DIR}/sections/Hero.tsx`), /<StorySteps className=\{s\.srOnly\} \/>/)
  assert.match(read(`${DIR}/demos/useTimeline.ts`), /prefers-reduced-motion: reduce/)
  assert.match(read(`${DIR}/demos/useTimeline.ts`), /document\.hidden/)
  assert.match(read(`${DIR}/landing.module.css`), /@media \(prefers-reduced-motion: reduce\)/)
  const lazy = read(`${DIR}/demos/LazyDemo.tsx`)
  assert.match(lazy, /import\('\.\/StoryPlayer'\)/)
  assert.match(lazy, /IntersectionObserver/)
  // Players are never imported statically by server sections.
  for (const f of ['Hero', 'Agent']) assert.doesNotMatch(read(`${DIR}/sections/${f}.tsx`), /from '\.\.\/demos\/(Story|Agent)Player'/)
})

test('LCP headline is static text and opts out of the phone heading override', () => {
  const hero = read(`${DIR}/sections/Hero.tsx`)
  assert.match(hero, /<h1 id="lv2-hero-title" className=\{`landing-hero /)
  assert.doesNotMatch(read(`${DIR}/landing.module.css`).split('.heroTitle {')[1].split('}')[0], /animation|opacity: 0/)
  for (const f of ['Agent', 'Ops', 'Story', 'Closing']) {
    const src = read(`${DIR}/sections/${f}.tsx`)
    for (const h2 of src.match(/<h2 [^>]*>/g) ?? []) if (!/srOnly/.test(h2)) assert.match(h2, /landing-h2/, `${f}: ${h2}`)
  }
})

test('tabs follow the WAI pattern with 44px targets', () => {
  const niche = read(`${DIR}/islands/NicheTabs.tsx`)
  assert.match(niche, /role="tablist"/)
  assert.match(niche, /aria-selected=\{i === active\}/)
  assert.match(niche, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/)
  assert.match(read(`${DIR}/landing.module.css`), /\.tab \{\n  flex: none;\n  min-height: 44px;/)
})

test('copy is honest: coming-soon is labeled, no dates, store badges, logos, partnerships or invented social proof', () => {
  const content = read(`${DIR}/content.ts`)
  assert.match(content, /label: 'Próximamente'/)
  assert.match(read(`${DIR}/sections/Story.tsx`), /<span className=\{s\.soonBadge\}>Próximamente<\/span>/)
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /App Store|Google Play|Disponible en|2026|2027|testimon|clientes felices|\+\d+ negocios|cientos de negocios/i)
  // Rafael 2026-10-23: Claude, ChatGPT and Grok now; Dots and Muse only as "más adelante".
  assert.match(content, /compatibles con MCP, como Claude, ChatGPT o Grok\. Más adelante, también Dots y Muse\./)
  assert.equal((content.match(/\bDots\b/g) ?? []).length, 1)
  assert.doesNotMatch(content, /integrad[oa] con (Claude|ChatGPT|Grok)|alianza|partner/i)
  // Example data in UI mocks is labeled.
  assert.match(read(`${DIR}/sections/Ops.tsx`), /Datos de ejemplo/)
})

test('CTAs: sign-up, agent request and support', () => {
  const content = read(`${DIR}/content.ts`)
  assert.match(content, /signup: '\/auth\/signin\?signup=true'/)
  assert.match(content, /agent: '\/soporte\?tema=agente'/)
  assert.match(content, /support: '\/soporte'/)
})

test('no emoji as UI chrome (chips, status bars, meta): icons instead; no background grid texture', () => {
  const ui = files.filter((f) => f.endsWith('.tsx') || f.endsWith('content.ts')).map((f) => read(f)).join('\n')
  assert.doesNotMatch(ui, /[✦📦💳👤↻🚚✓⏳]/u)
  assert.match(read(`${DIR}/ui/Chip.tsx`), /from 'lucide-react'/)
  assert.doesNotMatch(read(`${DIR}/sections/Hero.tsx`), /s\.grid\b/)
  assert.doesNotMatch(read(`${DIR}/landing.module.css`), /\n\.grid \{/)
})

test('one spacing system and brand slots for Lane I (logo + avatar)', () => {
  const css = read(`${DIR}/landing.module.css`)
  assert.match(css, /--section-y: 96px;/)
  assert.match(css, /\.section \{\n  padding: var\(--section-y\) 0;/)
  const brand = read(`${DIR}/brand.tsx`)
  assert.match(brand, /export function Logo/)
  assert.match(brand, /export function Mark/)
  // Handoff: never the hero over product UI — the hero has no mark; the demo's status bar has exactly one.
  assert.doesNotMatch(read(`${DIR}/sections/Hero.tsx`), /<Mark\b/)
  assert.equal((read(`${DIR}/demos/StoryStage.tsx`).match(/<Mark\b/g) ?? []).length, 1)
  assert.match(read(`${DIR}/demos/StoryStage.tsx`), /if \(step === 3\) return 'yes'/)
  // Logo / mark only come from brand.tsx (the swap point for Lane I's BetsyMark / BetsyLogo).
  for (const f of files.filter((x) => x.endsWith('.tsx') && !x.endsWith('brand.tsx'))) {
    assert.doesNotMatch(read(f), /className=\{s\.logo\}>\s*Betsy/, f)
  }
})

test('agent costumes: mark on a colored plate + name; the mark itself is never recolored; one mark in the view', () => {
  const c = read(`${DIR}/islands/AgentCostumes.tsx`)
  // Lane I's official costume: AgentMark with a named plate; swatches never render a mark.
  assert.match(c, /<AgentMark appearance=\{\{ plate, ring: false \}\}/)
  assert.equal((c.match(/<AgentMark\b|<Mark\b|<BetsyMark\b/g) ?? []).length, 1)
  assert.match(c, /AGENT_PLATES\.map/)
  assert.match(c, /role="radiogroup"/)
  assert.match(c, /maxLength=\{16\}/)
  assert.match(read(`${DIR}/sections/Agent.tsx`), /<AgentCostumes \/>/)
  assert.doesNotMatch(read(`${DIR}/sections/Agent.tsx`), /→/)
})

test('examples never use live client agent personas (Sofi, Vale, Laura, Andrés, Dani, Caro)', () => {
  assert.doesNotMatch(source, /\b(Sofi|Vale|Laura|Andrés|Dani|Caro)\b/)
})

test("brand slots render Lane I's official BetsyLogo / BetsyMark", () => {
  const b = read(`${DIR}/brand.tsx`)
  assert.match(b, /from '@\/components\/brand\/BetsyLogo'/)
  assert.match(b, /from '@\/components\/brand\/BetsyMark'/)
  assert.doesNotMatch(b, /Sparkles|placeholder/i)
})
