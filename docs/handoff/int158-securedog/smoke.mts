import { load, esc } from './harness.mts'
const { sc, ov } = await load()
for (const t of ['Tu pago está confirmado', 'Hola, ¿en qué te ayudo?']) {
  const v = ov.validateAgentOutput({ text: t, citedToolNames: [] })
  console.log(esc(t), sc.hasConfirmationWording(t), sc.hasOutboundConfirmationClaim(t), v.reasons)
}
