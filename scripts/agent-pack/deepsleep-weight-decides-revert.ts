/**
 * Revert of deepsleep-weight-decides-apply.ts from its backup JSON (exact --backup= path; no newest-file fallback).
 * Only where live still equals the backed-up "after" (else skipped and reported, unless --force); knowledge comes
 * back as a new approved version with the old body. Default is dry-run; --apply writes. See deepsleep-text-edit-engine.ts.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-weight-decides-revert.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     --backup=scripts/agent-pack/out/deepsleep-weight-decides-backup-<stamp>.json [--apply] [--force] [--actor-email=…]
 */
import { WEIGHT_DECIDES_ACTOR_EMAIL } from '../lib/deepsleep-weight-decides-edits'
import { runMain, runTextEditRevert } from './deepsleep-text-edit-engine'

runMain(() =>
  runTextEditRevert({
    kind: 'deepsleep-weight-decides',
    title: 'DeepSleep weight-decides revert',
    actorEmail: WEIGHT_DECIDES_ACTOR_EMAIL,
    revertScript: 'deepsleep-weight-decides-revert',
  }),
)
