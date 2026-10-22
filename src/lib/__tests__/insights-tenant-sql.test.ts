/**
 * Lane E2 tenant isolation (static): raw SQL skips the getTenantPrisma extension, so every table in every
 * raw query of the insight loaders must carry its own `"tenantId" = ${tenantId}`; every new route takes the
 * tenant from the session only; the agent dashboard sits behind the custom_agents gate.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const LOADERS = ['src/lib/insights/insights-server.ts', 'src/lib/insights/customers-server.ts']

const ROUTES = [
  'src/app/api/estadisticas/anuncios/route.ts',
  'src/app/api/estadisticas/equipo/route.ts',
  'src/app/api/estadisticas/clientes/recurrentes/route.ts',
  'src/app/api/estadisticas/clientes/recompra/route.ts',
  'src/app/api/config/reorder-rules/route.ts',
  'src/app/api/chat/agents/performance/route.ts',
]

/** Every tagged SQL template (Prisma.sql`…`, $queryRaw`…`, $executeRaw`…`) in a file. */
function sqlBlocks(source: string): string[] {
  const blocks: string[] = []
  const re = /(?:Prisma\.sql|\$queryRaw(?:<[^`]*?>)?|\$executeRaw)`([\s\S]*?)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) blocks.push(m[1])
  return blocks
}

describe('insights raw SQL is tenant-scoped on every table', () => {
  for (const file of LOADERS) {
    const blocks = sqlBlocks(read(file))
    it(`${file} has raw SQL to check`, () => assert.ok(blocks.length > 0))
    blocks.forEach((sql, i) => {
      it(`${file} query #${i + 1}`, () => {
        // FROM / JOIN public."Table" alias  (or "Tenant" by id for the settings write)
        const tables = [...sql.matchAll(/(?:FROM|JOIN|UPDATE)\s+(?:public\.)?"(\w+)"(?:\s+(?!ON\b|WHERE\b)(\w+))?/g)]
        assert.ok(tables.length > 0, 'no table found')
        for (const [, table, alias] of tables) {
          if (table === 'Tenant') {
            assert.match(sql, /"id" = \$\{tenantId\}/, 'Tenant row must be the session tenant')
            continue
          }
          const ref = alias ? `${alias}\\."tenantId"` : `"tenantId"`
          assert.match(sql, new RegExp(`${ref} = \\$\\{tenantId\\}`), `${table} (${alias ?? 'no alias'}) is not filtered by tenant`)
        }
      })
    })
  }
})

describe('insights routes take the tenant from the session', () => {
  for (const file of ROUTES) {
    it(file, () => {
      const src = read(file)
      assert.match(src, /authenticateAPIWithPermission|authenticateAgentAPI/)
      assert.match(src, /auth\.tenantId/)
      assert.doesNotMatch(src, /get\(['"]tenantId['"]\)|body\.tenantId|tenantId:\s*body/)
    })
  }
  it('agent performance is behind the custom_agents gate', () => {
    const src = read('src/app/api/chat/agents/performance/route.ts')
    assert.match(src, /authenticateAgentAPI\(request, 'view_config'\)/)
    assert.doesNotMatch(src, /authenticateAPIWithPermission/)
  })
  it('customer lists also need view_sales (names and phones)', () => {
    for (const f of ['src/app/api/estadisticas/clientes/recurrentes/route.ts', 'src/app/api/estadisticas/clientes/recompra/route.ts']) {
      assert.match(read(f), /hasPermission\(auth\.role, 'view_sales'\)/)
    }
  })
  it('reorder rules write is update_config and touches only the reorderRules key', () => {
    assert.match(read('src/app/api/config/reorder-rules/route.ts'), /export async function PUT[\s\S]*'update_config'/)
    const server = read('src/lib/insights/customers-server.ts')
    assert.match(server, /FOR UPDATE/)
    assert.match(server, /jsonb_set\([\s\S]*'\{reorderRules\}'/)
  })
  it('cache keys start with the tenant id', () => {
    assert.match(read('src/lib/insights/route-helpers.ts'), /`insights:\$\{tenantId\}:/)
  })
  it('the agent list is filtered to this business’s agents', () => {
    assert.match(read('src/lib/insights/insights-server.ts'), /loadAgentNames\(perf\.map\(\(p\) => p\.agentId\), tenantId\)/)
  })
})
