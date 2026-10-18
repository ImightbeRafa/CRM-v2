# Handoff — Betsy inbox agents (2026-10-18)

For the next session (local or cloud). Owner's open items: Notion "Agents — waiting on Rafael (2026-10-18)".

## Live now
- Production: Cloudflare version 67b5c528 = branch `claudio/luna-10-d2` @ 410cc049.
- PatchHouse agent "Sofi" (cmv8mpajv0001vii8x9cey29a) v54 live on WA + IG, model gpt-6-luna.
- Follow-up A/B campaign fu-2026-10-18-4d727c runs until 2026-10-18T19:04Z
  (report: `scripts/agent-pack/follow-up-campaign.ts --report`).

## Committed, NOT deployed (needs Rafael's GO)
- 29efe6ca on `claudio/luna-10-d2`: INT-158 claim check + per-store exam grader. Verifier PASS WITH NOTES (all folded in).
  SecureDog round 1: FIX BEFORE PROD. The diff only adds blocks (safe), and its one false positive ("Ya te envié los
  datos de pago") is fixed in the next commit. But INT-158 is not closed: High bypasses H1–H4 below remain (they predate
  the diff).

## Pending work
1. INT-158 round 2 (SecureDog H1–H4, each bypass input to be pinned as a test):
   - H1: WhatsApp italics `_confirmado_` pass. The word edges in CONFIRMATION_WORDING_RE treat `_` as a letter; use
     `(?<![\p{L}\p{N}])` / `(?![\p{L}\p{N}])` and map `[_*~\`]` to spaces in normalizeForConfirmationCheck.
   - H2: RTL override (U+202E) + reversed letters display as "confirmado". Strip bidi controls (U+202A–202E,
     U+2066–2069) from the OUTGOING model text, then check and send that same cleaned text.
   - H3: look-alikes outside the map (ı, ɑ, small caps, Armenian, Cherokee, Greek accented, squared letters, i+U+0307).
     For model output, hold the reply if after NFKC+NFC any letter is outside Latin-1 letters or a non-emoji combining
     mark is left; keep the map for owner texts.
   - H4: ALWAYS_PAYMENT_STATUS_REPLY_RE, PAYMENT_STATUS_REPLY_RE, CREATED_CLAIM_RE and ORDER_CLOSING_CLAIM_RE
     (llm/output-validator.ts 28/32/196/202) still read raw text: run them on the normalised text too.
   - M1/M2 phrasing gaps (validar family, "Pago ✅", "se envió", punctuation between words, English) and L1
     (NEL/U+2028 as a space). SecureDog's scratch scripts, prototype and full report: ask the coordinator session
     or re-run the bypass lists from the register entry.
   - Advisor policy from luna-10: prefer structural rules (H1–H4) over adding claim words; new wordings go to the
     Luna payment-check eval set.
   Then Verifier + SecureDog again, then deploy with Rafael's GO (`npx wrangler deploy --keep-vars` from the
   live-line worktree; retry on next/font "reading '1'" or V8 fatal errors).
2. New store agents (drafts, tenant cmhsibjue0004js04gie724nx, packs in D:\Coder\betsy-agent-packs\<brand>, each
   with STATUS.md):
   - Sleeping Patches "Vale" (cmv9xf14x0001vitkkhx2vxd4): answers applied (v54); exams pending/running.
   - Pura Sonrisa "Laura": build in progress.
   - Prototipo "Dani" (cmvdaghtc0001vi98x3abfr1r): draft bound to its WA for tests; needs the InventoryItem.
   - Forge "Andrés" (cmub1rziw0005l704mebpx4xc) and DeepClean "Caro" (cmvdakou70001vi209salflsn): ON HOLD.
   Rules: payment, pickup and hours = PatchHouse's; unique agent names; never activate without Rafael.
3. AI terms update (remove xAI, bump AI_TERMS_VERSION) + delete XAI_* Cloudflare secrets: only when Rafael can
   re-accept immediately.
4. DATA-65: exam-bank.ts redacts only the contact's name (other names, IG links, tracking numbers leak into banks).
5. Code notes from the build sessions: build-agent doesn't retire old replies/docs or create missing sys_ replies;
   shoppers.ts personas are PatchHouse-specific (packs use pack.exam.personas); tenant saved-test limit reached.

## Testing rules
- Exams/shoppers/shadow run from the live-line worktree with `.env.local` (needs SOFT_AI_OPENAI_API_KEY and the prod
  DB). One run per tenant at a time (test-session.ts lock); never raise the cap by hand while builds run.
- Never `prisma db push`/migrate; never process ChatAutomationJobs locally; no deploys/secrets/DNS without Rafael.

## Cloud sessions: what's missing
- Agent packs are in the private repo https://github.com/ImightbeRafa/betsy-agent-packs (branch main). Exam banks,
  run results and pack backups are gitignored: real customer chats never go to git.
- The prod DB URL and the OpenAI test key are not cloud secrets.
- Until they are set up, agent builds and exams must run on Rafael's PC; cloud sessions can do code-only work
  (fixes, tests, reviews) on the GitHub branches.
