/**
 * AL2-A1 shortcuts (A1.6, A1.7, A1.20).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STARTER_SHORTCUT_TEMPLATES,
  validateShortcutForSave,
  type RuntimeShortcut,
} from '../soft-ai/shortcuts'
import { parseBrandFacts } from '../soft-ai/brand-facts'
import { applyFinalOutputPolicy } from '../soft-ai/llm/output-validator'
import { runA1Tool } from '../soft-ai/llm/tool-runner'

describe('shortcuts', () => {
  it('A1.6 use_shortcut renders the configured site without a literal URL in product seeds', async () => {
    const template = STARTER_SHORTCUT_TEMPLATES.find((row) => row.key === 'sitio_web')
    assert.ok(template)
    assert.equal(template.body, 'Podés ver todo en {{brand.website}}.')
    assert.doesNotMatch(template.body, /https?:\/\//)
    const shortcut: RuntimeShortcut = { ...template, isActive: true, sortOrder: 1 }
    const facts = parseBrandFacts({
      schemaVersion: 1,
      website: 'https://tienda.example',
    })
    const result = await runA1Tool(
      {
        tenantId: 't',
        conversationId: 'c',
        socialAccountId: 's',
        peerId: 'p',
        enabledTools: ['use_shortcut'],
        shortcuts: [shortcut],
        brandFacts: facts,
        sandbox: true,
      },
      'use_shortcut',
      '{"key":"sitio_web"}',
    )
    assert.equal(result.ok, true)
    assert.match(String(result.result.text), /tienda\.example/)
  })

  it('A1.7 confirmation wording is rejected on save and blocked at render', () => {
    const saved = validateShortcutForSave({
      key: 'pago_ok',
      title: 'Pago',
      kind: 'playbook',
      body: 'tu pago quedó confirmado',
      deliveryMode: 'verbatim',
      intents: ['payment_proof'],
    })
    assert.equal(saved.ok, false)
    if (!saved.ok) assert.equal(saved.code, 'confirmation_wording')
    const admin = readFileSync(join(process.cwd(), 'src/lib/soft-ai/shortcut-admin.ts'), 'utf8')
    assert.match(admin, /if \(code === 'confirmation_wording'\) return \{ status: 422, code \}/)
    const injected: RuntimeShortcut = {
      key: 'pago_ok',
      title: 'Pago',
      kind: 'playbook',
      intents: ['payment_proof'],
      keywords: [],
      body: 'tu pago quedó confirmado',
      deliveryMode: 'verbatim',
      isActive: true,
      sortOrder: 1,
    }
    const policy = applyFinalOutputPolicy({
      text: injected.body,
      intent: 'other',
      brandFacts: parseBrandFacts({ schemaVersion: 1 }),
      shortcuts: [injected],
    })
    assert.equal(policy.needsHuman, true)
    assert.ok(policy.reasons.includes('confirmation_wording'))
  })

  it('A1.20 cross-tenant shortcut lookup is 404 and scoped by tenant', () => {
    const admin = readFileSync(join(process.cwd(), 'src/lib/soft-ai/shortcut-admin.ts'), 'utf8')
    assert.match(admin, /SHORTCUT_NOT_FOUND' \|\| code === 'AGENT_NOT_FOUND'/)
    assert.match(admin, /return \{ status: 404, code \}/)
    assert.match(admin, /tenantId: input\.tenantId, agentId: input\.agentId/)
  })
})
