import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_SECTIONS,
  DRAFT_ENABLED_TABS,
  agentTabLabel,
  buildAgentHref,
  isKnownSeccion,
  normalizeSeccion,
  resolveAgentParam,
  slugifyAgentName,
} from '../../components/aurora/agentes/agent-url'

describe('agent-url seccion', () => {
  it('keeps the 7 live keys in Figma order with Líneas = canales', () => {
    assert.deepEqual(
      AGENT_SECTIONS.map((s) => s.key),
      ['resumen', 'personalidad', 'conocimiento', 'herramientas', 'canales', 'historial', 'seguridad'],
    )
    assert.equal(agentTabLabel('canales'), 'Líneas')
    assert.equal(agentTabLabel('seguridad'), 'Seguridad')
  })
  it('normalizes keys, aliases and junk', () => {
    for (const s of AGENT_SECTIONS) assert.equal(normalizeSeccion(s.key), s.key)
    assert.equal(normalizeSeccion('lineas'), 'canales')
    assert.equal(normalizeSeccion('Líneas'), 'canales')
    assert.equal(normalizeSeccion('CONOCIMIENTO'), 'conocimiento')
    assert.equal(normalizeSeccion('nope'), 'resumen')
    assert.equal(normalizeSeccion(''), 'resumen')
    assert.equal(normalizeSeccion(null), 'resumen')
    assert.equal(normalizeSeccion(undefined), 'resumen')
  })
  it('isKnownSeccion', () => {
    assert.equal(isKnownSeccion('lineas'), true)
    assert.equal(isKnownSeccion('historial'), true)
    assert.equal(isKnownSeccion('x'), false)
    assert.equal(isKnownSeccion(null), false)
  })
  it('draft agents only get Resumen / Personalidad / Líneas', () => {
    assert.deepEqual([...DRAFT_ENABLED_TABS], ['resumen', 'personalidad', 'canales'])
  })
})

describe('agent-url slug', () => {
  it('slugifies names', () => {
    assert.equal(slugifyAgentName('Sofía'), 'sofia')
    assert.equal(slugifyAgentName('Patchy CR!'), 'patchy-cr')
    assert.equal(slugifyAgentName('  --Ñandú  Ventas-- '), 'nandu-ventas')
    assert.equal(slugifyAgentName(''), '')
  })
  const agents = [
    { id: 'a1', name: 'Patchy' },
    { id: 'a2', name: 'Sofía' },
    { id: 'a3', name: 'Luna' },
    { id: 'a4', name: 'luna!' },
  ]
  it('exact id wins', () => {
    assert.deepEqual(resolveAgentParam('a2', agents), { kind: 'id', id: 'a2' })
  })
  it('unique slug resolves to the id', () => {
    assert.deepEqual(resolveAgentParam('sofia', agents), { kind: 'slug', id: 'a2' })
    assert.deepEqual(resolveAgentParam('Patchy', agents), { kind: 'slug', id: 'a1' })
  })
  it('ambiguous / none / empty', () => {
    assert.deepEqual(resolveAgentParam('luna', agents), { kind: 'ambiguous' })
    assert.deepEqual(resolveAgentParam('zzz', agents), { kind: 'none' })
    assert.deepEqual(resolveAgentParam('', agents), { kind: 'none' })
    assert.deepEqual(resolveAgentParam(null, agents), { kind: 'none' })
    assert.deepEqual(resolveAgentParam('!!!', agents), { kind: 'none' })
  })
  it('an id that equals another agent slug still prefers the id', () => {
    assert.deepEqual(resolveAgentParam('luna', [{ id: 'luna', name: 'Otro' }, { id: 'x', name: 'Luna' }]), {
      kind: 'id',
      id: 'luna',
    })
  })
})

describe('agent-url href', () => {
  it('builds the canonical deep link', () => {
    assert.equal(buildAgentHref(), '/config?tab=agentes')
    assert.equal(
      buildAgentHref({ agente: 'abc', seccion: 'conocimiento', card: 'envios' }),
      '/config?tab=agentes&agente=abc&seccion=conocimiento&card=envios',
    )
    assert.ok(buildAgentHref({ agente: 'a b&c' }).startsWith('/config?tab=agentes&agente=a%20b%26c'))
  })
})
