import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('F1 · order ownership is one shared rule', () => {
  const own = read('src/lib/soft-ai/order-ownership.ts')

  it('orders a human linked to this chat count as owned (tenant + conversation scoped)', () => {
    assert.match(own, /export async function linkedOrderIds/)
    assert.match(own, /chatMessage\.findMany\(\{\s*where: \{ tenantId, conversationId, orderId: \{ not: null \} \}/)
    assert.match(own, /if \(links\.has\(order\.id\)\) return true/)
  })

  it('phone ownership keeps the last-8-digit rule and the verified-client check', () => {
    assert.match(own, /phoneOwnershipMatch\(hints/)
    assert.match(own, /client\.findFirst\(\{\s*where: \{ id: ctx\.clientId, tenantId: ctx\.tenantId \}/)
  })

  it('soft-deleted orders stay hidden: ownership reads go through the activeOrderReads client', () => {
    assert.match(own, /import \{ prisma \} from '@\/lib\/db'/)
    assert.match(read('src/lib/db.ts'), /name: 'activeOrderReads'/)
  })

  it('guías are found by order NUMBER and failed attempts are skipped', () => {
    const guia = own.slice(own.indexOf('export async function latestGuiaForOrderNumber'))
    assert.match(guia, /orderId: orderNumber/)
    assert.match(guia, /status: \{ not: 'failed' \}/)
    assert.match(guia, /OR: \[\{ guiaNumber: \{ not: null \} \}, \{ trackingNumber: \{ not: null \} \}\]/)
    // writers really store the number
    assert.match(read('src/lib/bot/guia-service.ts'), /shippingGuia[\s\S]{0,400}orderId: order\.orderId/)
  })
})

describe('F1 · "¿dónde viene mi pedido?" (layer tool)', () => {
  const src = read('src/lib/soft-ai/llm/tool-runner.ts')
  const shipping = src.slice(src.indexOf('async function runGetShippingStatus'), src.indexOf('async function runEscalate'))

  it('uses the shared ownership rule and the order-number guía lookup', () => {
    assert.match(src, /from '@\/lib\/soft-ai\/order-ownership'/)
    assert.match(shipping, /latestGuiaForOrderNumber\(ctx\.tenantId, order\.orderId\)/)
    assert.doesNotMatch(shipping, /orderId: order\.id\b/)
  })

  it('a guía-only lookup still needs ownership (no probing other customers’ guías)', () => {
    assert.match(shipping, /where: \{ orderId: row\.orderId, tenantId: ctx\.tenantId \}/)
    assert.match(shipping, /!guiaOrder \|\| !\(await isOrderOwned\(ownershipCtx\(ctx\), guiaOrder\)\)/)
  })

  it('live Correos tracking is best-effort and time-capped', () => {
    assert.match(src, /async function correosTrackingEvents/)
    assert.match(src, /resolveCorreosWSCredentials/)
    assert.match(src, /setTimeout\(\(\) => resolve\(null\), 5000\)/)
    assert.match(src, /\^\[A-Za-z0-9-\]\{4,30\}\$/)
    assert.match(shipping, /lastEvents: tracking\?\.lastEvents \?\? \[\]/)
  })
})

describe('F1 · legacy v1 deps no longer leak other customers’ orders', () => {
  const deps = read('src/lib/soft-ai/server-deps.ts')

  it('customer turns are scoped to the chat peer; only the staff route may look up any order', () => {
    assert.match(deps, /\| \{ tenantId: string; peerId: string; conversationId\?: string \| null \}/)
    assert.match(deps, /\| \{ tenantId: string; staff: true \}/)
    assert.match(deps, /if \(owner && !\(await isOrderOwned\(owner, row\)\)\) return null/)
    assert.match(deps, /const owned = await findOwnedOrder\(owner, orderNumberHint\)/)
    assert.match(deps, /latestGuiaForOrderNumber\(tenantId, order\.orderId\)/)
  })

  it('the inbound hook passes the peer; the staff run route (update_sales) passes staff', () => {
    assert.match(read('src/lib/soft-ai/inbound-hook.ts'), /buildSoftAiServerDeps\(\{\s*tenantId: args\.tenantId,\s*peerId: args\.senderId,/)
    const run = read('src/app/api/chat/soft-ai/run/route.ts')
    assert.match(run, /buildSoftAiServerDeps\(\{ tenantId, staff: true \}\)/)
    assert.match(run, /update_sales/)
  })
})

describe('F1 · isolation between businesses of one tenant (SQL 049)', () => {
  const settings = read('src/lib/soft-ai/agent-settings.ts')
  const own = read('src/lib/soft-ai/order-ownership.ts')
  const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
  const resolver = read('src/lib/soft-ai/agent-resolver.ts')

  it('settings are fail-safe: missing table or row = safe defaults', () => {
    assert.match(settings, /if \(!\(await isTableReady\(TABLE\)\)\) return DEFAULT_AGENT_SETTINGS/)
    assert.match(settings, /servesUnboundChannels: false,\n\}/)
    assert.match(settings, /WHERE "tenantId" = \$\{tenantId\} AND "agentId" = \$\{agentId\}/)
  })

  it('a phone match only counts for orders stamped with this agent’s business; empty stamp never matches', () => {
    assert.match(own, /if \(ctx\.ownership && !orderMatchesOwnership\(ctx\.ownership, order\)\) return false/)
    assert.match(settings, /typeof v === 'string' && v\.trim\(\) !== ''/)
    const runner = read('src/lib/soft-ai/llm/tool-runner.ts')
    assert.match(runner, /ownership: ctx\.orderOwnership \?\? \{ salesChannels: \[\], funnels: \[\], sources: \[\] \}/)
    assert.match(read('src/lib/soft-ai/agent-turn.ts'), /orderOwnership: \(await loadAgentSettings\(row\.tenantId, resolved\.agent\.id\)\)\.orderOwnership/)
  })

  it('tenant_default answers unbound channels only when explicitly enabled (resolver and pre-send gate)', () => {
    assert.match(resolver, /if \(tenantDefault && \(await agentsServingUnboundChannels\(tenantId\)\)\.has\(tenantDefault\.agentId\)\)/)
    assert.match(gates, /if \(binding\.scope === 'tenant_default'\)/)
    assert.match(gates, /exact\.agentId === input\.agentId/)
  })

  it('per-agent daily budget is checked before the model and again before sending', () => {
    assert.match(gates, /loadDailyBilledTokens\(tenantId: string, agentId\?: string\)/)
    assert.equal((gates.match(/await agentBudgetExceeded\(input\.tenantId, input\.agentId\)/g) || []).length, 2)
    assert.match(read('src/lib/soft-ai/agent-turn.ts'), /runPreModelGates\(\{\s*tenantId: row\.tenantId,\s*socialAccountId: row\.socialAccountId,\s*agentId: resolved\.agent\.id,/)
  })

  it('SQL 049 is additive, RLS on, registered, and widens (never narrows) the notification kinds', () => {
    const sql = read('supabase/migrations/049_chat_agent_settings.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgentSettings"/)
    assert.match(sql, /ALTER TABLE public\."ChatAgentSettings" ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /'mention', 'task_assigned', 'task_due', 'chat_assigned',\s*'ai_no_reply', 'payment_review', 'order_review', 'ai_budget'/)
    assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /DROP TABLE|TRUNCATE|DELETE FROM|REFERENCES/i)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'049': '049_chat_agent_settings\.sql'/)
  })
})

describe('F1 · agents answer directly; silence alerts a person; Instagram supported', () => {
  const outcome = read('src/lib/soft-ai/agent-turn-outcome.ts')
  const turn = read('src/lib/soft-ai/agent-turn.ts')
  const gates = read('src/lib/soft-ai/agent-claim-gates.ts')

  it('no suggestion mode: not activated / legacy ai_suggest = silent (not_activated)', () => {
    assert.match(outcome, /case 'suggest':\s*\/\/[^\n]*\n\s*return \{ outcome: 'skip', reason: 'not_activated' \}/)
    assert.doesNotMatch(outcome, /reason: 'ai_suggest'/)
    assert.doesNotMatch(outcome, /outcome: 'suggest', reason: 'ai_full_not_unlocked'/)
  })

  it('a silent turn alerts the assignee (or the chat team) once per chat per 30 min, in plain words', () => {
    const alert = read('src/lib/soft-ai/ai-no-reply.ts')
    assert.match(alert, /const BUCKET_MS = 30 \* 60_000/)
    assert.match(alert, /if \(!AI_NO_REPLY_ALERT_REASONS\.has\(reason\)\) return/)
    assert.match(alert, /filterChatMembers\(input\.tenantId, userIds\)/)
    assert.match(turn, /void notifyAiNoReply\(\{ tenantId: input\.row\.tenantId, conversationId: input\.row\.conversationId, reason: turn\?\.skipReason \}\)/)
    const notes = read('src/lib/workspace-notifications.ts')
    assert.match(notes, /'ai_no_reply'/)
    assert.match(notes, /title: `La IA no respondió\$\{where\}`/)
    // expected silences never alert
    for (const quiet of ['human_replied', 'paused_before_send', 'human_before_send', 'superseded', 'kill_switch']) {
      assert.doesNotMatch(notes.slice(notes.indexOf('AI_NO_REPLY_REASONS'), notes.indexOf('const ID_RE')), new RegExp(`\b${quiet}:`))
    }
  })

  it('Instagram: the agent sends a RESPONSE (never HUMAN_AGENT) and only inside 24h', () => {
    assert.match(turn, /if \(opts\.platform === 'instagram'\) \{/)
    assert.match(turn, /messaging_type: 'RESPONSE'/)
    assert.doesNotMatch(turn, /HUMAN_AGENT'/)
    assert.match(gates, /export function agentWindowOpen\(/)
    assert.match(gates, /if \(!agentWindowOpen\(input\.platform, input\.lastInboundAt\)\) \{/)
  })
})

describe('F1 · legacy v1 path quarantined, neutral defaults', () => {
  it('v1 never creates, links or "registers" an order (no fake LINK- references)', () => {
    const tools = read('src/lib/soft-ai/tools.ts')
    assert.match(tools, /refused: 'quarantined_v1_write'/)
    assert.doesNotMatch(tools, /Registré la referencia/)
    assert.doesNotMatch(tools, /`LINK-\$\{hint\}`/)
  })
  it('the default Soft AI config carries no business-specific facts', () => {
    const types = read('src/lib/soft-ai/types.ts')
    const block = types.slice(types.indexOf('export const DEFAULT_SOFT_AI_CONFIG'), types.indexOf('export const DEFAULT_SOFT_AI_CONFIG') + 700)
    assert.doesNotMatch(block, /Kits|Betsy|1–2h/)
  })
})
