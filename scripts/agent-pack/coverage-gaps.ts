/**
 * Offline knowledge coverage of a pack (no database, no AI tokens): which product has no ingredients written down and
 * which store topic (uso, uso diario, seguridad, resultados, envío, pago, devoluciones) has no answer.
 *
 *   npx tsx scripts/agent-pack/coverage-gaps.ts --pack=<carpeta del pack>
 *
 * Exit code 1 when there are gaps. The live check (the agent actually answering) is probar.ts --coverage.
 */
import { knowledgeGaps } from '@/lib/soft-ai/knowledge-coverage'
import { arg, loadPack } from './pack'

const { pack } = loadPack(arg('pack') || '')
const knowledge = [...pack.knowledge.map((k) => k.body), ...pack.shortcuts.map((s) => s.body), JSON.stringify(pack.brandFacts)].join('\n\n')
const gaps = knowledgeGaps({ knowledge, products: pack.inventory.names })
console.log(`${pack.agent.name}: ${pack.inventory.names.length} productos`)
if (!gaps.length) console.log('Sin huecos: cada producto tiene ingredientes y la tienda cubre todos los temas.')
for (const g of gaps) console.log(`  - ${g.product ? `${g.product}: ` : 'Tienda: '}${g.topic}`)
process.exitCode = gaps.length ? 1 : 0
