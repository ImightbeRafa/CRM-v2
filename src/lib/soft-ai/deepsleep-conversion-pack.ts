/**
 * Pure DeepSleep conversion pack helpers (copy + follow-up enable planning).
 * Used by scripts/agent-pack/deepsleep-conversion-*.ts and unit tests.
 * Never writes to the DB.
 *
 * Keep this file free of hardcoded tenant/agent ids and store brand tokens — A1 locked-paths
 * scans src/lib/soft-ai for pilot ids / brand names.
 */

/** Owner-confirmed posture-harness facts (2026-11-03). */
export const HARNESS_COLOR_LINE = 'Por ahora viene solo en negro 🖤'
export const HARNESS_SHIPPING_LINE = '2 a 3 días hábiles'
export const HARNESS_WASH_LINE =
  'Se lava a mano con agua fría y se seca a la sombra, no al sol directo, para que no se dañe. No lo metás en lavadora ni secadora porque se pueden enredar y dañar las tiras.'

/** @deprecated alias — prefer HARNESS_* */
export const FORGE_COLOR_LINE = HARNESS_COLOR_LINE
/** @deprecated alias — prefer HARNESS_* */
export const FORGE_SHIPPING_LINE = HARNESS_SHIPPING_LINE
/** @deprecated alias — prefer HARNESS_* */
export const FORGE_WASH_LINE = HARNESS_WASH_LINE

/** Generic stage texts (shared stores). No product names, no slashes. */
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

/** Whitening-strips store stage texts — price/options only on that agent. */
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
 * Activates only agents in enableAgentIds; leaves others' active state alone.
 */
export function planFollowUpCampaignsOnEnable<C extends FollowUpCampaignLike>(
  campaigns: C[],
  opts: {
    enableAgentIds: ReadonlySet<string>
    stageTextsFor: (agentId: string) => unknown
  },
): C[] {
  const { enableAgentIds, stageTextsFor } = opts
  return campaigns.map((c) => {
    if (!enableAgentIds.has(c.agentId)) {
      return { ...c }
    }
    return {
      ...c,
      active: true,
      stageTexts: stageTextsFor(c.agentId),
    }
  })
}

/**
 * CRM161-04: patch ONLY target campaigns inside the RAW follow-up flag config.
 * Preserves every other key/campaign (no parseFollowUpConfig round-trip).
 */
export function patchRawFollowUpConfigEnable(
  raw: unknown,
  opts: {
    enableAgentIds: ReadonlySet<string>
    stageTextsFor: (agentId: string) => unknown
  },
): { next: unknown; patchedIds: string[]; skippedIds: string[] } {
  const { enableAgentIds, stageTextsFor } = opts
  const cloned = structuredClone(raw ?? { campaigns: [] }) as { campaigns?: unknown[]; [k: string]: unknown }
  if (!Array.isArray(cloned.campaigns)) {
    return { next: cloned, patchedIds: [], skippedIds: [] }
  }
  const patchedIds: string[] = []
  const skippedIds: string[] = []
  cloned.campaigns = cloned.campaigns.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const c = entry as Record<string, unknown>
    const agentId = typeof c.agentId === 'string' ? c.agentId : ''
    const id = typeof c.id === 'string' ? c.id : agentId || '?'
    if (!enableAgentIds.has(agentId)) {
      skippedIds.push(id)
      return c
    }
    patchedIds.push(id)
    return {
      ...c,
      active: true,
      stageTexts: stageTextsFor(agentId),
    }
  })
  return { next: cloned, patchedIds, skippedIds }
}

export type ConversionBackupV1 = {
  version: 1
  createdAt: string
  tenantId: string
  tenantSlug: string
  agents: Record<
    string,
    {
      id: string
      name: string
      systemInstructions: string | null
      brandFacts: unknown
      version: number
      shortcuts: Array<Record<string, unknown>>
      knowledgeBindings: Array<{ sourceId: string; name: string; contentHash: string | null }>
    }
  >
  followUpFlag: null | {
    id: string
    enabled: boolean
    /** RAW config as stored — restore verbatim. */
    config: unknown
  }
}
