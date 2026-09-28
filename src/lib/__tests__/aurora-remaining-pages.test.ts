import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

test('classic pages render inside Aurora with their permission gates unchanged', () => {
  const cases: Array<[string, RegExp]> = [
    ['src/app/exports/page.tsx', /requirePermission\('view_sales'\)/],
    ['src/app/backups/page.tsx', /requirePermission\('view_config'\)/],
    ['src/app/ventas/dashboard/page.tsx', /requirePermission\('view_sales'\)/],
    ['src/app/super-admin/page.tsx', /isSuperAdmin/],
  ]
  for (const [file, gate] of cases) {
    const src = read(file)
    assert.match(src, /<AuroraClassicPage/, file)
    assert.match(src, gate, `${file} keeps its gate`)
    assert.doesNotMatch(src, /min-h-screen/, file)
  }
  assert.match(read('src/components/aurora/AuroraClassicPage.tsx'), /aurora-light/)
})

test('Producción uses AuroraShell, AppShell has no importers left', () => {
  assert.match(read('src/app/produccion/components/productionpageClient.tsx'), /<AuroraShell fullBleed/)
  assert.doesNotMatch(read('src/app/produccion/components/productionpageClient.tsx'), /AppShell/)
})

test('accept-invite uses AuthShell with labelled fields and the same invite flow', () => {
  const src = read('src/app/auth/accept-invite/page.tsx')
  assert.match(src, /<AuthShell/)
  assert.match(src, /htmlFor="invite-email"/)
  assert.match(src, /htmlFor="invite-password"/)
  assert.match(src, /signIn\('google', \{ callbackUrl: `\/auth\/accept-invite\?token=\$\{encodeURIComponent\(token\)\}` \}\)/)
  assert.match(src, /onSubmit=\{onCredentials\}/)
})
