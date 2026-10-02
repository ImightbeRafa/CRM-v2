import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('per-agent inventory map', () => {
  it('search_inventory only sees mapped products when a map exists, and tenant is always applied', () => {
    const src = read('src/lib/soft-ai/llm/tool-runner.ts')
    const search = src.slice(src.indexOf('async function runSearchInventory'))
    assert.match(search, /tenantId: ctx\.tenantId/)
    assert.match(search, /ctx\.inventoryItemIds && ctx\.inventoryItemIds\.length > 0/)
    assert.match(search, /id: \{ in: ctx\.inventoryItemIds \}/)
    assert.match(src, /inventoryItemIds\?: string\[\] \| null/)
  })

  it('both the live turn and Probar load the map for the agent', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(turn, /inventoryItemIds: await loadMappedInventoryIds\(row\.tenantId, resolved\.agent\.id\)/)
    assert.match(turn, /inventoryItemIds: await loadMappedInventoryIds\(input\.tenantId, runtimeAgent\.id\)/)
  })

  it('the RESULTING state is checked (live + search on + no list), whatever path gets there', () => {
    const src = read('src/lib/soft-ai/agent-admin.ts')
    assert.match(src, /nextStatus === 'live'/)
    assert.match(src, /nextTools\.includes\('search_inventory'\)/)
    assert.match(src, /!wasLiveWithSearch/)
    assert.match(src, /\(await agentHasInventoryMap\(input\.tenantId, existing\.id\)\) === false/)
    assert.match(src, /INVENTORY_MAP_REQUIRED/)
    assert.match(src, /status: 409/)
    // null (table not applied yet) must NOT block: the gate compares to === false, not falsy.
    assert.doesNotMatch(src, /!\(await agentHasInventoryMap/)
  })

  it('storing a map checks every item belongs to the session tenant and caps the size', () => {
    const src = read('src/lib/soft-ai/agent-inventory-map.ts')
    assert.match(src, /inventoryItem\.findMany\(\{\s*where: \{ tenantId: input\.tenantId, id: \{ in: wanted \} \}/)
    assert.match(src, /MAX_MAPPED_ITEMS = 200/)
    assert.match(src, /"tenantId" = \$\{tenantId\} AND "agentId" = \$\{agentId\}/)
  })

  it('route: agent must belong to the session tenant; write needs update_config; audited', () => {
    const src = read('src/app/api/chat/agents/[id]/inventory/route.ts')
    assert.match(src, /where: \{ id, tenantId \}/)
    assert.match(src, /'update_config'/)
    assert.match(src, /'view_config'/)
    assert.match(src, /logAuditEvent/)
  })

  it('SQL 046 is additive, FK-free, RLS-enabled, unique per agent+item and registered', () => {
    const sql = read('supabase/migrations/046_chat_agent_inventory_map.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgentInventoryItem"/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /UNIQUE \("agentId", "inventoryItemId"\)/)
    assert.doesNotMatch(sql, /REFERENCES|DROP |TRUNCATE/i)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'046': '046_chat_agent_inventory_map\.sql'/)
  })
})

describe('product list edge cases (review fixes)', () => {
  it('a live agent with the search on cannot be left with an empty list', () => {
    const src = read('src/app/api/chat/agents/[id]/inventory/route.ts')
    assert.match(src, /requireNonEmpty = agent\.status === 'live'/)
    assert.match(src, /status: 409/)
  })
  it('saves are serialized per agent and use one insert', () => {
    const src = read('src/lib/soft-ai/agent-inventory-map.ts')
    assert.match(src, /pg_advisory_xact_lock/)
    assert.match(src, /unnest\(\$\{ids\}::text\[\]\)/)
  })
})
