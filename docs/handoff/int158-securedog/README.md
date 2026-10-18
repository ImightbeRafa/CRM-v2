# INT-158 SecureDog round 1 scripts (2026-10-18)

Bypass sets (c1–c7), perf timing (perf, perf2) and the prototype fix (proto*) from SecureDog's review.
Results were for shortcuts.ts as of 29efe6ca. Run from the repo root:

    npx tsx --import ./scripts/shim-server-only.mjs docs/handoff/int158-securedog/c3.mts

Imports may use absolute Windows paths: adjust them to `src/lib/soft-ai/...` if needed. Pin every bypass as a test
in src/lib/__tests__/int158-confirmation.test.ts with the round-2 fix.
