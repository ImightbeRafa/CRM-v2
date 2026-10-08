/**
 * Ambient usage context (AsyncLocalStorage) so deep AI calls can be attributed to a business without threading
 * a tenantId through every function. Used at the staff bot's message entry points (approved by Rafael:
 * recording only, no behavior change). Must not import from the staff bot or the inbox agent.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export type AiUsageScope = {
  tenantId: string | null
  /** Default feature for calls made inside this scope (e.g. 'staff_bot'). */
  feature?: string
  userId?: string | null
  conversationId?: string | null
}

const storage = new AsyncLocalStorage<AiUsageScope>()

export function withAiUsageContext<T>(scope: AiUsageScope, fn: () => T): T {
  return storage.run(scope, fn)
}

export function currentAiUsageContext(): AiUsageScope | undefined {
  return storage.getStore()
}
