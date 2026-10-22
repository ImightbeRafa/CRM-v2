import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  FILES as ADDITIVE_SQL_FILES,
  DEFAULT_APPLY_FILES,
  EXPECTED_COLUMNS,
  EXPECTED_TABLES,
} from '../../../scripts/lib/betsy-v2-additive-manifest.mjs'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

/** Route → the guard its source must call (auth matrix by construction). */
const GUARDS: Record<string, RegExp> = {
  'src/app/api/support/contact/route.ts': /handleContactIntake\(/,
  'src/app/api/contact/route.ts': /handleContactIntake\(/,
  'src/app/api/support/contact-config/route.ts': /getSupportContactConfig\(/,
  'src/app/api/support/tickets/route.ts': /supportViewer\(request\)/,
  'src/app/api/support/tickets/[id]/route.ts': /supportViewer\(request\)/,
  'src/app/api/support/agent-request/route.ts': /supportViewer\(request\)/,
  'src/app/api/support/events/route.ts': /bearerMatches\([\s\S]*isSuperAdminRequest\(request\)/,
  'src/app/api/mcp/route.ts': /checkMcpBearer\(request\.headers\.get\('authorization'\), process\.env\.SUPPORT_MCP_TOKEN\)/,
  'src/app/api/cron/support-dispatch/route.ts': /requireCronBearer\(request\)/,
  'src/app/api/agents/access/route.ts': /authenticateAPI\(request/,
  'src/app/api/super-admin/custom-agents/route.ts': /requireSuperAdmin\(request\)/,
  'src/app/api/super-admin/tenants/[tenantId]/custom-agents/route.ts': /requireSuperAdmin\(request, \{ write: true \}\)/,
  'src/app/api/super-admin/support/tickets/route.ts': /requireSuperAdmin\(request\)/,
  'src/app/api/super-admin/support/tickets/[id]/route.ts': /requireSuperAdmin\(request, \{ write: true \}\)/,
}

test('every support route calls its guard before doing anything', () => {
  for (const [file, guard] of Object.entries(GUARDS)) assert.match(read(file), guard, file)
})

test('session routes take tenant/user from the session, never from the body', () => {
  for (const file of [
    'src/app/api/support/tickets/route.ts',
    'src/app/api/support/tickets/[id]/route.ts',
    'src/app/api/support/agent-request/route.ts',
  ]) {
    const src = read(file)
    assert.match(src, /tenantId: auth\.viewer\.tenantId|addCustomerReply\(auth\.viewer|getTicketForViewer\(auth\.viewer|listTicketsForViewer\(auth\.viewer/, file)
    assert.doesNotMatch(src, /\b(body|parsed\.data|d)\.(tenantId|userId)\b/, file)
  }
  // Billing-restricted businesses must still reach support.
  assert.match(read('src/lib/support/session.ts'), /authenticateAPI\(request, \{ skipBillingGuard: true \}\)/)
})

test('foreign ticket ids answer 404, never 403', () => {
  const src = read('src/app/api/support/tickets/[id]/route.ts')
  assert.match(src, /status: 404/)
  assert.doesNotMatch(src, /status: 403/)
})

test('single write path: only src/lib/support creates SupportTicket rows and outbox events', () => {
  const offenders = walk('src')
    .filter((f) => !f.startsWith('src/lib/support/') && !f.includes('__tests__'))
    .filter((f) => /supportTicket\.create|supportTicketEvent\.create|"SupportTicket"/.test(read(f)))
  assert.deepEqual(offenders, [])
  const tickets = read('src/lib/support/tickets.ts')
  const create = tickets.slice(tickets.indexOf('export async function createSupportTicket'))
  assert.match(create, /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*tx\.supportTicket\.create[\s\S]*tx\.supportTicketMessage\.create[\s\S]*tx\.supportTicketEvent\.create/)
})

test('routes never fetch the webhook inline; only the dispatcher posts to it', () => {
  for (const f of walk('src/app')) assert.doesNotMatch(read(f), /SUPPORT_AGENT_WEBHOOK_URL/, f)
})

test('contact intake order: validate → rate limit → Turnstile → spam → ticket/legacy', () => {
  const src = read('src/lib/support/contact-intake.ts')
  const order = ['contactSchema.safeParse', 'ipLimiter(', 'emailLimiter(', 'verifyTurnstile(', 'checkSpam(', 'createSupportTicket(']
  let last = -1
  for (const step of order) {
    const i = src.indexOf(step, last + 1)
    assert.ok(i > last, `${step} out of order`)
    last = i
  }
  assert.match(src, /if \(!supportPipelineEnabled\(\)\) return legacy\(\)/)
  assert.match(src, /SupportTablesMissingError\) return legacy\(\)/)
})

test('public routes are listed in middleware; nothing broader', () => {
  const mw = read('src/middleware.ts')
  for (const r of ['/soporte', '/api/support/contact', '/api/support/contact-config', '/api/support/events', '/api/mcp']) {
    assert.ok(mw.includes(`'${r}',`), r)
  }
  assert.ok(!mw.includes("'/api/support',"), 'session support routes stay behind middleware auth')
  assert.ok(!mw.includes("'/api/agents"), '/api/agents/access needs a session')
})

test('agent editor APIs are gated by custom_agents (inbox-side feedback / AI terms stay open)', () => {
  const routes = [...walk('src/app/api/chat/agents'), ...walk('src/app/api/chat/knowledge')].filter((f) => f.endsWith('route.ts'))
  assert.ok(routes.length > 25)
  for (const f of routes) {
    const src = read(f)
    if (f.includes('/agents/feedback/') || f.includes('/agents/ai-terms/')) {
      assert.doesNotMatch(src, /authenticateAgentAPI/, f)
      continue
    }
    assert.match(src, /authenticateAgentAPI\(|studioGuard\(/, f)
    assert.doesNotMatch(src, /authenticateAPIWithPermission/, f)
  }
  assert.match(read('src/lib/agent-studio/route-guard.ts'), /authenticateAgentAPI\(request/)
  // The runtime (inbox replies) is never gated by this flag.
  assert.doesNotMatch(read('src/lib/soft-ai/automation-processor.ts'), /custom_agents|CUSTOM_AGENTS_FLAG/)
})

test('custom_agents is never preview-unlocked and only super admin writes it', () => {
  const flags = read('src/lib/feature-flags.ts')
  const preview = flags.slice(flags.indexOf('const PREVIEW_UNLOCKED_KEYS'), flags.indexOf(']);', flags.indexOf('const PREVIEW_UNLOCKED_KEYS')))
  assert.doesNotMatch(preview, /CUSTOM_AGENTS_FLAG|custom_agents/)
  const writers = walk('src')
    .filter((f) => !f.includes('__tests__'))
    .filter((f) => /tenantFeatureFlag\.(upsert|create|update)/.test(read(f)) && /CUSTOM_AGENTS_FLAG/.test(read(f)))
  assert.deepEqual(writers, ['src/app/api/super-admin/tenants/[tenantId]/custom-agents/route.ts'])
  const route = read('src/app/api/super-admin/tenants/[tenantId]/custom-agents/route.ts')
  assert.match(route, /\$transaction[\s\S]*tenantFeatureFlag\.upsert[\s\S]*auditLog\.create/)
})

test('Agents tab: the editor is wrapped by the gate; redirects unchanged', () => {
  assert.match(read('src/app/config/ConfigPageClient.tsx'), /<CustomAgentGate>\s*<AgentesPanelPage \/>\s*<\/CustomAgentGate>/)
  const redirects = read('src/components/aurora/config/config-redirects.mjs')
  assert.match(redirects, /'\/agentes'/)
})

test('Worker forwards every SUPPORT_* env and runs the dispatcher on the 5-minute cron', () => {
  const w = read('src/cf-container-worker.ts')
  for (const key of [
    'SUPPORT_PIPELINE_ENABLED',
    'SUPPORT_AGENT_EMAIL',
    'SUPPORT_ESCALATION_EMAIL',
    'SUPPORT_FROM_EMAIL',
    'SUPPORT_PUBLIC_EMAILS',
    'SUPPORT_WHATSAPP',
    'SUPPORT_INSTAGRAM',
    'SUPPORT_HOURS',
    'SUPPORT_AGENT_WEBHOOK_URL',
    'SUPPORT_WEBHOOK_SECRET',
    'SUPPORT_WEBHOOK_EVENTS',
    'SUPPORT_AGENT_DRAFT_CATEGORIES',
    'SUPPORT_MCP_TOKEN',
    'SUPPORT_PUBLIC_BASE_URL',
  ]) {
    assert.ok(w.includes(`  "${key}",`), `${key} forwarded`)
    assert.ok(w.includes(`  ${key}?: string;`), `${key} typed`)
  }
  assert.match(w, /"\*\/5 \* \* \* \*": \[[^\]]*"\/api\/cron\/support-dispatch"/)
})

test('SQL 059 is registered, gated and additive with RLS on every table', () => {
  assert.equal((ADDITIVE_SQL_FILES as Record<string, string>)['059'], '059_support_pipeline.sql')
  assert.ok(!DEFAULT_APPLY_FILES.split(',').includes('059'))
  assert.deepEqual((EXPECTED_TABLES as Record<string, string[]>)['059'], ['SupportTicket', 'SupportTicketMessage', 'SupportTicketEvent', 'SupportMcpAudit'])
  assert.ok((EXPECTED_COLUMNS as Record<string, unknown[]>)['059'].length >= 4)
  const sql = read('supabase/migrations/059_support_pipeline.sql')
  assert.match(sql, /HUMAN APPROVAL REQUIRED/)
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bDROP\b|\bTRUNCATE\b|ALTER TABLE public\."(Tenant|User)"/i)
  for (const t of ['SupportTicket', 'SupportTicketMessage', 'SupportTicketEvent', 'SupportMcpAudit']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\."${t}" ENABLE ROW LEVEL SECURITY`), t)
  }
  // Prisma models carry no relations (they blow up the tenant client's types).
  const schema = read('prisma/schema.prisma')
  const block = schema.slice(schema.indexOf('model SupportTicket {'), schema.indexOf('model ChangelogEntry {'))
  assert.doesNotMatch(block, /@relation|SupportTicketMessage\[\]|SupportTicketEvent\[\]/)
})

test('/soporte renders contact info from config and never hardcodes addresses', () => {
  const page = read('src/app/soporte/page.tsx')
  assert.match(page, /getSupportContactConfig\(\)/)
  for (const f of [...walk('src/app/soporte'), ...walk('src/components/aurora/agentes').filter((p) => /Sales|CustomAgentGate/.test(p))]) {
    assert.doesNotMatch(read(f), /hola@betsycrm\.com|50662470831|betsycrm\.cr@gmail\.com/, f)
  }
})
