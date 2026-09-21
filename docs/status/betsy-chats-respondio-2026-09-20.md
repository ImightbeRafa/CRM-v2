# Betsy `/chats` Respond.io-parity — status board (2026-09-20 CR night)

> **Authoritative agent SoT** for what is live vs still open on Soft `/chats`. Prefer this file over stale Notion callouts or outdated code comments when scoping the next slice.

| Field | Value |
|---|---|
| **Repo tip (this board)** | `dev` @ `bd70517` (PR-5 #51 merged) — Phases **1–5** live |
| **Plan SoT** | [`docs/plans/betsy-respondio-parity-fable-2026-09-20.md`](../plans/betsy-respondio-parity-fable-2026-09-20.md) |
| **Notion** | [Betsy Chat — Full Implementation](https://app.notion.com/p/3cdbc39c41ae81968b64d25201be0676) · [Respond.io epic](https://app.notion.com/p/3d6bc39c41ae819b8994f3e2e6059977) · [Betsy Agent Layer — brainstorm (2026-09-21)](https://app.notion.com/p/3e2bc39c41ae81fab6e7c140983969c4) |
| **Feature flag** | `chat_inbox_v2` — **enabled for Forge tenant `cmhsibjue0004js04gie724nx` only** (default off globally) |
| **SQL applied live** | `024_chat_inbox_conversations.sql` + `025_chat_inbox_uniques.sql` + `026_chat_automation_jobs.sql` (`ChatAutomationJob`) on Supabase project `db.bmolvybsqzkeswkomgzw` |
| **Pilot runbook** | [`docs/runbooks/chat-inbox-v2-forge-pilot.md`](../runbooks/chat-inbox-v2-forge-pilot.md) |

**Do not claim all tenants are on inbox v2.** Only the Forge pilot flag is on.

---

## Done vs Still-open vs Blocked

### DONE — Phases 1–5 live on www

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
| **PR-4 #50** | Scale & reliability: revision polling, thread windowing, WABA template cache, durable Soft AI `ChatAutomationJob` (`026`), media Blob cache, load-test tooling |
| **PR-5 #51** | Self-serve Meta: server RBAC on `/config/social` + WA/IG connect; IG `isActive=subscribeOk`; real `expiresAt` + daily token-health cron + Reconectar; soft-unlink (history kept) |

**P4 scale (#50) — shipped checklist**

| Item | Status |
|---|---|
| Local-only seed (`scripts/chat-scale-seed.ts`, 5 acct / 2k conv / 50k msg) | **Shipped** — requires `CHAT_SCALE_DATABASE_URL` loopback; refuses Supabase / 6543 |
| Bench list + changes idle p50/p95 + EXPLAIN (`chat-scale-benchmark.ts`) | **Shipped** — report `docs/audits/chat-phase4-scale-report.md` |
| Webhook burst 500/60s unit (`chat-webhook-burst.ts` + fixture) | **Shipped** (in-memory dual-write mock) |
| Idle network ≤1 req/5s assert (`chat-idle-network-assert.ts`) | **Shipped** (validates `CHAT_INBOX_V2_POLL_MS`) |
| Template cache | **Shipped** — per-WABA ~5 min (Upstash / memory) |
| `ChatAutomationJob` durable Soft AI (`026`) | **Shipped** + SQL live |
| Media Blob cache | **Shipped** — `providerMediaId` → private Betsy Blob |

npm: `chat:scale:seed` · `chat:scale:bench` · `chat:webhook:burst` · `test:chat-scale` · `test:chat-automation`

**P5 self-serve (#51) — shipped**

- Server RBAC on `/config/social` + WA/IG connect routes (`update_config`)
- IG `isActive=subscribeOk` + Re-suscribir copy
- Real `expiresAt` + daily `/api/cron/chat-token-health` + Reconectar banners
- Soft-unlink (history kept; same `SocialAccount.id` on reconnect)
- Store-owner runbook + `social-accounts.mdx` history claim fixed

### STILL OPEN

| Item | Notes |
|---|---|
| **Agent Layer** (planning only) | Next product slice — assignable agents / tunable behavior. Brainstorm under Betsy Chat hub: [Betsy Agent Layer — brainstorm (2026-09-21)](https://app.notion.com/p/3e2bc39c41ae81fab6e7c140983969c4). No code yet. |
| Soft UX redesign **Phase 6 HOLD** | 11-point brief remains HOLD (see Notion Soft UX redesign brief). Not the next build target. |
| Customer-scale IG Advanced Access / App Review | Testers work; non-testers need Advanced Access (Meta ops). |
| Rolling `chat_inbox_v2` beyond Forge | Flag remains Forge-only (`cmhsibjue0004js04gie724nx`) until explicitly enabled per tenant. |

### BLOCKED — Meta ops / product HOLD

| Item | Why blocked |
|---|---|
| Customer-scale IG Advanced Access / App Review | Testers work; non-testers need Advanced Access |
| Soft UX redesign **Phase 6 HOLD** | 11-point brief remains HOLD (see Notion Soft UX redesign brief) |

---

## Locks (still bind every follow-on PR)

| Lock | Consequence |
|---|---|
| **Staff bot HARD LOCK** | Do not touch `src/lib/bot/**`, `src/app/api/bot/**`, or `WHATSAPP_*` on CRM/inbox paths. Inbox uses Inbox Meta app + `META_WA_*` only. |
| **Soft chrome LOCKED** | Do not edit `SoftSlimNav`, `SoftInboxBuckets`, `SoftCopilotRail` until Phase 6 GO. |
| **No prisma migrate / db push** | Additive SQL only (`supabase/migrations/024+_*.sql`); never `prisma db push` / `prisma migrate` against Supabase (drops raw-SQL `lm_*`). |

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
| SQL | `supabase/migrations/024_chat_inbox_conversations.sql` · `025_chat_inbox_uniques.sql` · `026_chat_automation_jobs.sql` |
| Forge pilot runbook | `docs/runbooks/chat-inbox-v2-forge-pilot.md` |

---

## Prove pointers

Merged work on the path to this tip:

- [#42](https://github.com/ImightbeRafa/CRM-v2/pull/42) — PR-1 schema / `024`
- [#44](https://github.com/ImightbeRafa/CRM-v2/pull/44) — PR-2 dual-write + Soft v2 client / `025`
- [#45](https://github.com/ImightbeRafa/CRM-v2/pull/45) — Bugbot follow-ups
- [#46](https://github.com/ImightbeRafa/CRM-v2/pull/46) — PR-3 channel identity
- [#50](https://github.com/ImightbeRafa/CRM-v2/pull/50) — PR-4 scale & reliability / `026` (`ChatAutomationJob`, template cache, media Blob)
- [#51](https://github.com/ImightbeRafa/CRM-v2/pull/51) — PR-5 self-serve Meta / soft-unlink / token health
- Plan: [`docs/plans/betsy-respondio-parity-fable-2026-09-20.md`](../plans/betsy-respondio-parity-fable-2026-09-20.md)
- Agent Layer brainstorm (planning): [Betsy Agent Layer — brainstorm (2026-09-21)](https://app.notion.com/p/3e2bc39c41ae81fab6e7c140983969c4)

**Scope reminder:** Forge pilot only (`cmhsibjue0004js04gie724nx`). Other tenants remain on legacy Soft inbox until the flag is explicitly enabled.
