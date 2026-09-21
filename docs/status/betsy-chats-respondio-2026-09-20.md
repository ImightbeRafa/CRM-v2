# Betsy `/chats` Respond.io-parity — status board (2026-09-20 CR night)

> **Authoritative agent SoT** for what is live vs still open on Soft `/chats`. Prefer this file over stale Notion callouts or outdated code comments when scoping the next slice.

| Field | Value |
|---|---|
| **Repo tip (this board)** | `dev` @ `bd70517` (PR-5 #51 *Respond.io PR-5: self-serve Meta and token health*) — **Phases 1–5 LIVE** on www |
| **Plan SoT** | [`docs/plans/betsy-respondio-parity-fable-2026-09-20.md`](../plans/betsy-respondio-parity-fable-2026-09-20.md) |
| **Next plan (A0 GO'd + amended 2026-09-21)** | [`docs/plans/betsy-agent-layer-fable-2026-09-21.md`](../plans/betsy-agent-layer-fable-2026-09-21.md) — Agent Layer (SocialAccount → ChatAgent, Forge WA `cmuahn5y90001l504y6kksiek` pilot, Grok 4.6 only, new agents `ai_suggest`, 90-day `outputText`). §8 decided; Advisor musts 1–8 are A1 blockers. **A1 code = next PR after #53 squash-merge.** |
| **Notion** | [Betsy Chat — Full Implementation](https://app.notion.com/p/3cdbc39c41ae81968b64d25201be0676) · [Respond.io epic](https://app.notion.com/p/3d6bc39c41ae819b8994f3e2e6059977) |
| **Feature flag** | `chat_inbox_v2` — **enabled for Forge tenant `cmhsibjue0004js04gie724nx` only** (default off globally) |
| **SQL applied live** | `024_chat_inbox_conversations.sql` + `025_chat_inbox_uniques.sql` on Supabase project `db.bmolvybsqzkeswkomgzw` |
| **Pilot runbook** | [`docs/runbooks/chat-inbox-v2-forge-pilot.md`](../runbooks/chat-inbox-v2-forge-pilot.md) |

**Do not claim all tenants are on inbox v2.** Only the Forge pilot flag is on.

---

## Done vs Still-open vs Blocked

### DONE — Phases 1–3 live on www

| Slice | What shipped |
|---|---|
| Soft Copilot `/chats` + Connect (#34–#36) | Soft inbox UI + Connect flows |
| Full-AI operator (#37) | Soft AI monitor / takeover |
| Inbox Meta app split | Inbox app `1038331905909624` separate from staff bot app `1514613536240301` |
| WA coexistence (#38) + ownership verify (#40) | Business App numbers; Forge `+506 6104 3737` bidirectional send+receive proven |
| **PR-1 #42** | Migration `024` — `ChatConversation` + identity columns + backfill/verify |
| **PR-2 #44** | Dual-write, conversation API, Soft client behind `chat_inbox_v2`, migration `025` uniques |
| **Bugbot #45** | Send/echo, Soft AI escalate, direct-oauth, cursor fixes |
| **PR-3 #46** | `displayName`, `ChannelLogo`, Renombrar, IG numeric-id bugfix — Rafael eye OK |

### DONE — Phase 4 scale (PR-4 #50, `026` applied) and Phase 5 self-serve (PR-5 #51)

**P4 scale — checklist**

| Item | Status |
|---|---|
| Local-only seed (`scripts/chat-scale-seed.ts`, 5 acct / 2k conv / 50k msg) | **Shipped** — requires `CHAT_SCALE_DATABASE_URL` loopback; refuses Supabase / 6543 |
| Bench list + changes idle p50/p95 + EXPLAIN (`chat-scale-benchmark.ts`) | **Shipped** — report `docs/audits/chat-phase4-scale-report.md` |
| Fill report numbers on local Postgres | **Pending** — Cloud Agent has no Docker/local Postgres; never seed shared Supabase |
| Webhook burst 500/60s unit (`chat-webhook-burst.ts` + fixture) | **Shipped** (in-memory dual-write mock) |
| Idle network ≤1 req/5s assert (`chat-idle-network-assert.ts`) | **Shipped** (validates `CHAT_INBOX_V2_POLL_MS`) |
| Template cache | **Shipped** (PR-4) |
| `ChatAutomationJob` durable Soft AI (026) | **Shipped** — `026` applied on Supabase 2026-09-20 (`ChatAutomationJob` + `ChatAutomationDelivery`, RLS on) |
| Media Blob cache | **Shipped** (PR-4; Blob paths only, never Meta URLs) |

npm: `chat:scale:seed` · `chat:scale:bench` · `chat:webhook:burst` · `test:chat-scale` · `test:chat-automation`

**P5 self-serve — DONE in PR-5 #51 (merged → `bd70517`)**

- Server RBAC on `/config/social` + WA/IG connect routes (`update_config`)
- IG `isActive=subscribeOk` + Re-suscribir copy
- Real `expiresAt` + daily `/api/cron/chat-token-health` + Reconectar banners
- Soft-unlink (history kept; same `SocialAccount.id` on reconnect)
- Store-owner runbook + `social-accounts.mdx` history claim fixed

Still Meta-blocked for non-tester IG: Advanced Access / App Review (ops).

### NEXT — Agent Layer A1 (A0 plan GO'd + amended 2026-09-21 CR, PR #53)

Rafael GO 2026-09-21 CR: make `/chats` agent-driven (Respond.io-style AI Agents). Binding **SocialAccount → ChatAgent** (Forge WA ≠ Forge IG) with tenant default fallback; **Forge WhatsApp sales agent** pilot (`SocialAccount.id` `cmuahn5y90001l504y6kksiek`, +506 6104 3737 "Forge Costa Rica"); **Grok 4.6 only**; new agents default `ai_suggest`; `ChatAgentTurn.outputText` 90 days. Plan: [`docs/plans/betsy-agent-layer-fable-2026-09-21.md`](../plans/betsy-agent-layer-fable-2026-09-21.md) — **§8 is decided**; §2.5 gates + §2.7 operator surfaces (Probar, panic controls, trust labels) + Advisor musts 1–8 are **A1 blockers** with tests 1.11–1.22. Hard gate: no `ai_full` Meta send until the dark/`ai_suggest` pass is recorded in `aiFullUnlock`. Today's Soft AI worker is a regex heuristic (no LLM); A1 swaps the turn runtime behind a new default-off flag `chat_agent_layer_v1`. **A1 opens after #53 squash-merge.**

### BLOCKED — Meta ops / product HOLD

| Item | Why blocked |
|---|---|
| Customer-scale IG Advanced Access / App Review | Testers work; non-testers need Advanced Access |
| Soft UX redesign **Phase 6 HOLD** | 11-point brief remains HOLD (see Notion Soft UX redesign brief) |

---

## Locks (still bind every follow-on PR)

| Lock | Consequence |
|---|---|
| **Staff bot HARD LOCK** | Do not touch `src/lib/bot/**`, `src/app/api/bot/**`, or `WHATSAPP_*` on CRM/inbox paths. Inbox uses Inbox Meta app + `META_WA_*` only. Agent Layer LLM runtime gets its own client under `src/lib/soft-ai/llm/**`. |
| **Soft chrome LOCKED** | Do not edit `SoftSlimNav`, `SoftInboxBuckets`, `SoftCopilotRail` until Phase 6 GO. |
| **No prisma migrate / db push** | Additive SQL only (`supabase/migrations/024+_*.sql`; Agent Layer = `027+`); never `prisma db push` / `prisma migrate` against Supabase (drops raw-SQL `lm_*`). |

---

## Key paths (brief)

| Area | Path |
|---|---|
| Inbox webhook | `src/app/api/chat/webhook/route.ts` |
| Send | `src/app/api/chat/send/route.ts` |
| Conversations API | `src/lib/chat-conversation-api.ts` · related `/api/chat/*` |
| Dual-write / conversation write | `src/lib/chat-conversation-write.ts` |
| Channel logo / display name | `src/components/social/ChannelLogo.tsx` · `src/lib/social-account-identity.ts` |
| Social connect UI | `src/app/config/social/page.tsx` |
| Feature flag | `src/lib/feature-flags.ts` · key `chat_inbox_v2` |
| SQL | `supabase/migrations/024_chat_inbox_conversations.sql` · `025_chat_inbox_uniques.sql` |
| Forge pilot runbook | `docs/runbooks/chat-inbox-v2-forge-pilot.md` |

---

## Prove pointers

Merged work on the path to this tip:

- [#42](https://github.com/ImightbeRafa/CRM-v2/pull/42) — PR-1 schema / `024`
- [#44](https://github.com/ImightbeRafa/CRM-v2/pull/44) — PR-2 dual-write + Soft v2 client / `025`
- [#45](https://github.com/ImightbeRafa/CRM-v2/pull/45) — Bugbot follow-ups
- [#46](https://github.com/ImightbeRafa/CRM-v2/pull/46) — PR-3 channel identity
- [#50](https://github.com/ImightbeRafa/CRM-v2/pull/50) — PR-4 scale and reliability (`026` applied after merge)
- [#51](https://github.com/ImightbeRafa/CRM-v2/pull/51) — PR-5 self-serve Meta and token health
- Plan: [`docs/plans/betsy-respondio-parity-fable-2026-09-20.md`](../plans/betsy-respondio-parity-fable-2026-09-20.md)
- Next plan (A0): [`docs/plans/betsy-agent-layer-fable-2026-09-21.md`](../plans/betsy-agent-layer-fable-2026-09-21.md)

**Scope reminder:** Forge pilot only (`cmhsibjue0004js04gie724nx`). Other tenants remain on legacy Soft inbox until the flag is explicitly enabled.
