/**
 * luna-10 D2: offline eval of the "¿ya pagó?" model check against real Luna (read-only; each call is metered as
 * 'payment_check' under the given tenant). Claims must all come back "claim"; plain asks may be flagged ≤ 2 %.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/payment-check-eval.ts --tenant=<id> [--out=file.json]
 */
import * as fs from 'node:fs'
import { runPaymentClaimCheck } from '@/lib/soft-ai/llm/payment-claim-check'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

type Case = { text: string; history?: Array<{ direction: string; content: string }> }
const PAY_DETAILS = { direction: 'outbound', content: 'Perfecto 🙌\nSINPE Móvil: 6201 9914 a nombre de R G\nCuando lo hagas, mandame el comprobante por aquí 😊' }

export const CLAIMS: Case[] = [
  // Reviewer / SecureDog repros (INT-136..141) the regex had to learn one by one.
  'Ya pagamos', 'ya lo pagamos', 'Ya pagaron', 'ya cancelamos', 'ya depositamos', 'Mamá lo canceló', 'Mi papá lo transfirió',
  'Lo canceló mi hermano', 'Ya les pasamos la plata', 'Les mandaron la plata', 'ya les enviamos los 15 mil', 'ya les cayó?',
  'Abonamos ayer', 'La mitad la abonamos', 'Ya sinpié', 'Mi esposo les sinpeó, ¿cómo pagamos el envío?',
  '¿Puedo hacerles un sinpe? hecho', '¿Puedo hacerles una transferencia? Mamá la realizó', '¿Aceptan transferencia? la realizó mi esposo',
  'Mi mamá realizó la transferencia', 'La transferencia ya está', 'El link de pago venció, ¿me mandás otro?', 'Me rechazaron la tarjeta',
  'Mi esposo canceló la mitad, quiero pagar el resto', 'Quiero pagar con el link, el otro venció', 'Me cobraron doble',
  'devuélvanme la plata porfa', 'Ya aboné la mitad, ¿cómo pago el resto?', 'El adelanto ya está, ¿cuándo sale?',
  // New paraphrases with no regex coverage: unaccented, voseo, third person, emoji-only after the details, split messages.
  'mama ya lo cancelo', 'ya les pase la plata ayer en la noche', 'mi novio les hizo el sinpe hace un rato', 'ya quedo pagado',
  'Ahí les va 👍', 'listo ✅', 'hecho!', 'ya', 'les mande lo del pedido por sinpe', 'ya esta la plata', 'ya hice lo del pago',
  'mi hermana les deposito 20 rojos', 'le tiré el sinpe', 'ya le tire la plata', 'ya les cayó la platica?', 'se fue el sinpe',
  'me salio el sinpe dos veces', 'la tarjeta me la cobraron pero no me llego confirmacion', 'pague y no me llego nada',
  '¿ya les llego lo mio?', 'listo ya está, revisá porfa',
].map((text) => ({ text, history: [{ direction: 'inbound', content: 'quiero el de dormir' }, PAY_DETAILS] }))

export const ASKS: Case[] = [
  '¿Cómo puedo pagar?', '¿Aceptan tarjeta?', '¿Puedo hacerles un sinpe?', '¿Si pago hoy llega mañana?', '¿El pago es antes del envío?',
  'Quiero pagar con tarjeta', 'Pasame el link de pago', '¿Cuál es el número de sinpe?', '¿Hacen contra entrega?', '¿Puedo pagar al recibir?',
  '¿Cómo pagamos?', '¿Cuánta plata es con envío?', 'cuanto es el envio a Heredia?', '¿Puedo hacerles el sinpe mañana?',
  'Hola! Quiero comprar 2 parches. ¿Aceptan tarjeta?', '¿Me pasás el link de pago? Gracias', 'Listo, ¿cómo pago?',
  '¿Se puede apartar con un abono?', '¿Cuánto es el adelanto?', '¿Tienen link para comprar?', 'Me interesa el combo, ¿cuánto sale?',
  '¿El link de pago es seguro?', '¿Puedo pagar con tarjeta de débito?', 'Por SINPE está bien', 'Te pago por sinpe mañana temprano',
  '¿A nombre de quién sale el sinpe?', 'Quiero el Focus y el Energy', '¿Cuántos días dura el paquete?', '¿Hacen envíos a Limón?',
  '¿Me lo pueden tener para el sábado? pago en efectivo', 'Ok perfecto, ¿y para pagar?', '¿Puedo pagar la mitad ahora y la mitad al recibir?',
  'Voy a hacer el sinpe ahorita', 'ahorita le hago el sinpe', 'en la noche les pago', '¿y si la tarjeta sale rechazada?',
].map((text) => ({ text, history: [{ direction: 'inbound', content: 'quiero el de dormir' }, { direction: 'outbound', content: 'Tenemos SINPE Móvil y tarjeta. ¿Cómo preferís pagar?' }] }))

async function main() {
  const tenantId = arg('tenant') || ''
  if (!tenantId) throw new Error('--tenant=<id> requerido (el uso se mide en ese negocio)')
  const rows: Array<{ set: 'claim' | 'ask'; text: string; verdict: string; kind: string | null; ms: number }> = []
  for (const [set, cases] of [['claim', CLAIMS], ['ask', ASKS]] as const) {
    for (const c of cases) {
      const r = await runPaymentClaimCheck({ inboundText: c.text, history: c.history || [], tenantId })
      rows.push({ set, text: c.text, verdict: r.verdict, kind: r.kind, ms: r.ms })
      process.stdout.write(set === 'claim' ? (r.verdict === 'clear' ? '✖' : '·') : r.verdict === 'clear' ? '·' : '?')
    }
  }
  const missed = rows.filter((r) => r.set === 'claim' && r.verdict === 'clear')
  const flagged = rows.filter((r) => r.set === 'ask' && r.verdict !== 'clear')
  const errors = rows.filter((r) => r.verdict === 'error')
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b)
  const pct = (p: number) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))]
  const summary = {
    claims: CLAIMS.length,
    claimsMissed: missed.length,
    asks: ASKS.length,
    asksFlagged: flagged.length,
    asksFlaggedPct: Math.round((flagged.length / ASKS.length) * 1000) / 10,
    errors: errors.length,
    p50ms: pct(50),
    p95ms: pct(95),
    maxms: ms[ms.length - 1],
    missed: missed.map((r) => r.text),
    flagged: flagged.map((r) => `${r.text} (${r.verdict}/${r.kind})`),
  }
  console.log('\n' + JSON.stringify(summary, null, 2))
  const out = arg('out')
  if (out) fs.writeFileSync(out, JSON.stringify({ summary, rows }, null, 2))
}

if (process.argv[1]?.includes('payment-check-eval')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
