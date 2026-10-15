/**
 * CONTRACT STUB (builder A worktree only) — DROP AT INTEGRATION: builder C owns the real file
 * (claudio/agents2-c-waiting). Exists only so A's power-on path typechecks; it answers nothing.
 */
import 'server-only'

export async function sweepWaitingChats(
  tenantId: string,
  socialAccountId: string,
  opts?: { limit?: number },
): Promise<{ queued: number; skipped: number }> {
  void tenantId
  void socialAccountId
  void opts
  return { queued: 0, skipped: 0 }
}
