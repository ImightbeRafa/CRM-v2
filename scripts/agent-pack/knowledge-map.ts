/**
 * Mapa de conocimiento of a pack, offline (no database, no AI tokens): the same standard template and the same rules
 * the app uses — prompt budget (budgetKnowledgeSlice, sources ordered by name like the app at equal priority), the
 * saved-reply catalog as the prompt shows it (guideCatalogRows) — so you see BEFORE building an agent what it will
 * know, what does not fit and what conflicts with its settings.
 *
 *   npx tsx scripts/agent-pack/knowledge-map.ts --pack=<carpeta del pack> [--na=product.ingredients,store.pickup] [--json]
 *
 * Offline limits: prices live in /ventas (they count as present here) and shipping methods live in Config › Métodos de
 * envío (here the pack's brand facts are used, as the app does when a business has no methods).
 * Exit code 1 when something is missing or does not fit.
 */
import { buildKnowledgeMap, type KnowledgeDocInput } from '@/lib/soft-ai/knowledge-map'
import {
  budgetKnowledgeSlice,
  KNOWLEDGE_LAYER2_CHAR_BUDGET,
  KNOWLEDGE_LAYER34_CHAR_BUDGET,
  KNOWLEDGE_TUNING_CHAR_BUDGET,
  type KnowledgeSourceDto,
} from '@/lib/soft-ai/knowledge-types'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { guideCatalogRows, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import { arg, flag, loadPack } from './pack'

const { pack } = loadPack(arg('pack') || '')
// The app keeps the latest version per (kind, name) and orders bound sources at equal priority by name ('es').
const dto = pack.knowledge
  .map(
    (k, i): KnowledgeSourceDto =>
      ({
        id: `k${i}`,
        tenantId: 'pack',
        socialAccountId: null,
        kind: k.kind,
        name: k.name,
        body: k.body,
        status: 'approved',
        version: 1,
        contentHash: '',
        metadata: null,
        approvedBy: null,
        approvedAt: null,
      }) as KnowledgeSourceDto,
  )
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))
const budgeted = budgetKnowledgeSlice({
  brandBook: dto.filter((d) => d.kind === 'brand_book'),
  policies: dto.filter((d) => d.kind === 'policy'),
  faqs: dto.filter((d) => d.kind === 'faq'),
  channelOverlay: [],
  versions: [],
})
const visible = new Set([...budgeted.brandBook, ...budgeted.policies, ...budgeted.faqs].map((d) => d.id))
const docs: KnowledgeDocInput[] = dto.map((d) => ({
  name: d.name,
  kind: d.kind,
  body: d.body,
  visible: visible.has(d.id),
  lane: d.kind === 'faq' ? 'faq' : 'brand_policy',
}))
const shortcuts: RuntimeShortcut[] = pack.shortcuts.map((s, i) => ({
  key: s.key,
  title: s.title,
  kind: 'playbook',
  intents: s.intents,
  keywords: s.keywords,
  body: s.body,
  deliveryMode: s.deliveryMode ?? 'guide',
  isActive: true,
  sortOrder: i,
}))
const map = buildKnowledgeMap({
  // Price is managed in /ventas; offline it counts as present.
  products: pack.inventory.names.map((name, i) => ({ id: `p${i}`, name, price: 1 })),
  docs,
  catalogReplies: guideCatalogRows(shortcuts).map((r) => ({ title: r.title, body: r.body })),
  brandFacts: parseBrandFactsSafe(pack.brandFacts),
  shippingMethods: [],
  freeShippingBundles: ((pack.salesRules.bundles ?? []) as Array<{ name: string; shippingIncluded?: boolean }>).filter((x) => x.shippingIncluded === true).map((x) => x.name),
  budgets: { brand_policy: KNOWLEDGE_LAYER2_CHAR_BUDGET, faq: KNOWLEDGE_LAYER34_CHAR_BUDGET, corrections: KNOWLEDGE_TUNING_CHAR_BUDGET },
  notApplicable: (arg('na') || '').split(',').map((s) => s.trim()).filter(Boolean),
})

if (flag('json')) {
  console.log(JSON.stringify(map, null, 2))
} else {
  const mark = { ok: '✔', hidden: '⚠ no entra', missing: '✘ falta', na: '— no aplica' } as const
  console.log(`${pack.agent.name}: ${map.filled} de ${map.total} · ${map.percent} %`)
  for (const l of map.lanes.filter((x) => x.written > 0)) {
    console.log(`  Espacio "${l.label}": ${l.used}/${l.budget} visibles${l.written > l.used ? ` · ${l.written - l.used} escritos que NO ENTRAN` : ''}`)
  }
  for (const p of map.products) {
    const bad = p.fields.filter((f) => f.status !== 'ok' && f.status !== 'na')
    console.log(`  ${p.name}: ${bad.length ? bad.map((f) => `${f.label} ${mark[f.status]}`).join(' · ') : 'completo'}`)
  }
  const badStore = map.store.filter((f) => f.status !== 'ok' && f.status !== 'na')
  console.log(`  Tienda: ${badStore.length ? badStore.map((f) => `${f.label} ${mark[f.status]}`).join(' · ') : 'completa'}`)
  for (const c of map.conflicts) console.log(`  Conflicto · ${c.label}: ${c.detail}`)
}
process.exitCode = map.filled < map.total || map.lanes.some((l) => l.written > l.used) ? 1 : 0
