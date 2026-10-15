/**
 * STUB (stream B worktree only). Stream C owns the real implementation of this file
 * (claudio/agents2-c-waiting); the integrator keeps C's version. Signature is the Phase 1 contract.
 */

export async function notifyHandoff(input: {
  tenantId: string
  conversationId: string
  socialAccountId?: string | null
  kind: 'handoff' | 'review'
  reason: string
}): Promise<void> {
  void input
}
