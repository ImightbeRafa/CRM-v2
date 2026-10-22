/**
 * Real-chat scrubber (export-chats + exam-bank, DATA-65). Pure; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/chat-export-scrub.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DATA_BLOCK, nameWords, scrubChatText } from '../../../scripts/agent-pack/chat-scrub'
import { crDayEnd, crDayStart, senderOf } from '../../../scripts/agent-pack/export-chats'
import { redactCustomerText } from '../../../scripts/agent-pack/exam-bank'

describe('scrubChatText', () => {
  it('removes greeted names, known names and @handles', () => {
    const names = nameWords('María José Pérez', 'majo.perez_22')
    const t = scrubChatText('Hola María José! Gracias Andrea, te escribe @majo.perez_22', { names })
    assert.doesNotMatch(t, /María|José|Andrea|majo/u)
    assert.match(t, /\[nombre\]/)
    assert.match(t, /\[usuario\]/)
  })

  it('keeps greetings with no name, brands and places', () => {
    assert.equal(scrubChatText('Hola Buenas tardes, gracias Forge'), 'Hola Buenas tardes, gracias Forge')
    assert.equal(scrubChatText('Buenas, envían a San José?'), 'Buenas, envían a San José?')
  })

  it('removes links, phones, emails and tracking numbers but keeps prices', () => {
    const t = scrubChatText(
      'Mi IG instagram.com/ana.cr y https://wa.me/50688887777 · tel 8888-7777 · ana@mail.com · guía RR123456789CR · rastreo PY123456AB · son ₡14 900 + ₡3 000',
    )
    assert.doesNotMatch(t, /ana|8888|7777|RR123456789CR|PY123456AB/u)
    assert.match(t, /\[enlace\]/)
    assert.match(t, /\[correo\]/)
    assert.match(t, /\[guía\]/)
    assert.match(t, /₡14 900 \+ ₡3 000/)
  })

  it('collapses a shipping-data block', () => {
    assert.equal(scrubChatText('Nombre: Ana Solís\nTeléfono 8888 7777\nDirección: Cartago, 200 m norte de la iglesia'), DATA_BLOCK)
  })

  it('collapses a forwarded order and a name/phone/province block (names no rule can catch)', () => {
    assert.equal(scrubChatText('Laura Quesada\n\n#ORD-1791 · 29-sept\n📞 8888 7777\n📍 Alajuela, Alajuela\nPack completo'), DATA_BLOCK)
    assert.equal(scrubChatText('Mucho gusto.\nLaura Quesada Marín\n8888-7777\nAlajuela, Alajuela, San Rafael\nana@mail.com'), DATA_BLOCK)
    assert.notEqual(scrubChatText('Hola\n¿Envían a Alajuela?\nGracias'), DATA_BLOCK)
  })

  it('"soy de Cartago" is not a name; "soy Ana" is', () => {
    assert.match(scrubChatText('soy de Cartago'), /soy de Cartago/)
    assert.doesNotMatch(scrubChatText('hola soy Ana Rojas'), /Ana|Rojas/)
  })
})

describe('exam-bank uses the same extras (DATA-65)', () => {
  it('greeted names and links are gone from exam items', () => {
    const t = redactCustomerText('Gracias Carlos! mi perfil instagram.com/carlos.cr', null)
    assert.doesNotMatch(t, /Carlos|carlos/u)
  })
})

describe('reviewer input (exam / shadow)', () => {
  it("keeps the agent's data list readable and only collapses the customer's data line", async () => {
    const { redactChatForReviewer } = await import('../../../scripts/agent-pack/exam-bank')
    const ask = 'Pasame estos datos: - Nombre completo - Teléfono - Provincia - Cantón'
    assert.equal(redactCustomerText(ask, null, { store: true }), ask)
    const chat = redactChatForReviewer(`CLIENTE: peso 81 kg\nAGENTE: ${ask}\nCLIENTE: Nombre: Ana Solís\nTeléfono 8888 7777\nCLIENTE: mido 1.77`)
    assert.match(chat, /peso 81 kg/)
    assert.match(chat, /AGENTE: Pasame estos datos/)
    assert.match(chat, /mido 1\.77/)
    assert.doesNotMatch(chat, /Ana Solís|8888 7777/)
    assert.match(chat, /CLIENTE: María Pérez Solís/) // the synthetic block, on that message only
  })
})

describe('build-agent blocks what the engine would silently drop', () => {
  it('a sales-rules field over its cap and knowledge over the prompt budget', async () => {
    const { packLimitProblems } = await import('../../../scripts/agent-pack/build-agent')
    const { parseSalesRules } = await import('@/lib/soft-ai/agent-sales-setup')
    const salesRules = { voice: 'v', objections: 'x'.repeat(1300) }
    const knowledge = [
      { kind: 'brand_book' as const, name: 'a', body: 'y'.repeat(2500) },
      { kind: 'policy' as const, name: 'b', body: 'z'.repeat(1600) },
      { kind: 'faq' as const, name: 'c', body: 'q'.repeat(100) },
    ]
    const problems = packLimitProblems({ salesRules, knowledge }, parseSalesRules(salesRules))
    assert.equal(problems.length, 2)
    assert.match(problems[0], /objections: 1300 caracteres, el motor solo guarda 1200/)
    assert.match(problems[1], /producto \+ políticas: 4100 de 4000/)
    const ok = { voice: 'v', objections: 'x'.repeat(1200) }
    assert.deepEqual(packLimitProblems({ salesRules: ok, knowledge: knowledge.slice(0, 1) }, parseSalesRules(ok)), [])
  })
})

describe('export-chats helpers', () => {
  it('Costa Rica day window', () => {
    assert.equal(crDayStart('2026-10-21').toISOString(), '2026-10-21T06:00:00.000Z')
    assert.equal(crDayEnd('2026-10-22').toISOString(), '2026-10-23T06:00:00.000Z')
  })
  it('who sent it', () => {
    assert.equal(senderOf('inbound', null, null), 'customer')
    assert.equal(senderOf('outbound', { softAi: true, agentId: 'a' }, null), 'agent')
    assert.equal(senderOf('outbound', { senderName: 'X', senderUserId: 'u' }, null), 'teammate')
    assert.equal(senderOf('outbound', { isEcho: true }, null), 'teammate')
    assert.equal(senderOf('outbound', {}, 'u1'), 'teammate')
    assert.equal(senderOf('outbound', {}, null), 'automation')
  })
})
