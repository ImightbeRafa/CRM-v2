import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clampCatalogLimit,
  formatCatalogSnippet,
  formatColones,
  parseCatalogQuery,
  stockPhrase,
} from '@/lib/chat-catalog'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const item = { id: 'i1', name: 'Kit Parche', sku: 'KP', category: null, sellingPrice: 27000, currentStock: 10, minStock: 2 }

describe('catalog snippet', () => {
  it('formats colones with space thousands and no cents', () => {
    assert.equal(formatColones(27000), '₡27 000')
    assert.equal(formatColones(1234567.6), '₡1 234 568')
    assert.equal(formatColones(NaN), '₡0')
  })
  it('adds stock wording only when low or out', () => {
    assert.equal(stockPhrase(item), null)
    assert.equal(stockPhrase({ currentStock: 2, minStock: 2 }), 'Pocas unidades')
    assert.equal(stockPhrase({ currentStock: 0, minStock: 2 }), 'Agotado por ahora')
    assert.equal(formatCatalogSnippet(item), 'Kit Parche — ₡27 000')
    assert.equal(formatCatalogSnippet({ ...item, currentStock: 0 }), 'Kit Parche — ₡27 000 (Agotado por ahora)')
  })
  it('clamps query and limit', () => {
    assert.equal(parseCatalogQuery('  hola  '), 'hola')
    assert.equal(parseCatalogQuery('x'.repeat(200)).length, 60)
    assert.equal(clampCatalogLimit(undefined), 15)
    assert.equal(clampCatalogLimit('500'), 25)
  })
})

describe('catalog route (static)', () => {
  const route = read('src/app/api/chat/catalog/route.ts')
  it('is tenant-scoped, active items only, and never selects cost or supplier', () => {
    assert.match(route, /tenantId: auth\.tenantId/)
    assert.match(route, /isActive: true/)
    assert.doesNotMatch(route, /unitCost|supplier|location/)
  })
  it('the picker inserts text and sends nothing', () => {
    const picker = read('src/components/chats/composer/CatalogPicker.tsx')
    assert.doesNotMatch(picker, /send-media|\/api\/chat\/send|method: 'POST'/)
    assert.match(read('src/components/chats/SoftThreadPane.tsx'), /insertAtCaret\(snippet\)/)
  })
})
