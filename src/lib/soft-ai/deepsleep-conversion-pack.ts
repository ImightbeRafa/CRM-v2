/**
 * Pure DeepSleep conversion pack helpers (copy + follow-up enable planning).
 * Used by scripts/agent-pack/deepsleep-conversion-apply.ts and unit tests.
 * Never writes to the DB.
 */

export const DEEPSLEEP_AGENTS = {
  forge: 'cmub1rziw0005l704mebpx4xc',
  sleeping: 'cmv9xf14x0001vitkkhx2vxd4',
  patchhouse: 'cmv8mpajv0001vii8x9cey29a',
  pura: 'cmvda4onv0001vip0rj6q7jkt',
  prototipo: 'cmvdaghtc0001vi98x3abfr1r',
} as const

/** Agents whose campaigns --enable-follow-ups may turn on. Never PatchHouse. */
export const FOLLOW_UP_ENABLE_AGENT_IDS: ReadonlySet<string> = new Set([
  DEEPSLEEP_AGENTS.forge,
  DEEPSLEEP_AGENTS.sleeping,
  DEEPSLEEP_AGENTS.pura,
  DEEPSLEEP_AGENTS.prototipo,
])

/** Owner-confirmed Forge facts (2026-11-03). */
export const FORGE_COLOR_LINE = 'Por ahora viene solo en negro 🖤'
export const FORGE_SHIPPING_LINE = '2 a 3 días hábiles'
export const FORGE_WASH_LINE =
  'Se lava a mano con agua fría y se seca a la sombra, no al sol directo, para que no se dañe. No lo metás en lavadora ni secadora porque se pueden enredar y dañar las tiras.'

/** Generic stage texts (Forge / Sleeping / Prototipo). No product names, no slashes. */
export const STAGE_TEXTS = {
  A: {
    quoted: '¡Hola! 😊 ¿Querés que te lo aparte?',
    size: '¡Hola! 😊 ¿Confirmamos tu talla y te armo el pedido?',
    how_it_works: '¡Hola! 😊 ¿Te ayudo a pedir el tuyo?',
    shipping_details: '¡Hola! 😊 ¿Me pasás los datos que faltan para preparar tu pedido?',
    chose: '¡Hola! 😊 ¿Seguimos con tu pedido?',
    sinpe_reminder: '¡Hola! Cuando hagas el SINPE, mandame el comprobante por aquí y lo revisamos 😊',
  },
  B: {
    quoted: '¡Hola! ¿Todavía te interesa? Te lo puedo apartar hoy mismo 🚚',
    size: '¡Hola! Pasame tu peso y te digo la talla 😊 ¿Cuánto pesás?',
    how_it_works: '¡Hola! ¿Te armo el pedido? Acá estoy 🙌',
    shipping_details: '¡Hola! ¿Seguimos con la dirección para enviártelo?',
    chose: '¡Hola! ¿Lo dejamos listo hoy?',
    sinpe_reminder: '¡Hola! Si ya hiciste el SINPE, mandame el comprobante y lo revisamos 😊',
  },
} as const

/** Pura Sonrisa stage texts — price/options only on this agent. */
export const PURA_STAGE = {
  A: {
    ...STAGE_TEXTS.A,
    quoted:
      '¡Hola! 😁 Te recuerdo: 1 caja ₡10 450 + envío ₡3 000; Combo 2 ₡19 900 ya con envío; Pack 4 sabores ₡37 900. ¿Cuál te armamos?',
  },
  B: {
    ...STAGE_TEXTS.B,
    quoted: '¡Hola! ¿Te armo el Combo 2 cajas a ₡19 900 ya con envío? 😊',
  },
} as const

export type FollowUpCampaignLike = {
  agentId: string
  active: boolean
  stageTexts?: unknown
  [key: string]: unknown
}

/**
 * Plan campaign updates for --enable-follow-ups.
 * Activates only intended DeepSleep agents; leaves PatchHouse (and any other) active state alone.
 * Writes stageTexts only onto intended agents (Pura gets PURA_STAGE; others get generic STAGE_TEXTS).
 */
export function planFollowUpCampaignsOnEnable<C extends FollowUpCampaignLike>(
  campaigns: C[],
  opts?: {
    enableAgentIds?: ReadonlySet<string>
    stageTextsFor?: (agentId: string) => unknown
  },
): C[] {
  const enableIds = opts?.enableAgentIds ?? FOLLOW_UP_ENABLE_AGENT_IDS
  const stageTextsFor =
    opts?.stageTextsFor ??
    ((agentId: string) => (agentId === DEEPSLEEP_AGENTS.pura ? PURA_STAGE : STAGE_TEXTS))
  return campaigns.map((c) => {
    if (!enableIds.has(c.agentId)) {
      // Keep existing active + stageTexts (e.g. PatchHouse stays as-is).
      return { ...c }
    }
    return {
      ...c,
      active: true,
      stageTexts: stageTextsFor(c.agentId),
    }
  })
}
