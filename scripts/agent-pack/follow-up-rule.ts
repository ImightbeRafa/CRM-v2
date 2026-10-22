/**
 * Follow-up experiment winner rule (Rafael 2026-10-22: "use the ones with the best results, for all agents"). Pure —
 * no DB — so the report, the rotate command and the tests all use the same rule.
 *
 * Plain words: the current best text (the "champion") always runs against one new text (the "challenger"). After
 * enough chats and at least a week, the challenger wins only if it is clearly better at getting ORDERS; when there are
 * still too few orders to tell, it may win on REPLIES, but only if it is not clearly worse at orders. A text that makes
 * people ask to stop (opt-out) is dropped no matter what. If after many chats nothing is clearly better, the champion
 * stays and the next challenger gets its turn.
 */

export type ArmStats = {
  /** Text key from the pack's follow-up.json. */
  key: string
  /** Chats that got this text (the rate denominator). */
  sent: number
  /** Chats where the customer wrote back after the follow-up. */
  replied: number
  /** Chats with an order linked after the follow-up. */
  ordered: number
  /** ₡ of those orders. */
  revenue: number
  /** Chats where the customer asked to stop (hard opt-out only — a soft "no gracias" is not counted). */
  optedOut: number
  /** Days since this text first ran against the other one. */
  days: number
}

export const WINNER_RULE = {
  /** Chats per text before any decision. */
  minPerArm: 150,
  /** Days before any decision (covers a full week: weekdays and weekend). */
  minDays: 7,
  /** "Clearly better": 95 % sure. */
  sure: 0.95,
  /** Below this many orders (both texts together) orders can't decide yet → replies decide. */
  minOrdersToDecide: 10,
  /** On a reply win, the challenger may not be clearly worse at orders (at least this chance of being better). With few
   * orders the order signal is noise, so a low floor; with enough orders it must at least be a coin flip. */
  replyWinOrderFloor: 0.2,
  replyWinOrderFloorWithOrders: 0.5,
  /** Opt-out guardrail: at least this many opt-outs AND more than 3 % of sends, or twice the champion's rate. */
  optOutMinCount: 3,
  optOutMaxRate: 0.03,
  optOutVsChampion: 2,
  /** No clear difference after this many chats per text → champion stays, next challenger. */
  maxPerArm: 600,
} as const

export type Verdict =
  | { kind: 'keep_testing'; reason: string; pOrders: number; pReplies: number }
  | { kind: 'challenger_wins'; reason: string; pOrders: number; pReplies: number }
  | { kind: 'champion_keeps'; reason: string; pOrders: number; pReplies: number }
  | { kind: 'challenger_dropped'; reason: string; pOrders: number; pReplies: number }
  | { kind: 'stop_agent'; reason: string; pOrders: number; pReplies: number }

/** Small deterministic PRNG (same inputs → same verdict on every run). */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** Marsaglia–Tsang gamma sampler (shape ≥ 1; Beta(1 + k, 1 + n − k) shapes always are). */
function gamma(shape: number, rng: () => number): number {
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      x = normal(rng)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Chance that B's true rate is higher than A's (flat prior, Monte Carlo). */
export function chanceBetter(a: { n: number; k: number }, b: { n: number; k: number }, draws = 20000, seed = 7): number {
  const rng = mulberry32(seed)
  const beta = (k: number, n: number) => {
    const x = gamma(1 + k, rng)
    return x / (x + gamma(1 + Math.max(0, n - k), rng))
  }
  let wins = 0
  for (let i = 0; i < draws; i++) if (beta(b.k, b.n) > beta(a.k, a.n)) wins++
  return wins / draws
}

const rate = (k: number, n: number) => (n > 0 ? k / n : 0)

function breaksOptOut(arm: ArmStats, vs?: ArmStats): boolean {
  if (arm.optedOut < WINNER_RULE.optOutMinCount) return false
  const r = rate(arm.optedOut, arm.sent)
  if (r > WINNER_RULE.optOutMaxRate) return true
  return !!vs && r > WINNER_RULE.optOutVsChampion * Math.max(rate(vs.optedOut, vs.sent), 0.005)
}

/** The rule. Pure and deterministic. */
export function decideWinner(champion: ArmStats, challenger: ArmStats): Verdict {
  const pOrders = chanceBetter({ n: champion.sent, k: champion.ordered }, { n: challenger.sent, k: challenger.ordered })
  const pReplies = chanceBetter({ n: champion.sent, k: champion.replied }, { n: challenger.sent, k: challenger.replied })
  const v = (kind: Verdict['kind'], reason: string) => ({ kind, reason, pOrders, pReplies }) as Verdict
  const pct = (p: number) => `${Math.round(p * 100)} %`

  if (breaksOptOut(champion)) return v('stop_agent', `el campeón "${champion.key}" pasa el límite de bajas (${champion.optedOut}/${champion.sent}) → pausar los seguimientos de este agente y avisar a Rafael`)
  if (breaksOptOut(challenger, champion)) return v('challenger_dropped', `"${challenger.key}" pasa el límite de bajas (${challenger.optedOut}/${challenger.sent}) → se descarta`)

  const enough =
    champion.sent >= WINNER_RULE.minPerArm && challenger.sent >= WINNER_RULE.minPerArm && Math.min(champion.days, challenger.days) >= WINNER_RULE.minDays
  if (!enough)
    return v('keep_testing', `faltan datos: mínimo ${WINNER_RULE.minPerArm} chats por texto y ${WINNER_RULE.minDays} días (hoy ${champion.sent}/${challenger.sent} chats, ${Math.min(champion.days, challenger.days).toFixed(1)} días)`)

  const orders = champion.ordered + challenger.ordered
  if (orders >= WINNER_RULE.minOrdersToDecide) {
    if (pOrders >= WINNER_RULE.sure) return v('challenger_wins', `más pedidos: ${pct(pOrders)} seguro de que "${challenger.key}" vende más`)
    if (pOrders <= 1 - WINNER_RULE.sure) return v('champion_keeps', `más pedidos: ${pct(1 - pOrders)} seguro de que "${champion.key}" vende más`)
  }
  const floor = orders >= WINNER_RULE.minOrdersToDecide ? WINNER_RULE.replyWinOrderFloorWithOrders : WINNER_RULE.replyWinOrderFloor
  if (pReplies >= WINNER_RULE.sure && pOrders >= floor)
    return v('challenger_wins', `${orders < WINNER_RULE.minOrdersToDecide ? 'pocos pedidos todavía; ' : 'pedidos parejos; '}más respuestas: ${pct(pReplies)} seguro, y no vende claramente menos`)
  if (pReplies <= 1 - WINNER_RULE.sure && pOrders <= 1 - floor)
    return v('champion_keeps', `más respuestas con "${champion.key}" (${pct(1 - pReplies)} seguro)`)
  if (champion.sent >= WINNER_RULE.maxPerArm && challenger.sent >= WINNER_RULE.maxPerArm)
    return v('champion_keeps', `sin diferencia clara después de ${WINNER_RULE.maxPerArm} chats por texto → se queda el campeón`)
  return v('keep_testing', `todavía sin diferencia clara (pedidos ${pct(pOrders)}, respuestas ${pct(pReplies)} a favor de "${challenger.key}")`)
}
