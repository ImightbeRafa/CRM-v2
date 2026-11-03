/**
 * DeepSleep tenant / agent ids for conversion apply+revert scripts only.
 * Kept out of src/lib/soft-ai so A1 locked-paths (no hardcoded pilot id / brand) stays green.
 */
export const DEEPSLEEP_TENANT_ID = 'cmhsibjue0004js04gie724nx'
export const DEEPSLEEP_TENANT_SLUG = 'deepsleepp-cr-1762740734630'
export const DEEPSLEEP_OWNER_EMAIL = 'rafael@betsycrm.com'

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
