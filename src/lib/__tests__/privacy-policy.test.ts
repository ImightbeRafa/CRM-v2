import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLICY_VERSION, SUBPROCESSORS } from '@/lib/legal/privacy-content'
import { AI_TERMS_LINKS } from '@/lib/soft-ai/ai-terms'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('privacy policy (v8) matches the product', () => {
  const en = read('src/app/privacy/page.tsx')
  const es = read('src/app/privacy/es/page.tsx')

  it('no longer claims customer data is never shared with third parties (AI providers are disclosed)', () => {
    assert.doesNotMatch(en, /We do NOT share, sell, or transfer your Instagram/)
    assert.match(en, /SUBPROCESSORS\.map/)
    assert.match(es, /SUBPROCESSORS\.map/)
    const names = SUBPROCESSORS.map((p) => p.name).join(' ')
    for (const n of ['OpenAI', 'xAI', 'Meta', 'Cloudflare', 'Supabase', 'Railway']) assert.match(names, new RegExp(n))
  })

  it('states the commitments: no sale, no training with customer data, no sharing beyond providers, own-data testing', () => {
    assert.match(en, /We do not sell personal data/)
    assert.match(en, /do not use customer data to train or improve AI models/)
    assert.match(en, /never with\s+real customer conversations/)
    assert.match(es, /No vendemos datos personales/)
    assert.match(es, /No usamos datos de clientes para entrenar ni mejorar modelos de inteligencia artificial/)
    assert.match(es, /nunca con conversaciones reales de clientes/)
  })

  it('describes the opt-in as off-by-default, per business, revocable, versioned', () => {
    assert.match(en, /off until the business owner or an administrator accepts the AI terms/)
    assert.match(en, /can be revoked at any time/)
    assert.match(es, /permanecen apagados hasta que el propietario o un administrador/)
    assert.match(es, /puede revocarse en cualquier momento/)
  })

  it('names the standards and the Costa Rican rights/authority; versioned with a fixed date (not "today")', () => {
    assert.match(en, /Law 8968/)
    assert.match(en, /PRODHAB/)
    assert.match(es, /Ley N\.º 8968/)
    assert.match(es, /PRODHAB/)
    assert.doesNotMatch(en + es, /new Date\(\)\.toLocale/)
    assert.match(POLICY_VERSION, /^\d+\.\d+$/)
  })

  it('English and Spanish pages link to each other and the opt-in card links to the Spanish page that exists', () => {
    assert.match(en, /href="\/privacy\/es"/)
    assert.match(es, /href="\/privacy"/)
    assert.equal(AI_TERMS_LINKS.privacy, '/privacy/es')
  })

  it('the terms add an AI clause and no longer treat "using the Service" as consent to everything', () => {
    const terms = read('src/app/terms/page.tsx')
    assert.match(terms, /12A\. AI Features/)
    assert.doesNotMatch(terms, /By using the Service, you consent to our collection and use of your information/)
  })

  it('no brand, account id or phone is hard-coded in the legal pages', () => {
    assert.doesNotMatch(en + es + read('src/lib/legal/privacy-content.ts'), /Forge|cmuahn5y90001l504y6kksiek|\+506/)
  })
})
