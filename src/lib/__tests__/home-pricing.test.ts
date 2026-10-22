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
  formatUsdCents,
  ivaCents,
  planPriceBreakdown,
  planPriceLabels,
} from '../pricing/plan'

// Run from the repo root (npm scripts do).
const read = (rel: string) => fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n')

test('plan price: $20 + 13% IVA = $22.60, in integer cents', () => {
  assert.equal(BETSY_PLAN.baseUsdCents, 2000)
  assert.equal(IVA_BPS, 1300)
  assert.deepEqual(planPriceBreakdown(), { baseCents: 2000, ivaCents: 260, totalCents: 2260, ivaPercent: 13 })
  const l = planPriceLabels()
  assert.equal(l.base, '$20')
  assert.equal(l.iva, '$2.60')
  assert.equal(l.total, '$22.60')
  assert.equal(l.short, '$20/mes + IVA')
  assert.equal(l.math, '$20 + IVA (13%) = $22.60 al mes')
})

test('IVA rounds half-up to the cent and never goes negative', () => {
  assert.equal(ivaCents(1), 0)
  assert.equal(ivaCents(4), 1) // 0.52 → 1
  assert.equal(ivaCents(1150), 150) // 149.5 → 150
  assert.equal(ivaCents(-500), 0)
  assert.equal(formatUsdCents(1130), '$11.30')
  assert.equal(formatUsdCents(100000), '$1,000')
})

test('the subscription charge stays the legacy CRC 10,000 (Rafael decides any change)', () => {
  assert.equal(LEGACY_SUBSCRIPTION_CRC, 10_000)
  assert.match(read('src/app/api/tilopay/create-plan-repeat/route.ts'), /pro: \{ name: 'Pro', amount: 10000, currency: 'CRC' \}/)
})

test('landing, docs and BillingDashboard read the price from the one source', () => {
  const landing = ['src/app/home/page.tsx', 'src/app/home/components/LandingPage.tsx', 'src/app/home/content.ts']
    .map(read)
    .join('\n')
  assert.doesNotMatch(landing, /\$\s?20\b/, 'no hand-typed $20 on the landing')
  assert.match(read('src/app/home/components/LandingPage.tsx'), /planPriceLabels\(\)/)
  const billing = read('src/app/config/components/BillingDashboard.tsx')
  assert.doesNotMatch(billing, /\$20/)
  assert.match(billing, /from '@\/lib\/pricing\/plan'/)
  assert.doesNotMatch(billing, /basic: 10000|pro: 10000/)
  const docs = read('src/content/docs/billing.mdx')
  assert.doesNotMatch(docs, /\$20/)
  assert.match(docs, /<PlanPrice/)
  assert.match(read('src/app/components/DocRenderer.tsx'), /PlanPrice,/)
})

test('landing is honest: no fake testimonials, no raw payment link, real contact info, agent CTA', () => {
  const page = read('src/app/home/components/LandingPage.tsx')
  const content = read('src/app/home/content.ts')
  const all = page + content
  assert.doesNotMatch(all, /testimonials = |Boutique Luna|aumentaron 40%|rating: 5/i)
  assert.doesNotMatch(all, /tp\.cr\/l\//, 'subscribe happens in Facturación, not from a raw link on the landing')
  assert.doesNotMatch(all, /wa\.me\/50661498470|betsycrm\.cr@gmail\.com/, 'old contact details')
  assert.match(page, /getSupportContactConfig\(\)/)
  assert.match(page, /\/soporte\?tema=agente/)
  assert.match(all, /OpenAI/)
  assert.match(all, /WhatsApp/)
  assert.match(all, /Instagram/)
  assert.match(all, /Correos de Costa Rica/)
  assert.match(all, /contra entrega/i)
  // The landing is a server component; only the islands run on the client.
  assert.doesNotMatch(page, /^'use client'/)
  assert.match(read('src/app/home/components/LandingIslands.tsx'), /^'use client'/)
  assert.match(read('src/app/home/page.tsx'), /export const metadata/)
})

test('/soporte?tema=agente starts the contact form as an agent lead', () => {
  assert.match(read('src/app/soporte/page.tsx'), /tema === 'agente' \? 'agent' : null/)
  assert.match(read('src/app/soporte/SoporteClient.tsx'), /topic === 'agent' \? AGENT_LEAD\.subject : ''/)
})
