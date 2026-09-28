import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const files = [
  'src/app/config/ConfigPageClient.tsx',
  'src/app/config/agentes/page.tsx',
  'src/app/config/social/page.tsx',
  'src/app/components/OrderBulkDeleteDashboard.tsx',
  'src/app/components/SimpleAuditDashboard.tsx',
  ...readdirSync('src/app/config/components').filter((f) => f.endsWith('.tsx')).map((f) => join('src/app/config/components', f)),
]

test('Aurora Config screens use Aurora toasts / confirm dialogs, never window.alert / window.confirm', () => {
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    assert.doesNotMatch(src, /(?<![\w.])(window\.)?(alert|confirm)\(/, file)
  }
})

test('AuroraShell mounts the global confirm host next to the toaster', () => {
  const shell = readFileSync('src/components/aurora/AuroraShell.tsx', 'utf8')
  assert.match(shell, /<AuroraToaster \/>\s*<AuroraConfirmHost \/>/)
})
