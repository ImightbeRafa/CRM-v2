/** MEDIA-10: guía status / download need Pedidos or Producción; status never loads PDF bytes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('guía status and download: revocation-aware auth + view_sales or view_production', () => {
  for (const f of ['src/app/api/shipping/guias/status/route.ts', 'src/app/api/shipping/guias/download/[id]/route.ts']) {
    const src = read(f)
    assert.match(src, /const auth = await authenticateAPI\(request\);/, f)
    assert.match(src, /!hasPermission\(auth\.role, 'view_sales'\) && !hasPermission\(auth\.role, 'view_production'\)/, f)
    assert.doesNotMatch(src, /getLiveToken/, f)
    assert.match(src, /tenantId: tenantId|tenantId,/, f)
  }
})

test('status list never selects PDF bytes', () => {
  const src = read('src/app/api/shipping/guias/status/route.ts')
  assert.match(src, /omit: \{ pdfData: true \}/)
  assert.match(src, /pdfData: \{ not: null \} \},\n\s*select: \{ id: true \},/)
  assert.doesNotMatch(src, /!!g\.pdfData/)
})
