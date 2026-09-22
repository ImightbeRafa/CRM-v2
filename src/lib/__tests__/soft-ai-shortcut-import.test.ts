/**
 * AL2-A1 paste-import: fixtures → facts, confirmation reject, missing-fact chips.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_BRAND_FACTS, parseBrandFacts } from '../soft-ai/brand-facts'
import {
  MISSING_FACT_CHIP_HINT,
  STARTER_SHORTCUT_TEMPLATES,
  previewStarterChip,
} from '../soft-ai/shortcuts'
import {
  extractShortcutImport,
  hashImportPayload,
  planShortcutImportApply,
  proposalFromPaste,
  signProposalToken,
  type ImportFactDecision,
  type ImportShortcutDecision,
} from '../soft-ai/shortcut-import'

const PATCHHOUSE_DUMP = `
Tienda: PatchHouse
Sitio: https://www.patchhouse.cr/
Horario: Lunes a sábado de 9am a 7pm. Domingos cerrado.
Dirección de retiro: San Pedro, 200 m norte de la iglesia
Indicaciones de retiro: Casa esquina color verde, portón negro
Envío GAM: ₡3.000
Fuera del GAM: ₡4.500
Retiro: Retirá en tienda cuando gustes, en horario
SINPE: 70339763
Titular: Rafael García
Banco: BAC
IBAN: CR05010200001234567890
Instrucciones de pago: Enviá el comprobante y una persona lo revisa

## Cómo comprar
Para comprar: elegís el producto, te confirmamos precio y envío, y pagás por SINPE. ¿Envío o retiro?

## Precio y envío
El precio sale del inventario. El envío dentro del GAM es ₡3.000 y fuera del GAM ₡4.500. ¿Cuál producto te interesa?

## Garantía y cambios
Cambios dentro de 7 días con el producto sin uso. No cubrimos daños por mal uso ni piezas faltantes.

## Pago ya listo
Listo, recibimos tu pago. Ya quedó confirmado.
`.trim()

const SECRET = 'test-import-secret'
const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
}

function factValue(path: string, facts: { path: string; value: string }[]) {
  return facts.find((row) => row.path === path)?.value
}

describe('shortcut import', () => {
  it('maps a CR shortcut dump to brand facts and named playbooks', () => {
    assert.ok(PATCHHOUSE_DUMP.length >= 800)
    const proposal = proposalFromPaste(PATCHHOUSE_DUMP, 4)
    assert.equal(factValue('storeName', proposal.facts), 'PatchHouse')
    assert.equal(factValue('hoursText', proposal.facts), 'Lunes a sábado de 9am a 7pm. Domingos cerrado.')
    assert.equal(factValue('payment.sinpe.number', proposal.facts), '70339763')
    assert.equal(factValue('payment.sinpe.holderName', proposal.facts), 'Rafael García')
    assert.equal(factValue('shipping.ea.gamCost', proposal.facts), '3000')
    assert.equal(factValue('shipping.ea.outsideGamCost', proposal.facts), '4500')
    assert.match(factValue('shipping.ra.text', proposal.facts) || '', /Retirá en tienda/)
    const safe = proposal.shortcuts.filter((row) => row.validation.ok)
    assert.ok(safe.length >= 3)
    assert.ok(safe.some((row) => /comprar/i.test(row.title)))
    assert.ok(proposal.facts.every((row) => row.confidence === 'high' || row.confidence === 'medium'))
  })

  it('keeps payment-confirmation playbooks as red rows that cannot be saved', async () => {
    const fromDump = proposalFromPaste(PATCHHOUSE_DUMP, 1)
    const rejected = fromDump.shortcuts.find((row) => /pago ya listo/i.test(row.title))
    assert.ok(rejected)
    assert.equal(rejected.validation.ok, false)
    if (!rejected.validation.ok) assert.equal(rejected.validation.code, 'confirmation_wording')

    let calls = 0
    const proposal = await extractShortcutImport(
      { paste: 'Tienda: Bloom\nHorario: 9 a 6', agentVersion: 2 },
      {
        complete: async () => {
          calls += 1
          return {
            text: JSON.stringify({
              storeName: 'Bloom',
              playbooks: [{ title: 'Recibo', body: 'Listo, recibimos tu pago hoy.' }],
            }),
            usage: { ...ZERO_USAGE, inputTokens: 12, outputTokens: 8 },
          }
        },
      },
    )
    assert.equal(calls, 1)
    assert.equal(proposal.source, 'llm+heuristic')
    const row = proposal.shortcuts.find((item) => item.title === 'Recibo')
    assert.ok(row)
    assert.equal(row.validation.ok, false)
  })

  it('does not call the model when the paste is over 8k or the test cap is spent', async () => {
    let calls = 0
    const complete = async () => {
      calls += 1
      return { text: '{}', usage: ZERO_USAGE }
    }
    await assert.rejects(
      () => extractShortcutImport({ paste: 'a'.repeat(8001), agentVersion: 1 }, { complete }),
      /paste_too_long/,
    )
    await assert.rejects(
      () =>
        extractShortcutImport(
          { paste: 'Tienda: DeepClean', agentVersion: 1 },
          { complete, testTokensUsed: 100, testDailyTokenCap: 100 },
        ),
      /TEST_BUDGET_BLOCKED/,
    )
    assert.equal(calls, 0)
  })

  it('charges usage even when the model JSON is unusable', async () => {
    let charged = 0
    const proposal = await extractShortcutImport(
      { paste: 'Tienda: DeepClean\nHorario: 8 a 5', agentVersion: 1 },
      {
        complete: async () => ({ text: 'no es json', usage: { ...ZERO_USAGE, inputTokens: 4, outputTokens: 1 } }),
        persistUsage: async (usage) => {
          charged += usage.inputTokens + usage.outputTokens
        },
      },
    )
    assert.equal(charged, 5)
    assert.equal(proposal.source, 'heuristic')
    assert.equal(factValue('storeName', proposal.facts), 'DeepClean')
  })

  it('applies only included rows once, then the same payload is a no-op', () => {
    const proposal = proposalFromPaste(PATCHHOUSE_DUMP, 7)
    const token = signProposalToken(proposal, { tenantId: 'tenant-1', agentId: 'agent-1' }, SECRET, 1_000)
    const facts: ImportFactDecision[] = proposal.facts.map((row) => ({
      id: row.id,
      decision: row.path === 'hoursText' ? 'exclude' : 'include',
      value: row.value,
    }))
    const shortcuts: ImportShortcutDecision[] = proposal.shortcuts.map((row) => ({
      id: row.id,
      decision: row.validation.ok && /comprar/i.test(row.title) ? 'include' : 'exclude',
      title: row.title,
      body: row.body,
      isActive: true,
    }))
    const current = parseBrandFacts({
      schemaVersion: 1,
      hoursText: 'horario viejo',
      storeName: 'Vieja',
    })
    const plan = planShortcutImportApply({
      token,
      secret: SECRET,
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      currentFacts: current,
      request: { facts, shortcuts },
      existingPayloadHash: null,
      now: 1_000,
    })
    assert.equal(plan.action, 'apply')
    if (plan.action !== 'apply') return
    assert.equal(plan.facts.storeName, 'PatchHouse')
    assert.equal(plan.facts.hoursText, 'horario viejo')
    assert.equal(plan.facts.shipping?.ea?.gamCost, 3000)
    assert.equal(plan.facts.shipping?.ea?.outsideGamCost, 4500)
    assert.equal(plan.facts.payment?.sinpe?.number, '70339763')
    assert.equal(plan.facts.payment?.sinpe?.holderName, 'Rafael García')
    assert.equal(plan.shortcuts.length, 1)
    assert.doesNotMatch(plan.shortcuts[0].body, /\{\{/)
    assert.equal(plan.factPaths.includes('hoursText'), false)

    const again = planShortcutImportApply({
      token,
      secret: SECRET,
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      currentFacts: plan.facts,
      request: { facts, shortcuts },
      existingPayloadHash: plan.payloadHash,
      now: 1_000,
    })
    assert.equal(again.action, 'noop')

    const changedFacts = facts.map((row) =>
      row.id === 'fact:storeName' ? { ...row, value: 'Otra tienda' } : row,
    )
    const conflict = planShortcutImportApply({
      token,
      secret: SECRET,
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      currentFacts: plan.facts,
      request: { facts: changedFacts, shortcuts },
      existingPayloadHash: hashImportPayload({ facts, shortcuts }),
      now: 1_000,
    })
    assert.equal(conflict.action, 'conflict')
  })

  it('refuses to include a confirmation playbook', () => {
    const proposal = proposalFromPaste(PATCHHOUSE_DUMP, 1)
    const token = signProposalToken(proposal, { tenantId: 't', agentId: 'a' }, SECRET, 5)
    const bad = proposal.shortcuts.find((row) => !row.validation.ok)
    assert.ok(bad)
    const plan = planShortcutImportApply({
      token,
      secret: SECRET,
      tenantId: 't',
      agentId: 'a',
      currentFacts: EMPTY_BRAND_FACTS,
      request: {
        facts: [],
        shortcuts: [
          { id: bad.id, decision: 'include', title: bad.title, body: bad.body, isActive: true },
        ],
      },
      existingPayloadHash: null,
      now: 5,
    })
    assert.equal(plan.action, 'reject')
    if (plan.action === 'reject') assert.equal(plan.code, 'confirmation_wording')
  })

  it('disables starter chips until the brand fact exists', () => {
    const payment = STARTER_SHORTCUT_TEMPLATES.find((row) => row.key === 'formas_de_pago')
    const hours = STARTER_SHORTCUT_TEMPLATES.find((row) => row.key === 'horario')
    assert.ok(payment && hours)
    const missing = previewStarterChip(payment, EMPTY_BRAND_FACTS)
    assert.equal(missing.disabled, true)
    assert.equal(missing.hint, MISSING_FACT_CHIP_HINT)
    assert.deepEqual(missing.missing, ['brand.payment.summary'])
    const ready = previewStarterChip(
      payment,
      parseBrandFacts({
        schemaVersion: 1,
        payment: {
          shareWithCustomers: true,
          methods: ['sinpe'],
          sinpe: { number: '70339763', holderName: 'Rafael García' },
        },
      }),
    )
    assert.equal(ready.disabled, false)
    assert.equal(ready.hint, null)
    assert.match(ready.body, /SINPE 70339763 a nombre de Rafael García/)
    assert.doesNotMatch(ready.body, /\{\{/)
    const noHours = previewStarterChip(hours, EMPTY_BRAND_FACTS)
    assert.equal(noHours.disabled, true)
    assert.equal(noHours.hint, MISSING_FACT_CHIP_HINT)
  })

  it('stays off the staff bot and does not write config from extract', () => {
    const lib = readFileSync(join(process.cwd(), 'src/lib/soft-ai/shortcut-import.ts'), 'utf8')
    const server = readFileSync(join(process.cwd(), 'src/lib/soft-ai/shortcut-import-server.ts'), 'utf8')
    const extractRoute = readFileSync(
      join(process.cwd(), 'src/app/api/chat/agents/[id]/import/extract/route.ts'),
      'utf8',
    )
    for (const src of [lib, server, extractRoute]) {
      assert.doesNotMatch(src, /customer-paste-grok/)
      assert.doesNotMatch(src, /from ['"]@\/lib\/bot\//)
      assert.doesNotMatch(src, /from ['"]@\/app\/api\/bot\//)
    }
    assert.match(server, /softAiResponsesCreate/)
    assert.match(server, /mode: 'test'/)
    assert.match(server, /testDailyTokenCap/)
    assert.doesNotMatch(extractRoute, /chatAgent\.update/)
    assert.match(server, /version: \{ increment: 1 \}/)
    assert.match(server, /chat_agent_shortcut_import:/)
  })
})
