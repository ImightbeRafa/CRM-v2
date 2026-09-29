/**
 * Activity log of human actions (Phase 2a, 2026-09-29): the foundation for the usage dashboard and
 * flow mining (Phase 5). Rules:
 * - never throws and never blocks the action it records (fire-and-forget safe);
 * - ids and short enums only: no message bodies, phone numbers or free text;
 * - `dedupeKey` makes retries idempotent (unique per tenant);
 * - silently off until migration 035 creates the table.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'

export type ActivityInput = {
  tenantId: string
  actorUserId?: string | null
  actorKind?: 'human' | 'system' | 'agent'
  verb: string
  entityType?: string | null
  entityId?: string | null
  conversationId?: string | null
  clientId?: string | null
  orderId?: string | null
  surface?: string | null
  props?: Record<string, string | number | boolean | null>
  dedupeKey?: string | null
}

const VERB = /^[a-z0-9_.]{3,64}$/
const MAX_PROP_STRING = 80
let tableMissingUntil = 0

/** Keeps only scalar props, short strings, max 20 keys (the DB also caps the JSON at 4000 bytes). */
export function sanitizeActivityProps(props: ActivityInput['props']): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!props) return out
  for (const [k, v] of Object.entries(props).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, MAX_PROP_STRING)
  }
  return out
}

export function isValidVerb(verb: string): boolean {
  return VERB.test(verb)
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  if (!isValidVerb(input.verb) || !input.tenantId) return
  if (Date.now() < tableMissingUntil) return
  try {
    await prisma.activityEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        actorKind: input.actorKind ?? 'human',
        verb: input.verb,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        conversationId: input.conversationId ?? null,
        clientId: input.clientId ?? null,
        orderId: input.orderId ?? null,
        surface: input.surface ?? null,
        props: sanitizeActivityProps(input.props),
        dedupeKey: input.dedupeKey ?? null,
      },
    })
  } catch (error) {
    if (isMissingRelation(error)) {
      tableMissingUntil = Date.now() + 5 * 60_000
      return
    }
    const code = (error as { code?: string })?.code
    if (code === 'P2002') return // dedupeKey already recorded (retry)
    console.warn('[activity] not recorded', input.verb, error instanceof Error ? error.message : error)
  }
}
