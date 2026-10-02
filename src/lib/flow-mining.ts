/**
 * Flow mining (pure, offline): what do customers ask first, and which first questions lead to an order.
 * Output is COUNTS ONLY: no message text, no names, no phone numbers. Any phrase or bucket seen fewer than
 * K_MIN times is dropped (k-anonymity), so a rare one-off message can never leak through a report.
 */

export const K_MIN = 5

export const INTENTS = [
  'precio',
  'envio',
  'ubicacion',
  'pago',
  'stock',
  'como_funciona',
  'fotos_o_video',
  'horario',
  'estado_pedido',
  'saludo_solo',
  'otro',
] as const
export type Intent = (typeof INTENTS)[number]

const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  ['estado_pedido', /\b(mi pedido|donde (va|esta) mi|numero de guia|guia|rastre|tracking|cuando llega)\b/],
  ['pago', /\b(sinpe|transferencia|tarjeta|pagar|pago|contra ?entrega|iban|cuenta)\b/],
  ['precio', /\b(precio|cuanto (sale|cuesta|vale)|costo|valor|cuanto es|tarifa)\b|[$₡]/],
  ['envio', /\b(envios?|envian|enviar|mandan|correos|domicilio|entregas?)\b/],
  ['ubicacion', /\b(donde (estan|queda|se ubican)|ubicacion|direccion|sucursal|tienda fisica|retiro|recoger)\b/],
  ['stock', /\b(tienen|hay |disponible|stock|quedan|existencia)\b/],
  ['fotos_o_video', /\b(foto|fotos|video|imagen|catalogo)\b/],
  ['horario', /\b(horario|abren|cierran|atienden)\b/],
  ['como_funciona', /\b(como (funciona|se usa|se aplica|se toma)|sirve para|que es|informacion|info)\b/],
  ['saludo_solo', /^(hola|buenas?( dias| tardes| noches)?|buen dia|saludos|hi|hello)[ !.?¡¿]*$/],
]

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyIntent(text: string): Intent {
  const t = normalize(text)
  if (!t) return 'otro'
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(t)) return intent
  return 'otro'
}

const STOP = new Set([
  'de', 'la', 'el', 'en', 'y', 'a', 'que', 'es', 'un', 'una', 'por', 'para', 'con', 'me', 'mi', 'se', 'lo', 'los',
  'las', 'al', 'del', 'su', 'si', 'no', 'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'favor', 'gracias',
])

/** Words of a message without stop words, for phrase counting. */
export function contentWords(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(' ')
    // Words with digits are dropped (phone numbers, order ids): a report must never carry them.
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/\d/.test(w))
}

export type ConversationRow = {
  firstInboundText: string
  firstInboundHourCR: number // 0-23
  secondsToFirstReply: number | null
  ordered: boolean
  secondsToOrder: number | null
}

export type IntentStats = { intent: Intent; conversations: number; replied: number; ordered: number; conversionRate: number }
export type PhraseStat = { phrase: string; conversations: number; ordered: number; conversionRate: number }
export type FlowReport = {
  conversations: number
  replied: number
  ordered: number
  conversionRate: number
  medianSecondsToFirstReply: number | null
  medianHoursToOrder: number | null
  byIntent: IntentStats[]
  topPhrases: PhraseStat[]
  byHour: Array<{ hour: number; conversations: number; ordered: number }>
  suppressedBelowK: number
  kMin: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0)

export function buildFlowReport(rows: ConversationRow[], kMin: number = K_MIN): FlowReport {
  const total = rows.length
  const replied = rows.filter((r) => r.secondsToFirstReply !== null).length
  const ordered = rows.filter((r) => r.ordered).length

  const intents = new Map<Intent, { c: number; r: number; o: number }>()
  const phrases = new Map<string, { c: number; o: number }>()
  const hours = new Map<number, { c: number; o: number }>()
  for (const row of rows) {
    const intent = classifyIntent(row.firstInboundText)
    const i = intents.get(intent) ?? { c: 0, r: 0, o: 0 }
    i.c += 1
    if (row.secondsToFirstReply !== null) i.r += 1
    if (row.ordered) i.o += 1
    intents.set(intent, i)

    const words = contentWords(row.firstInboundText)
    const seen = new Set<string>()
    for (let k = 0; k < words.length; k += 1) {
      seen.add(words[k])
      if (k + 1 < words.length) seen.add(`${words[k]} ${words[k + 1]}`)
    }
    for (const p of seen) {
      const entry = phrases.get(p) ?? { c: 0, o: 0 }
      entry.c += 1
      if (row.ordered) entry.o += 1
      phrases.set(p, entry)
    }

    const h = hours.get(row.firstInboundHourCR) ?? { c: 0, o: 0 }
    h.c += 1
    if (row.ordered) h.o += 1
    hours.set(row.firstInboundHourCR, h)
  }

  let suppressed = 0
  const byIntent: IntentStats[] = []
  for (const [intent, v] of intents) {
    if (v.c < kMin) {
      suppressed += v.c
      continue
    }
    byIntent.push({ intent, conversations: v.c, replied: v.r, ordered: v.o, conversionRate: rate(v.o, v.c) })
  }
  byIntent.sort((a, b) => b.conversations - a.conversations)

  const topPhrases: PhraseStat[] = []
  for (const [phrase, v] of phrases) {
    if (v.c < kMin) continue
    topPhrases.push({ phrase, conversations: v.c, ordered: v.o, conversionRate: rate(v.o, v.c) })
  }
  topPhrases.sort((a, b) => b.conversations - a.conversations || (a.phrase < b.phrase ? -1 : 1))

  const byHour = [...hours.entries()]
    .filter(([, v]) => v.c >= kMin)
    .map(([hour, v]) => ({ hour, conversations: v.c, ordered: v.o }))
    .sort((a, b) => a.hour - b.hour)

  return {
    conversations: total,
    replied,
    ordered,
    conversionRate: rate(ordered, total),
    medianSecondsToFirstReply: median(
      rows.map((r) => r.secondsToFirstReply).filter((v): v is number => v !== null),
    ),
    medianHoursToOrder: (() => {
      const m = median(rows.map((r) => r.secondsToOrder).filter((v): v is number => v !== null))
      return m === null ? null : Math.round((m / 3600) * 10) / 10
    })(),
    byIntent,
    topPhrases: topPhrases.slice(0, 40),
    byHour,
    suppressedBelowK: suppressed,
    kMin,
  }
}

export function reportToMarkdown(report: FlowReport, label: string): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const lines: string[] = []
  lines.push(`# Flow mining — ${label}`)
  lines.push('')
  lines.push(`Solo conteos. Nada con menos de ${report.kMin} casos. Sin mensajes ni números; las palabras frecuentes pueden incluir nombres comunes.`)
  lines.push('')
  lines.push(`- Conversaciones nuevas: ${report.conversations}`)
  lines.push(`- Respondidas: ${report.replied}`)
  lines.push(`- Con pedido: ${report.ordered} (${pct(report.conversionRate)})`)
  lines.push(
    `- Mediana hasta la primera respuesta: ${
      report.medianSecondsToFirstReply === null ? '—' : `${Math.round(report.medianSecondsToFirstReply / 60)} min`
    }`,
  )
  lines.push(`- Mediana hasta el pedido: ${report.medianHoursToOrder === null ? '—' : `${report.medianHoursToOrder} h`}`)
  lines.push('')
  lines.push('## Qué preguntan primero')
  lines.push('| Tema | Chats | Respondidos | Con pedido | % pedido |')
  lines.push('|---|---:|---:|---:|---:|')
  for (const i of report.byIntent) {
    lines.push(`| ${i.intent} | ${i.conversations} | ${i.replied} | ${i.ordered} | ${pct(i.conversionRate)} |`)
  }
  lines.push('')
  lines.push('## Frases más comunes en el primer mensaje')
  lines.push('| Frase | Chats | Con pedido | % pedido |')
  lines.push('|---|---:|---:|---:|')
  for (const p of report.topPhrases) {
    lines.push(`| ${p.phrase} | ${p.conversations} | ${p.ordered} | ${pct(p.conversionRate)} |`)
  }
  lines.push('')
  lines.push('## Hora del primer mensaje (Costa Rica)')
  lines.push('| Hora | Chats | Con pedido |')
  lines.push('|---:|---:|---:|')
  for (const h of report.byHour) lines.push(`| ${h.hour}:00 | ${h.conversations} | ${h.ordered} |`)
  lines.push('')
  lines.push(`Casos en temas con menos de ${report.kMin} chats (omitidos): ${report.suppressedBelowK}`)
  return lines.join('\n')
}
