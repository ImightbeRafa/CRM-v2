# Betsy `/chats` Respond.io-parity — status board (2026-09-20 CR night)

> **Authoritative agent SoT** for what is live vs still open on Soft `/chats`. Prefer this file over stale Notion callouts or outdated code comments when scoping the next slice.

| Field | Value |
|---|---|
| **Repo tip (this board)** | `dev` @ `b5ecd017cf15efdcdaecf523a9248fd27a8d2b5f` — *PR-3: channel identity names and logos* |
| **Plan SoT** | [`docs/plans/betsy-respondio-parity-fable-2026-09-20.md`](../plans/betsy-respondio-parity-fable-2026-09-20.md) |
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

### STILL OPEN — Phases 4–5 GO’d 2026-09-20, not built yet

**P4 scale**

- Revision polling stress / 50k seed load-test
- Template cache
- `ChatAutomationJob` durable Soft AI
- Media Blob cache

**P5 self-serve**

- Server RBAC on connect routes
- IG `isActive=subscribeOk`
- `expiresAt` + token-health cron + Reconectar banners
- Soft-unlink (history kept)
- Store-owner runbook
- Fix `social-accounts.mdx` “history kept” claim

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
| SQL | `supabase/migrations/024_chat_inbox_conversations.sql` · `025_chat_inbox_uniques.sql` |
| Forge pilot runbook | `docs/runbooks/chat-inbox-v2-forge-pilot.md` |

---

## Prove pointers

Merged work on the path to this tip:

- [#42](https://github.com/ImightbeRafa/CRM-v2/pull/42) — PR-1 schema / `024`
- [#44](https://github.com/ImightbeRafa/CRM-v2/pull/44) — PR-2 dual-write + Soft v2 client / `025`
- [#45](https://github.com/ImightbeRafa/CRM-v2/pull/45) — Bugbot follow-ups
- [#46](https://github.com/ImightbeRafa/CRM-v2/pull/46) — PR-3 channel identity
- Plan: [`docs/plans/betsy-respondio-parity-fable-2026-09-20.md`](../plans/betsy-respondio-parity-fable-2026-09-20.md)

**Scope reminder:** Forge pilot only (`cmhsibjue0004js04gie724nx`). Other tenants remain on legacy Soft inbox until the flag is explicitly enabled.
