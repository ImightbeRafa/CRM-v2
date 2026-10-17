/**
 * luna-10: real-provider check for the staff bot on gpt-6-luna (Rafael: "test it separately"). Calls OpenAI with the
 * bot's real request builder, real tool list and real extraction prompt. NO tool is ever executed and no order /
 * message / customer row is written — tool results below are fixed fake strings. Each AI call IS metered: one
 * AiUsageEvent row (feature staff_bot, tenantId null) per call in the database DATABASE_URL points to (SecureDog DATA-61).
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/staff-bot-luna-check.ts
 */
import { parseResponseFunctionCalls, parseResponseText, toFunctionCallOutputs, buildToolFollowUpInput } from '@/lib/bot/ai-responses'

async function main() {
  const { __staffBotAiProbe: bot } = await import('@/lib/bot/ai-agent')
  const results: Array<{ step: string; ok: boolean; ms: number; detail: string }> = []
  const run = async (step: string, fn: () => Promise<{ ok: boolean; detail: string }>) => {
    const t0 = Date.now()
    try {
      const r = await fn()
      results.push({ step, ok: r.ok, ms: Date.now() - t0, detail: r.detail })
    } catch (e) {
      results.push({ step, ok: false, ms: Date.now() - t0, detail: `ERROR ${(e as { status?: number }).status ?? ''} ${(e as Error).message.slice(0, 200)}` })
    }
  }

  // 1) Order extraction (structured output) from a messy WhatsApp order.
  await run('extracción de pedido', async () => {
    const r = await bot.extractOrderArgsWithAi(
      'Nombre: Ana Mora Solís\nTel 8888-0000\nHeredia/Barva/San Pablo\n175 metros oeste de la escuela, casa verde\nDOPAMINE PATCH X1, GLP PATCH X2\nPago 29,700CRC SINPE CONFIRMADO\nMétodo envío CORREOS DE CR',
    )
    const ok = Boolean(r && r.customerName && r.province === 'Heredia' && Array.isArray(r.products) && r.products.length === 2)
    return { ok, detail: JSON.stringify(r).slice(0, 400) }
  })

  // 2) Tool-calling turn + 3) stateless follow-up replaying encrypted reasoning (store:false).
  const tools = bot.buildTools()
  let first: Awaited<ReturnType<typeof bot.createStaffBotResponse>> | null = null
  await run('pide una herramienta (no se ejecuta)', async () => {
    first = await bot.createStaffBotResponse({
      input: [{ role: 'user', content: '¿Cuántas órdenes tenemos hoy?' }],
      instructions: `Sos el asistente del equipo de una tienda. Fecha de hoy (Costa Rica): ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Costa_Rica' })}. Usá las herramientas para responder sobre órdenes.`,
      promptCacheKey: 'betsy:luna-check',
      maxOutputTokens: 2000,
      temperature: 0.1,
      reasoningEffort: 'low',
      tools,
      toolChoice: 'required',
      includeEncryptedReasoning: true,
    })
    const calls = parseResponseFunctionCalls(first)
    return { ok: calls.length > 0, detail: calls.map((c) => `${c.name}(${c.arguments.slice(0, 120)})`).join(' | ') || parseResponseText(first).slice(0, 200) }
  })
  await run('respuesta final tras la herramienta (replay)', async () => {
    if (!first) return { ok: false, detail: 'sin primer paso' }
    const calls = parseResponseFunctionCalls(first)
    const outputs = toFunctionCallOutputs(calls, calls.map(() => 'Hoy hay 7 órdenes: 4 por enviar, 2 enviadas, 1 retiro.'))
    const follow = await bot.createStaffBotResponse({
      input: buildToolFollowUpInput(first.output, outputs),
      instructions: 'Sos el asistente del equipo de una tienda. Respondé corto en español.',
      promptCacheKey: 'betsy:luna-check',
      maxOutputTokens: 2000,
      temperature: 0.1,
      reasoningEffort: 'low',
      includeEncryptedReasoning: true,
    })
    const text = parseResponseText(follow)
    return { ok: /7/.test(text), detail: text.slice(0, 300) }
  })

  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.step} (${(r.ms / 1000).toFixed(1)} s): ${r.detail}`)
  console.log(`modelo: ${bot.model}`)
  if (results.some((r) => !r.ok)) process.exitCode = 1
}

main().catch((e) => {
  console.error('ERROR', (e as Error).message)
  process.exitCode = 1
})
