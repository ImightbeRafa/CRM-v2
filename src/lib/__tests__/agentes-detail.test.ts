import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { cardState, relativeUpdated, sourceStatus, sourceTopic } from '../../components/aurora/agentes/knowledge-format'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const AGENTES_DIR = 'src/components/aurora/agentes'
const agentFiles = () => readdirSync(join(process.cwd(), AGENTES_DIR)).map((f) => `${AGENTES_DIR}/${f}`)
const page = read('src/app/config/agentes/page.tsx')

describe('agent detail page (source)', () => {
  it('keeps the locked strings and drives the URL through the shared helpers', () => {
    assert.match(page, /Detener agente/)
    assert.match(page, /Cambios recientes/)
    assert.match(page, /buildAgentHref/)
    assert.match(page, /resolveAgentParam/)
    assert.match(page, /normalizeSeccion/)
  })
  it('never writes the URL while the (keep-alive) panel is hidden', () => {
    assert.match(page, /const isActivePanel = deepLink\.tabParam === 'agentes'/)
    assert.match(page, /if \(isActivePanel\) router\.replace\(href/)
    const applyEffect = page.slice(page.indexOf('// URL → state'))
    assert.match(applyEffect, /if \(!isActivePanel\) \{\s*appliedDeepLink\.current = null\s*return/)
  })
  it('no full-panel wizard, no "todos los WhatsApp", no publish endpoint', () => {
    assert.doesNotMatch(page, /knowledgePanel/)
    assert.doesNotMatch(page, /todos los WhatsApp/i)
    assert.doesNotMatch(page, /\/api\/chat\/agents\/[^'"`]*publish/)
  })
  it('Publicar cambios only flushes: it never PATCHes status', () => {
    const start = page.indexOf('async function publishChanges()')
    const end = page.indexOf('function startDraft()')
    assert.ok(start > 0 && end > start)
    const body = page.slice(start, end)
    assert.doesNotMatch(body, /status:/)
    assert.doesNotMatch(body, /method: 'PATCH'|method: 'POST'/)
    assert.doesNotMatch(body, /patch\(/)
  })
  it('Crear agente uses the existing POST and lands on the new agent', () => {
    assert.match(page, /fetch\('\/api\/chat\/agents', \{\s*method: 'POST'/)
    assert.match(page, /buildAgentHref\(\{ agente: newId, seccion: 'resumen' \}\)/)
    assert.match(page, /DRAFT_ENABLED_TABS/)
  })
  it('detail header exposes Probar + Publicar cambios and the tab bar labels Líneas', () => {
    const header = read(`${AGENTES_DIR}/AgentDetailHeader.tsx`)
    assert.match(header, />\s*Probar\s*</)
    assert.match(header, /Publicar cambios/)
    assert.match(read(`${AGENTES_DIR}/agent-url.ts`), /label: 'Líneas'/)
    assert.match(read(`${AGENTES_DIR}/AgentTabBar.tsx`), /overflow-x-auto/)
  })
  it('mobile drill-in has a back arrow', () => {
    assert.match(read(`${AGENTES_DIR}/AgentDetailHeader.tsx`), /md:hidden/)
    assert.match(read(`${AGENTES_DIR}/AgentDetailHeader.tsx`), /ArrowLeft/)
  })
  it('runtime stays off: no auto-reply enabling path added to the page', () => {
    assert.doesNotMatch(page, /status: 'live'/)
    assert.doesNotMatch(page, /operationMode: 'ai_full'/)
  })
})

describe('ConocimientoWizard integration', () => {
  const wizard = read('src/app/config/agentes/conocimiento/ConocimientoWizard.tsx')
  it('back goes to the Conocimiento tab URL', () => {
    assert.match(wizard, /router\.push\('\/config\?tab=agentes&seccion=conocimiento'\)/)
  })
  it('binds approved sources to the agent it is opened for', () => {
    assert.match(wizard, /agentId: agentIdProp/)
    assert.match(wizard, /const agentId = agentIdProp \?\? firstAgentId/)
  })
  it('tab reuses the inline wizard instead of a separate page', () => {
    const tab = read(`${AGENTES_DIR}/AgentKnowledgeTab.tsx`)
    assert.match(tab, /ConocimientoWizardInner/)
    assert.match(tab, /variant="inline"/)
    assert.match(tab, /agentId=\{agentId\}/)
    assert.match(read('src/app/config/agentes/conocimiento/page.tsx'), /ConocimientoWizardInner/)
  })
})

describe('breadcrumb trail', () => {
  it('ConfigShell exposes the trail and only feeds it to the agentes panel', () => {
    const shell = read('src/components/aurora/config/ConfigShell.tsx')
    assert.match(shell, /export function useConfigTrail/)
    assert.match(shell, /trail=\{activeTab === 'agentes' \? trail : \[\]\}/)
    assert.match(read('src/components/aurora/config/ConfigTopbar.tsx'), /trail/)
  })
  it('the main sidebar has no Conocimiento item and Agentes opens the tab', () => {
    const nav = read('src/components/aurora/aurora-nav.ts')
    assert.doesNotMatch(nav, /Conocimiento/)
    assert.match(nav, /href: '\/config\?tab=agentes'/)
  })
})

describe('agent UI copy hygiene', () => {
  it('no Forge, Soft, pilot ids or Telegram in the new agent components', () => {
    for (const f of agentFiles()) {
      const src = read(f)
      assert.doesNotMatch(src, /Forge|Soft|Telegram|cmuahn5y90001l504y6kksiek|cmhsibjue0004js04gie724nx/, f)
    }
  })
  it('no "Forge" or pilot ids in the agentes page tree', () => {
    for (const f of ['src/app/config/agentes/page.tsx', 'src/app/config/agentes/conocimiento/ConocimientoWizard.tsx']) {
      assert.doesNotMatch(read(f), /Forge|cmuahn5y90001l504y6kksiek|cmhsibjue0004js04gie724nx/, f)
    }
  })
})

describe('knowledge-format', () => {
  it('card state follows real counts, never a percentage', () => {
    assert.equal(cardState({ id: 'envios', title: 'Envíos', statusLabel: '2 aprobados', hint: '', approvedCount: 2 }), 'approved')
    assert.equal(cardState({ id: 'ofertas', title: 'Ofertas', statusLabel: '1 borrador', hint: '', draftCount: 1 }), 'draft')
    assert.equal(cardState({ id: 'precios', title: 'Precios', statusLabel: 'Usar inventario en vivo', hint: '' }), 'inventory')
    assert.equal(cardState({ id: 'politicas', title: 'Políticas', statusLabel: 'Sin fuentes', hint: '' }), 'empty')
  })
  it('source status and topic', () => {
    assert.equal(sourceStatus('approved').label, 'Aprobada')
    assert.equal(sourceStatus('draft').label, 'Borrador')
    assert.equal(sourceStatus('whatever').label, 'Archivada')
    assert.equal(sourceTopic('Envíos zona GAM', 'policy'), 'Envíos')
    assert.equal(sourceTopic('Guía de marca', 'brand_book'), 'Brand Book')
  })
  it('relative updated is safe', () => {
    const now = new Date('2026-09-26T18:00:00Z')
    assert.equal(relativeUpdated('2026-09-26T17:56:00Z', now), 'hace 4 min')
    assert.equal(relativeUpdated('2026-09-26T17:59:50Z', now), 'ahora')
    assert.equal(relativeUpdated('2026-09-26T15:00:00Z', now), 'hace 3 h')
    assert.equal(relativeUpdated('garbage', now), '—')
    assert.equal(relativeUpdated(null, now), '—')
  })
})
