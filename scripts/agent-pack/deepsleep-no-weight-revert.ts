/**
 * Revert of deepsleep-no-weight-apply.ts from its backup JSON (exact --backup= path; no newest-file fallback).
 * Only where live still equals the backed-up "after" (else skipped and reported, unless --force); knowledge comes
 * back as a new approved version with the old body. Default is dry-run; --apply writes. See deepsleep-text-edit-engine.ts.
 * Note: after deepsleep-weight-decides-apply.ts, revert that one first (its backup), then this one.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-no-weight-revert.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     --backup=scripts/agent-pack/out/deepsleep-no-weight-backup-<stamp>.json [--apply] [--force] [--actor-email=…]
 */
import { NO_WEIGHT_ACTOR_EMAIL } from '../lib/deepsleep-no-weight-edits'
import { runMain, runTextEditRevert } from './deepsleep-text-edit-engine'

runMain(() =>
  runTextEditRevert({
    kind: 'deepsleep-no-weight',
    title: 'DeepSleep no-weight revert',
    actorEmail: NO_WEIGHT_ACTOR_EMAIL,
    revertScript: 'deepsleep-no-weight-revert',
  }),
)
