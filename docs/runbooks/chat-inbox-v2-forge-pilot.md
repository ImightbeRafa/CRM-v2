# Chat inbox v2 — Forge pilot (`chat_inbox_v2`)

> **Live status:** [`docs/status/betsy-chats-respondio-2026-09-20.md`](../status/betsy-chats-respondio-2026-09-20.md) (Phases 1–3 live; Forge pilot only).

Server-grouped Soft inbox (PR-2 Phase 2). **Default off globally.** Enable only for the Forge pilot tenant:

`cmhsibjue0004js04gie724nx`

## Prerequisites

- Migration `024_chat_inbox_conversations.sql` applied on Supabase.
- Backfill verified (`npm run chat:inbox:verify`).
- **Do not apply `025_chat_inbox_uniques.sql` in this rollout** — unique constraints stay gated until duplicate verify = 0.

## Enable flag (pilot tenant only)

```sql
INSERT INTO "TenantFeatureFlag" (id, "tenantId", scope, key, enabled, config, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'cmhsibjue0004js04gie724nx',
  'cmhsibjue0004js04gie724nx',
  'chat_inbox_v2',
  true,
  '{}'::jsonb,
  now(),
  now()
)
ON CONFLICT DO NOTHING;

-- If row exists:
UPDATE "TenantFeatureFlag"
SET enabled = true, "updatedAt" = now()
WHERE "tenantId" = 'cmhsibjue0004js04gie724nx'
  AND scope = 'cmhsibjue0004js04gie724nx'
  AND key = 'chat_inbox_v2';
```

Or dry-run then apply cutover read baselines:

```bash
npx tsx scripts/chat-inbox-v2-cutover.ts --tenant=cmhsibjue0004js04gie724nx
npx tsx scripts/chat-inbox-v2-cutover.ts --tenant=cmhsibjue0004js04gie724nx --apply
```

Cutover sets each active member’s `readInboundCount = inboundCount` (history shows as read). Skip `--apply` if you prefer agents to see historical unread.

## Verify

1. Log in as a Forge user with `update_sales`.
2. Open `/chats` — network should hit `/api/chat/conversations` (not per-account `/api/chat/messages` polling).
3. Toggle status/tags — `PATCH /api/chat/conversations/:id`.
4. Open a thread — `POST …/read` clears unread for that user only.

## Rollback

```sql
UPDATE "TenantFeatureFlag"
SET enabled = false, "updatedAt" = now()
WHERE "tenantId" = 'cmhsibjue0004js04gie724nx'
  AND key = 'chat_inbox_v2';
```

Clients fall back to legacy inbox immediately (no code deploy required).
