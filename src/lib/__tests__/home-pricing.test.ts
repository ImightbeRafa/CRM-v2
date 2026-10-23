/**
 * Lane H part 1: one plan price source (src/lib/pricing/plan.ts) and an honest landing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  BETSY_PLAN,
  IVA_BPS,
  LEGACY_SUBSCRIPTION_CRC,
  formatColones,
  formatUsdCents,
  ivaCents,
  planPriceLabels,
} from '../pricing/plan'

// Run from the repo root (npm scripts do).
const read = (rel: string) => fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n')

test('plan price: ₡10.000/mes with IVA included, what Tilopay charges (Rafael 2026-10-23)', () => {
  assert.equal(BETSY_PLAN.currency, 'CRC')
  assert.equal(BETSY_PLAN.amountColones, 10_000)
  assert.equal(IVA_BPS, 1300)
  assert.equal(BETSY_PLAN.ivaIncluded, true)
  const l = planPriceLabels()
  assert.equal(l.base, '₡10.000')
  assert.equal(l.short, '₡10.000/mes (IVA incluido)')
  assert.equal(l.math, '₡10.000 al mes, IVA incluido')
  assert.equal(l.ivaNote, 'IVA incluido')
  assert.equal(l.iva, null)
  // The flag still supports the other states:
  const unknown = planPriceLabels({ amountColones: 10_000, ivaIncluded: null })
  assert.equal(unknown.short, '₡10.000/mes')
  const plus = planPriceLabels({ amountColones: 10_000, ivaIncluded: false })
  assert.equal(plus.short, '₡10.000/mes + IVA')
  assert.equal(plus.iva, '₡1.300')
  assert.equal(plus.math, '₡10.000 + IVA (13%) = ₡11.300 al mes')
  assert.equal(formatColones(1234567), '₡1.234.567')
})

test('IVA rounds half-up to the cent and never goes negative', () => {
  assert.equal(ivaCents(1), 0)
  assert.equal(ivaCents(4), 1) // 0.52 → 1
  assert.equal(ivaCents(1150), 150) // 149.5 → 150
  assert.equal(ivaCents(-500), 0)
  assert.equal(formatUsdCents(1130), '$11.30')
  assert.equal(formatUsdCents(100000), '$1,000')
})

test('the shown price equals what the Tilopay subscription charges (CRC 10000)', () => {
  assert.equal(LEGACY_SUBSCRIPTION_CRC, BETSY_PLAN.amountColones)
  assert.match(read('src/app/api/tilopay/create-plan-repeat/route.ts'), /pro: \{ name: 'Pro', amount: 10000, currency: 'CRC' \}/)
})

test('landing, docs and BillingDashboard read the price from the one source', () => {
  // The redesign at /home-preview (src/components/landing-v2); its own tests live in home-v2.test.ts.
  const landing = ['src/app/home-preview/page.tsx', 'src/components/landing-v2/LandingV2.tsx', 'src/components/landing-v2/content.ts']
    .map(read)
    .join('\n')
  assert.doesNotMatch(landing, /\$\s?20\b|₡\s?10[.,]000/, 'no hand-typed price on the landing')
  assert.match(read('src/components/landing-v2/LandingV2.tsx'), /planPriceLabels\(\)/)
  const billing = read('src/app/config/components/BillingDashboard.tsx')
  assert.doesNotMatch(billing, /\$20|₡10[.,]000/)
  assert.doesNotMatch(read('src/app/home/components/SimplePricingSection.tsx'), /"\$20"|₡10[.,]000/)
  assert.match(read('src/app/home/components/SimplePricingSection.tsx'), /planPriceLabels\(\)/)
  assert.match(billing, /from '@\/lib\/pricing\/plan'/)
  assert.doesNotMatch(billing, /basic: 10000|pro: 10000/)
  for (const file of fs.readdirSync('src/content/docs')) {
    assert.doesNotMatch(read(`src/content/docs/${file}`), /\$\s?20\b/, `${file}: use <PlanPrice /> instead of a typed price`)
  }
  assert.match(read('src/content/docs/billing.mdx'), /<PlanPrice show="math" \/>/)
})

test('docs expand <PlanPrice/> to text on load (rendered page and support-agent search see the real price)', async () => {
  const { expandDocPlaceholders, getDocBySlug } = await import('../docs')
  assert.equal(expandDocPlaceholders('Pro (<PlanPrice />)'), 'Pro (₡10.000/mes (IVA incluido))')
  assert.equal(expandDocPlaceholders('**<PlanPrice show="math" />**'), '**₡10.000 al mes, IVA incluido**')
  assert.equal(expandDocPlaceholders('<PlanPrice show="total"/>'), '₡10.000')
  assert.equal(expandDocPlaceholders('<PlanPrice show="iva"/>'), '')
  const billing = getDocBySlug('billing')
  assert.ok(billing && !billing.content.includes('<PlanPrice') && billing.content.includes('₡10.000 al mes, IVA incluido'))
})

test('plan copy never promises unlimited users (PRO is capped at 25 in plan-enforcement)', () => {
  assert.match(read('src/lib/plan-enforcement.ts'), /PRO: 25/)
  const copy = read('src/app/home/components/SimplePricingSection.tsx') + read('src/app/config/components/BillingDashboard.tsx') + read('src/components/landing-v2/content.ts') + read('src/content/docs/billing.mdx') + read('src/content/docs/managing-team.mdx') + read('src/content/docs/faq.mdx')
  assert.doesNotMatch(copy, /usuarios ilimitados|Usuarios y pedidos ilimitados|\| Ilimitados \|\n?.*Usuarios|costos por usuario/i)
})

test('landing is honest: no fake testimonials, no raw payment link, real contact info, agent CTA', () => {
  const page = read('src/components/landing-v2/LandingV2.tsx')
  const content = read('src/components/landing-v2/content.ts')
  const all = page + content
  assert.doesNotMatch(all, /testimonials = |Boutique Luna|aumentaron 40%|rating: 5/i)
  assert.doesNotMatch(all, /tp\.cr\/l\//, 'subscribe happens in Facturación, not from a raw link on the landing')
  assert.doesNotMatch(all, /wa\.me\/50661498470|betsycrm\.cr@gmail\.com/, 'old contact details')
  assert.match(page, /getSupportContactConfig\(\)/)
  // public agent CTAs go to the app (Agentes tab): agents are for existing Betsy users only
  assert.match(content, /agent: '\/config\/agentes'/)
  assert.match(all, /OpenAI/)
  assert.match(all, /WhatsApp/)
  assert.match(all, /Instagram/)
  assert.match(all, /Correos de Costa Rica/)
  assert.match(all, /contra entrega/i)
  // The landing is a server component; only the islands run on the client.
  assert.doesNotMatch(page, /^'use client'/)
  assert.match(read('src/components/landing-v2/islands/Nav.tsx'), /^'use client'/)
  assert.match(read('src/app/home-preview/page.tsx'), /export const metadata/)
})

test('/soporte?tema=agente starts the contact form as an agent lead', () => {
  assert.match(read('src/app/soporte/page.tsx'), /tema === 'agente' \? 'agent' : null/)
  assert.match(read('src/app/soporte/SoporteClient.tsx'), /topic === 'agent' \? AGENT_LEAD\.subject : ''/)
})
