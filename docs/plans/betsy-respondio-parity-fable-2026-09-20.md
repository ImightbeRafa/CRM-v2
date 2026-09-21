# Betsy `/chats` → Respond.io-class omnichannel inbox — phased plan

- **Author:** Fable 5.1 (Cursor cloud, planning only) · **Advisor review:** Sol `gpt-5.6-sol-high` (see §11)
- **Date:** 2026-09-20 (CR) · **Repo:** `ImightbeRafa/CRM-v2` · **Investigated tip:** `dev` @ `b71aaff` (#40)
- **Status:** PLAN (Advisor-reviewed) — no product code. Nothing here is GO'd. Rafael approvals listed in §9.
- **Notion SoT:** [Betsy Chat — Full Implementation](https://app.notion.com/p/3cdbc39c41ae81968b64d25201be0676) · [Respond.io epic](https://app.notion.com/p/3d6bc39c41ae819b8994f3e2e6059977) · [Soft UX redesign brief (HOLD)](https://app.notion.com/p/3d8bc39c41ae81cb9b13e094ebf9c9e9)

## Locks that bind every phase

| Lock | Consequence for this plan |
|---|---|
| Staff bot HARD LOCK (`/api/bot/whatsapp/webhook`, `WHATSAPP_*`, Meta app `1514613536240301`) | No file under `src/lib/bot/**` or `src/app/api/bot/**` is touched. Inbox uses `META_WA_*` / Inbox app `1038331905909624` only. Every PR re-runs `test:soft-meta-wait-iron` (send path must not use `WHATSAPP_ACCESS_TOKEN`). |
| Soft visual chrome LOCKED until redesign GO | `SoftSlimNav.tsx`, `SoftInboxBuckets.tsx`, `SoftCopilotRail.tsx` are read-only. Channel badges/filters plug into *data* components only (`SoftConversationList.tsx`, `SoftThreadPane.tsx`, `SoftCopilotInbox.tsx`). Phase 6 (visual) is HOLD. |
| No `prisma db push` / `prisma migrate` on Supabase (drops raw-SQL `lm_*`) | All schema work = additive SQL in `supabase/migrations/024+_*.sql` (`IF NOT EXISTS`, expand-only) + matching `schema.prisma` edit, applied through the gated `scripts/apply-betsy-v2-additive-sql.mjs` flow with human approval. Ledger: `docs/audits/BETSY_V2_PROD_SQL_REVIEW.md`. |
| Fat PRs; Cursor sole writer; CoS merges only on Rafael GO | Phase → PR mapping in §5. No PR opens before §9 approvals. |
| No live ads / Social Manager frozen | Out of scope entirely. |

---

## 1. Current state — Done vs Still-open vs Blocked (Meta ops)

### 1.1 Proven DONE (code on `dev` `b71aaff`, prod www)

| Item | Evidence |
|---|---|
| Soft Copilot `/chats` + Connect UI (#34–#36), Full-AI tenant operator with monitor/takeover (#37) | `src/components/chats/*`, `src/lib/soft-ai/**`, `/api/chat/soft-ai/*` |
| Dedicated Inbox Meta app `1038331905909624`; staff bot app separate | `META_WA_APP_*` env split in `src/lib/meta-api.ts:14-46`; inbox webhook `/api/chat/webhook` vs bot `/api/bot/whatsapp/webhook` |
| WA Embedded Signup incl. **coexistence** (Business App numbers) (#38) + ownership verify fix (#40) | `src/lib/whatsapp-embedded-signup.ts`, `/api/auth/whatsapp/exchange`, `verifyWhatsAppAssetsForToken` |
| Forge `+506 6104 3737` connected; bidirectional send+receive proven in `/chats` (human takeover) 2026-09-20 | Notion 2026-09-20 callout |
| Tenant-safe webhook account resolution (refuses cross-tenant ambiguity) | `src/lib/chat-webhook-account.ts` |
| Encrypted `SocialAccount.accessToken`; RBAC `/chats` = `update_sales`; rate limits; message cursor pagination; WA template picker with server-side APPROVED gate; 24h window CTA | `/api/chat/messages`, `/api/chat/send`, `/api/chat/templates`, `chat-soft-copilot.ts` |
| Multi-account **storage** already possible: `@@unique([platform, accountId, tenantId])`; `/config/social` has “Agregar otro/otra” | `schema.prisma:849`, `page.tsx:545-574` |
| Test harness: `node:test` via `npx tsx --test`; `npm run test:chat-harden` (12 files), `test:soft-ai`, `test:security` | `package.json:19-24` |

### 1.2 STILL OPEN (product / code)

| Gap | Where it hurts | Evidence |
|---|---|---|
| **No channel display name.** `SocialAccount` has no `displayName` / `verified_name` / `display_phone_number` / IG `username`. UI labels are `WA · …last6 of phone_number_id` and `IG · @<numeric id>` (bug: numeric id shown as handle). | Agents cannot tell Forge from another number; multi-channel ops unusable | `schema.prisma:833-851`; `chat-soft-copilot.ts:38-46`; names fetched then discarded at `meta-api.ts:596` (`verified_name`), `meta-api.ts:302-315` (`displayPhoneNumber`), `instagram/complete/route.ts:127-128` (`igUsername`) |
| **No WA/IG logos**; only text chips and initials avatars | Channel identity requirement | `SoftConversationList.tsx:39,243-267`; `SoftThreadPane.tsx:136-144` |
| **No `Conversation` model.** Threads are grouped in the browser from flat `ChatMessage`; peer id lives only in `metadata.from/to/waId` (JSON) | Blocks unread/assignment/status server-side; blocks scale | `chat-inbox.ts:74-125`; `chat-message-query.ts:6-39` (JSON-path filters) |
| **Client dumps messages:** polls **every active account every 4 s** with `limit=100`, merges in memory, regroups everything, fingerprints all ids | O(N accounts × 100) per 4 s; at 5k msgs every poll rebuilds all groups on the main thread | `SoftCopilotInbox.tsx:63-64,247-369` |
| **Status / tags / agent-state live in `localStorage`** (per browser) — not shared between agents | Multi-user inconsistency; agent-state does have server truth in `TenantFeatureFlag.config.agentState` | `chat-soft-copilot.ts:13-14,220-259`; `soft-ai/agent-state.ts:9`; `soft-ai/control/route.ts:54-67` |
| **Webhook idempotency is check-then-insert on an unindexed JSON path**; no unique constraint; skipped when `providerMessageId` missing | Meta retries + concurrent deliveries can double-insert; sequential scans grow with table | `webhook/route.ts:59-79,110-127`; indexes only `[tenantId, socialAccountId, sentAt]` |
| **Delivery statuses discarded** (WA `statuses`, IG `read`/`delivery`); IG `is_echo` dropped while WA SMB echoes stored | No ✓✓ ticks; coexistence asymmetry | `meta-chat.ts:128-130,297-375` |
| **Webhook never sets `clientId`**; `Client` has no IG id column | No customer context / identity merge | `webhook/route.ts:110-127`; `schema.prisma` `Client` |
| **`refreshToken` column abused** to carry `waba:<id>` / `page:<id>` | Fragile; blocks storing a real refresh token | `social-account-meta.ts` |
| **Token health:** WA `expires_in` logged only, `expiresAt` not set; IG hard-coded +60 d; no refresh/health job; no “reconnect” banner | Silent channel death | `exchange/route.ts:136-139`; `instagram/callback/route.ts:43-74` |
| **IG `isActive` ignores subscribe failure** (WA requires subscribe) | IG “connected” but receives nothing | `instagram/complete/route.ts:247-265` |
| **Unlink hard-deletes the row → CASCADE deletes all `ChatMessage`** (docs say history kept) | Data loss on reconnect / renumber | `unlink/route.ts:43-48`; `schema.prisma:866`; `social-accounts.mdx:66-68` |
| **RBAC mismatch for self-serve:** `/config/social` gate is client-side (OWNER or MASTER); `/api/social/*` = `update_config` (OWNER+ADMIN, `rbac.ts:45,64`); `/api/auth/whatsapp/exchange` + IG OAuth routes only require a tenant session | Weaker than UI implies; must be server-gated before self-serve is advertised | `config/social/page.tsx:104-106`, `layout.tsx:6-7`; `exchange/route.ts:35-38` |
| **`GET /api/auth/whatsapp/direct-oauth` is fully unauthenticated** and its CSRF `state` is generated and returned but never persisted or validated on callback (Advisor finding, verified) | Open OAuth-URL minting; CSRF gap on the fallback WA path | `direct-oauth/route.ts:14-50` |
| **Additive-SQL apply script hard-codes migrations `018`–`023`** (`FILES`, `EXPECTED_TABLES`) | `024`/`025` cannot be applied through the gated path until the script is extended with postcondition checks | `scripts/apply-betsy-v2-additive-sql.mjs:22-40` |
| **Webhook rate limit 120/min per IP** — Meta sends from a handful of IPs; coexistence history sync can burst hundreds of events/min | Legit Meta traffic throttled at scale | `rate-limit.ts:195-199` |
| **Templates fetched from Graph on every send and every picker open**; no cache | Latency + Graph quota | `send/route.ts:197-241`; `templates/route.ts` |
| **Soft AI post-inbound is fire-and-forget `void`** | Lost replies on function timeout; no retry (staff bot already has a lease pattern) | `webhook/route.ts:270-278`; contrast `src/lib/bot/inbox.ts` |

### 1.3 BLOCKED on Meta ops (not code)

| Item | Owner | Notes |
|---|---|---|
| IG Advanced Access / App Review for `instagram_manage_messages`, `pages_messaging`, `pages_manage_metadata` at **customer** scale | CoS (Tech Provider) | Dev-mode/testers work today; real customers need Live + Advanced Access. Notion: “IG App Review pack no Submit” — needs Rafael GO to Submit. |
| Business Verification: **Done/Verificado** (2026-09-11) | — | Unblocks WA Tech Provider path (done). |
| WA Embedded Signup config `1886311709005467` on Inbox app (never `1075961411822336`) | — | Live in Vercel Production. |
| Meta brand asset usage (WA / IG logos) | Rafael | Must follow Meta Brand Resource Center rules (unaltered glyph, clear space, no recolor of IG gradient beyond mono). §7.4. |

---

## 2. Respond.io parity gap matrix

Legend: **M** = must for “Respond.io-class for all tenants”, **S** = should, **L** = later. State: ✅ done · 🟡 partial · ❌ missing.

| Capability | Respond.io | Betsy today | Prio | Phase |
|---|---|---|---|---|
| Multiple WA numbers per workspace in one inbox | ✅ | 🟡 storable, not operable (no names/logos, N× polling) | **M** | 1–3 |
| Multiple IG accounts per workspace | ✅ | 🟡 same | **M** | 1–3 |
| Channel display name + channel icon on every row/thread | ✅ | ❌ | **M** | 3 |
| Add channel self-serve (owner, no vendor clicks) | ✅ | 🟡 WA Embedded Signup + IG OAuth exist; RBAC/health gaps | **M** | 5 |
| Server-side Conversation entity (status, unread, last message) | ✅ | ❌ | **M** | 1–2 |
| Conversation list pagination + server filters (channel, account, status, search) | ✅ | ❌ (client filters over in-memory) | **M** | 2, 4 |
| Thread pagination / load older | ✅ | ✅ (cursor) | — | — |
| Realtime-ish updates | ✅ WS | 🟡 4 s full re-poll | **M** | 4 |
| Webhook idempotency (exactly-once storage) | ✅ | 🟡 race-prone | **M** | 1 |
| Delivery/read receipts (✓ ✓✓) | ✅ | ❌ | **S** | 4 |
| Human ↔ AI takeover | ✅ (workflows) | ✅ (Soft, tenant-scoped server truth) | — | keep |
| 24h window + templates | ✅ | ✅ (client window calc + server APPROVED gate) | — | move window to DB (2) |
| Assignment to agent | ✅ | ❌ (buckets are chrome over localStorage) | **S** | 2 |
| Shared tags / status across agents | ✅ | ❌ (localStorage) | **S** | 2 |
| Contact record + identity merge (same person WA+IG) | ✅ | ❌ (`clientId` never set) | **S** | 2 (WA phone→Client), L (IG merge) |
| Token health + reconnect prompts | ✅ | ❌ | **M** | 5 |
| Media (image/audio/doc) inline | ✅ | 🟡 stored as `[image]` text | **S** | 4 |
| Internal notes on thread | ✅ | ❌ | **L** | 6+ |
| Canned replies / snippets | ✅ | 🟡 WA templates only | **L** | 6+ |
| Broadcast / campaigns | ✅ | ❌ | **L** (ads frozen) | — |
| Per-user unread / read receipts for agents | ✅ | ❌ | **L** | 6+ |
| Additional channels (Messenger, Telegram customer, email) | ✅ | ❌ | **L** | — |
| Analytics (response time, volume per channel) | ✅ | ❌ | **L** | after 4 |

---

## 3. Target architecture (minimal-invasive extension, not rewrite)

The existing foundation (tenant-safe webhook resolution, encrypted tokens, Embedded Signup/coexistence, Soft AI server truth) is sound. The three structural debts are: (1) no `Conversation` row, (2) identity fields not persisted on `SocialAccount`, (3) client-side aggregation. Everything below is additive.

### 3.1 Schema (additive SQL `024`, `025` + `schema.prisma` mirror)

**`SocialAccount` — new nullable columns** (no backfill required to deploy):

| Column | Type | Purpose |
|---|---|---|
| `displayName` | text NULL | User-editable channel name (“Forge”). §7 spec. |
| `providerDisplayName` | text NULL | WA `verified_name` / IG Page name |
| `providerUsername` | text NULL | IG `username` (without `@`) |
| `displayPhoneNumber` | text NULL | WA `display_phone_number` (E.164-ish as Meta returns) |
| `wabaId` | text NULL | Real column; `parseSocialRefreshToken` remains as read fallback |
| `pageId` | text NULL | Same |
| `avatarUrl` | text NULL | IG profile picture (optional, later) |
| `tokenStatus` | text NOT NULL DEFAULT `'unknown'` | `valid` · `expiring` · `expired` · `revoked` · `error` · `unknown` |
| `tokenLastCheckedAt`, `subscribedAt`, `lastWebhookAt`, `lastSendAt`, `lastErrorAt` | timestamp NULL | Health signals |
| `lastErrorCode` | text NULL | Last Graph error code |
| `disconnectedAt` | timestamp NULL | Soft-unlink marker (replaces hard delete) |

Indexes: `SocialAccount(tenantId, isActive, platform)`. In `025`, after an audit finds zero collisions: **partial global unique `("platform","accountId") WHERE "isActive" = true`** — one Meta asset may actively deliver into exactly one tenant, which is the ambiguity the webhook resolver currently has to refuse at runtime (`chat-webhook-account.ts:28-59`). Logo is derived from `platform`, never stored.

**New table `ChatConversation`** (one row per `(socialAccountId, peerId)`):

| Column | Type | Notes |
|---|---|---|
| `id` | text PK (cuid) | |
| `tenantId` | text NOT NULL FK Tenant | |
| `socialAccountId` | text NOT NULL FK SocialAccount | Channel the thread belongs to |
| `peerId` | text NOT NULL | WA `wa_id` digits / IG IGSID |
| `peerName`, `peerAvatarUrl` | text NULL | From webhook profile / IG user fetch |
| `clientId` | text NULL FK Client | Phase 2: WA `normalizedPhone` match; IG merge later |
| `status` | text NOT NULL DEFAULT `'nuevo'` | Reuse Soft vocabulary `nuevo` · `en_curso` · `hecho` (existing `ConversationStatus` type) |
| `assignedUserId` | text NULL FK User | Assignment (Phase 2) |
| `aiMode` | text NULL | `ai_active` · `paused` · `human`; NULL = inherit tenant default, resolved fail-closed. Replaces `TenantFeatureFlag.config.agentState` (Phase 2, migrate + keep old read fallback one release). |
| `tags` | text[] NOT NULL DEFAULT `'{}'` | Shared tags v1 (Soft has 3 fixed tags). Normalized `ConversationTag`/`ConversationTagAssignment` tables (name, color, unique per tenant) are the **L** upgrade when tenants need custom tags. |
| `lastMessageId`, `lastMessageAt` | text NULL / timestamp NOT NULL | Sort key; cursor = `(lastMessageAt, id)` |
| `lastMessagePreview` | text NULL | ≤ 120 chars |
| `lastMessageDirection` | text NULL | |
| `lastInboundAt`, `lastOutboundAt` | timestamp NULL | 24h window = `lastInboundAt + 24h` (WA) computed server-side |
| `inboundCount` | int NOT NULL DEFAULT 0 | Incremented only when a **new** inbound row was inserted; unread = `inboundCount − readInboundCount` (see read state) |
| `messageCount` | int NOT NULL DEFAULT 0 | |
| `snoozedUntil`, `closedAt` | timestamp NULL | Optional; only if status set includes `snoozed`/`closed` (§9 #2) |
| `revision` | bigint NOT NULL | From a Postgres sequence via `BEFORE UPDATE` trigger; drives delta polling (monotonic, no clock skew) |
| `createdAt`, `updatedAt` | timestamp | |

**`ChatConversationReadState`** (per-user read, recommended from day one — cheap and avoids re-doing unread later): `{ id, tenantId, conversationId FK, userId FK, readInboundCount int, lastReadAt, lastReadMessageId }`, `UNIQUE (conversationId, userId)`, `INDEX (tenantId, userId)`. Cutover baseline (§9 #3): seed all active members as “read up to now” or expose history as unread.

Constraints/indexes:

```sql
UNIQUE ("tenantId", "socialAccountId", "peerId");
INDEX ("tenantId", "lastMessageAt" DESC, "id" DESC);
INDEX ("tenantId", "status", "lastMessageAt" DESC, "id" DESC);
INDEX ("tenantId", "socialAccountId", "lastMessageAt" DESC, "id" DESC);
INDEX ("tenantId", "assignedUserId", "status", "lastMessageAt" DESC, "id" DESC);
INDEX ("tenantId", "revision");                  -- delta polling
INDEX ("clientId") WHERE "clientId" IS NOT NULL;
```

`assignedUserId` writes must validate an active membership in the same tenant. RLS `service_role_bypass` policy as in `023_betsy_v2_tenant_ui.sql`.

**`ChatMessage` — new nullable columns:**

| Column | Purpose |
|---|---|
| `conversationId` text NULL FK ChatConversation | Thread pointer |
| `providerMessageId` text NULL | Promoted out of JSON |
| `peerId` text NULL | Promoted out of JSON |
| `messageType` text NULL | `text` · `image` · `audio` · `document` · `template` · `interactive` · … |
| `deliveryStatus` text NULL | inbound `received`; outbound `pending` · `sent` · `delivered` · `read` · `failed` (monotonic) |
| `statusUpdatedAt`, `deliveredAt`, `readAt`, `failedAt` timestamp NULL, `errorCode` text NULL | |
| `providerMediaId`, `mediaMimeType`, `mediaFilename` text NULL | Media reference. `mediaUrl` (if added) holds **only a Betsy-controlled Blob URL** — Meta media URLs expire and must never be persisted as durable links |
| `duplicateOfMessageId` text NULL | Set by the dedup pass instead of deleting rows |
| `createdAt`, `updatedAt` timestamp | `createdAt` DEFAULT now() for audit ordering |

Indexes:

```sql
INDEX ("conversationId", "sentAt" DESC, "id" DESC);
INDEX ("socialAccountId", "providerMessageId");                       -- 024 (non-unique, for backfill/dedup)
INDEX ("tenantId", "createdAt", "id");
UNIQUE INDEX ... ("socialAccountId", "providerMessageId")
  WHERE "providerMessageId" IS NOT NULL;                              -- 025, only after dedup verified
```

**Backfill (idempotent, resumable TypeScript script; batched transactions; dry-run default):**
1. Select `ChatMessage` rows with `conversationId IS NULL` in bounded batches ordered by `(sentAt, id)`.
2. `providerMessageId = metadata->>'providerMessageId'`; inbound `peerId = coalesce(from, waId)`; outbound `peerId = coalesce(to, from)` (existing SMB/history echoes carry the peer in `from`).
3. Rows with no derivable peer (or literal `'unknown'`) are **quarantined and reported**, never merged into an “unknown” conversation; `conversationId` stays NULL.
4. `INSERT … ON CONFLICT` the conversation per `(tenantId, socialAccountId, peerId)`, then set `conversationId` on the batch.
5. Recompute conversation aggregates set-wise at the end (`lastMessage*`, `inboundCount`, `messageCount`), excluding rows marked duplicate.
6. Duplicates by `(socialAccountId, providerMessageId)`: keep the earliest `(sentAt, id)` as canonical; on later rows set `duplicateOfMessageId`, copy the old id into `metadata.audit`, and null `providerMessageId`. **No deletes.** Null provider ids stay allowed (emit a metric); never fingerprint-dedup by content+time — two legitimate messages can collide.
7. Print an unresolved-rows report; safe to re-run after interruption.

`scripts/apply-betsy-v2-additive-sql.mjs` and `verify-betsy-v2-additive-sql.mjs` must be **extended** (they hard-code `018`–`023`) with `024`/`025` entries plus expected tables/columns/indexes as postconditions. `025` runs only after the verify script reports zero duplicate `(socialAccountId, providerMessageId)` pairs and zero duplicate active `(platform, accountId)` assets.

### 3.2 Write path (webhook + send) — transactional dual-write

- Webhook `storeMessage`, inside one `$transaction`: (1) upsert `ChatConversation` by `(tenantId, socialAccountId, peerId)`; (2) `INSERT ChatMessage … ON CONFLICT DO NOTHING` (Prisma `create` catching `P2002` on the 025 unique index); (3) only if a row was inserted, update aggregates (`lastMessage*`, `lastInboundAt`, `inboundCount += 1` for inbound, `messageCount`). Update `SocialAccount.lastWebhookAt`.
- WA `statuses` → `UPDATE ChatMessage SET deliveryStatus … WHERE socialAccountId = ? AND providerMessageId = ?` (monotonic `pending < sent < delivered < read`; `failed` records `errorCode` + `failedAt`). No insert.
- IG `is_echo` + IG `delivery`/`read` → ingested (parity with WA SMB echoes and statuses). Echoes are stored as outbound when `providerMessageId` is new (covers replies typed in the IG app during human takeover) and reconcile with API-created outbound rows through the unique index. `suppressSoftAi: true`.
- Send: insert outbound row as `pending` → Graph call → update to `sent` with `providerMessageId` (or `failed`); `lastOutboundAt = now`; caller's `ChatConversationReadState.readInboundCount = inboundCount`.
- Legacy `metadata.from/to/waId/providerMessageId` **kept** so old read paths keep working during the flag window.
- Webhook acknowledgement order: verify HMAC → parse → persist messages (+ automation jobs) → 200. Processing that can be slow (Soft AI) never runs before the 200.

### 3.3 Read path — server-grouped conversations

| Endpoint | Shape |
|---|---|
| `GET /api/chat/conversations` | `?platform=&socialAccountId=&status=&assigned=me\|none\|<userId>&tag=&q=&cursor=<lastMessageAt,id>&limit≤50` → `{ conversations[], nextCursor }` sorted by `(lastMessageAt desc, id desc)` (deterministic composite cursor). Each item carries `channel: { id, platform, displayName, logoKey }`, `unreadCount` (for the caller), `waWindowOpen`, `aiMode`, `assignedUser`. |
| `GET /api/chat/conversations/changes?afterRevision=N&limit≤200&…filters` | Rows with `revision > N` (+ `maxRevision`). Drives the 4–5 s poll: near-zero payload when idle; periodic full reconciliation every ~2 min. |
| `GET /api/chat/conversations/:id/messages?before=<sentAt,id>&limit≤100&after=<sentAt,id>` | Thread page (`before` = load older); `after` = cheap tail refresh of the open thread. |
| `POST /api/chat/conversations/:id/read` | Sets caller's `readInboundCount = inboundCount`, `lastReadAt`, `lastReadMessageId`. |
| `PATCH /api/chat/conversations/:id` | `{ status?, tags?, assignedUserId?, aiMode? }` (`update_sales`; `aiMode` keeps Soft RBAC; assignee must be an active tenant member). |
| `GET /api/chat/accounts` (extend) | Adds `displayName`, `providerDisplayName`, `providerUsername`, `displayPhoneNumber`, `tokenStatus`, `lastWebhookAt`, `logoKey`. |
| `PATCH /api/chat/accounts/:id` | `{ displayName }` (`update_config`). |

Old `GET /api/chat/messages?socialAccountId` stays for one release behind the same flag for rollback.

### 3.4 Realtime delivery on Vercel

Recommendation: **keep polling, make it revision-based and tenant-level** (Phase 4). SSE on Vercel serverless burns function duration; Supabase Realtime would require tenant-scoped RLS on `ChatConversation` with anon keys — a security surface we do not need at 5k–50k messages. One `changes?afterRevision` request per tenant every 4 s over the `(tenantId, revision)` index returns empty arrays most of the time; the open thread tail-polls with `after=<sentAt,id>`. Revisit SSE/Realtime only if sub-second delivery becomes mandatory (**L**).

### 3.4b Soft AI durability

Soft AI post-inbound work moves to a **separate `ChatAutomationJob` table** (`{ id, tenantId, conversationId, messageId, kind, status, attempts, availableAt, leaseToken, leaseExpiresAt, deliveryKey UNIQUE, … }`) that **copies** the `BotInboxMessage` lease/retry pattern (`FOR UPDATE SKIP LOCKED`, 45 s lease, unique delivery key) but shares **no tables, env, routes, or processors** with the staff bot. Webhook persists message + job before the 200; a cron (`/api/cron/chat-automation`) plus best-effort immediate dispatch processes jobs. Phase 4 unless webhook p95 or AI drop rate forces it earlier.

### 3.5 Client (data components only)

- `SoftCopilotInbox.tsx` becomes an orchestrator over `conversations` (server list) + `threadMessages[selectedId]` instead of `accountMessagesRef`. `groupMessagesByRecipient` stays only for demo mode.
- `SoftConversationList.tsx`: row gets `<ChannelLogo platform size=14 />` + `displayName`; account `<select>` grouped by platform with names; unread from server.
- `SoftThreadPane.tsx`: header “WhatsApp · Forge · +506 6104 3737”; ✓/✓✓ from `deliveryStatus` (S); window banner from server `waWindowOpen`.
- Long threads (> 300 msgs) use simple windowing (render last 200 + “cargar anteriores”); no new dependency required.
- Chrome files unchanged: counts already flow via props.

### 3.6 Self-serve connect hardening (Phase 5)

- Server-side gate: `config/social/page.tsx` wrapped by `requirePermission('update_config')`; `/api/auth/whatsapp/{exchange,direct-oauth}`, `/api/auth/instagram/{auth-url,callback,complete,cancel}` require `update_config` too (decision §9: OWNER only vs OWNER+ADMIN). `direct-oauth` additionally persists `state` in an HttpOnly cookie (as the IG flow already does) and the callback validates it — or the route is removed if Embedded Signup makes it redundant (decision §9 #12).
- IG: `isActive = subscribeOk` (parity with WA); surface “Re-suscribir”.
- Persist `expiresAt` from `expires_in` (WA) and `debug_token` result (IG page tokens from long-lived user tokens are typically non-expiring — store what Meta says; today's +60 d is a Betsy assumption, not Meta data). Refresh where Meta supports it; otherwise force reauthorization before expiry.
- Daily cron `/api/cron/chat-token-health`: per active account one light Graph call (`GET /{phone_number_id}?fields=id` / `GET /{ig_id}?fields=username`) → `tokenStatus`, `lastErrorCode`; UI banner “Reconectar WhatsApp · Forge”.
- Unlink → soft-deactivate (`isActive=false`, `disconnectedAt`, tokens nulled). Reconnect of same `accountId` reactivates the same row → history preserved. Meta data-deletion callback unchanged (regulatory delete).

---

## 4. Phases and ordered workstreams

```
P0 approvals → P1 schema+idempotency → P2 conversation API + inbox reads
→ P3 channel identity (names/logos/connect naming) → P4 scale & reliability
→ P5 self-serve Meta & token health → P6 Soft UX redesign (HOLD)
```

Phases 1–3 are the “function parity” core Rafael asked for; 4–5 make it robust for all tenants; 6 is visual and gated.

### Phase 1 — Schema & idempotency foundation

**Workstreams (ordered):**
1. `supabase/migrations/024_chat_inbox_conversations.sql` (nullable columns + `ChatConversation` + `ChatConversationReadState` + `revision` sequence/trigger + non-unique indexes + RLS) and `schema.prisma` mirror. Extend `apply-`/`verify-betsy-v2-additive-sql.mjs` with `024`/`025` entries and postconditions.
2. `scripts/chat-inbox-backfill.ts` (dry-run default; batch 1k; idempotent; resumable; quarantine report; duplicate pass) + `scripts/chat-inbox-verify.ts` (row parity: every `ChatMessage` with a peer has `conversationId`; aggregates match; zero duplicate provider pairs; zero duplicate active assets).
3. Dual-write in `webhook/route.ts` + `send/route.ts` (transaction, `P2002` = duplicate; outbound `pending → sent/failed`). Statuses + IG echo/delivery/read ingestion in `meta-chat.ts`.
4. `supabase/migrations/025_chat_inbox_uniques.sql` (partial unique on `(socialAccountId, providerMessageId)` + partial unique on active `(platform, accountId)`) — applied only after verify = 0 collisions.
5. Webhook rate-limit rework: **HMAC verification first**; signature-valid traffic is never IP-throttled by the app (Meta fan-in shares egress IPs, and an attacker can currently exhaust the bucket before signature rejection); invalid-signature requests get the per-IP limiter; endpoint abuse is Vercel WAF's job. Structured log per event (`socialAccountId`, `durationMs`, `result`).
6. Security quick-fix: `direct-oauth` requires `update_config` + persisted/validated `state` (or removal, §9 #12) — cheap and independent of schema.
7. Tests: `chat-conversation-upsert.test.ts` (aggregates, `inboundCount` only on insert, monotonic status), `chat-webhook-idempotency.test.ts` (same wamid twice → one row; concurrent → one row via unique), `meta-chat-webhook.test.ts` extended for statuses + IG echo, `ig-wa-connect-security.test.ts` extended for `direct-oauth`.

**Acceptance tests**

| # | Given | When | Then |
|---|---|---|---|
| 1.1 | Prod-like DB with existing `ChatMessage` rows (Forge history) | `024` applied + backfill run twice | Both runs succeed; `ChatConversation` count == distinct `(socialAccountId, peerId)` excluding `unknown`; second run changes 0 rows |
| 1.2 | Webhook receives the **same** WA `wamid` twice (Meta retry) | Both POSTs processed, including concurrently | Exactly one `ChatMessage`; `inboundCount` incremented once; second response `{ skipped: 1 }` |
| 1.3 | Inbound WA message for peer P on account A | Stored | `ChatConversation(A,P).lastMessageAt = sentAt`, `inboundCount = 1`, `lastInboundAt` set, preview ≤ 120 chars, `revision` increased |
| 1.4 | Outbound send to P from A | 200 from Graph | Row goes `pending → sent` with `providerMessageId` column set; `lastOutboundAt` set; sender's read state `readInboundCount = inboundCount` |
| 1.5 | WA `statuses` `delivered` then `read` for that wamid | Webhook | `deliveryStatus` ends `read`; a late `delivered` after `read` does not regress |
| 1.6 | Coexistence history sync burst of 300 events in 60 s from one Meta IP with valid HMAC | Webhook | 0 × 429; all stored; signature-valid traffic never IP-throttled |
| 1.7 | Same `phone_number_id` active in two tenants | Webhook (pre-025) / connect (post-025) | Pre-025: still refused (`ambiguous_tenant_match`). Post-025: second activation fails with a Spanish “ya conectado en otro negocio” error; resolver stays as defense in depth |
| 1.8 | Backfill finds a message with no derivable peer | Run | Row quarantined in report; no “unknown” conversation created |
| 1.9 | Unauthenticated `GET /api/auth/whatsapp/direct-oauth` | — | 401 JSON; authenticated call sets `state` cookie; callback with mismatched `state` → 403 |
| 1.10 | `npm run test:chat-harden`, `test:security`, `test:soft-ai`, `npm run build`, `npm run lint` | CI | Green; `test:soft-meta-wait-iron` proves no `WHATSAPP_*` usage |

**Non-goals:** UI changes; removing legacy metadata; normalized tag tables.
**Risks:** backfill on shared Supabase (mitigate: dry-run, batches, `lock_timeout`, run off-peak, verify script, human gate, fresh Blob backup); unique index creation blocked by dups (mitigate: 025 separate + verify); transaction latency on webhook (target p95 < 400 ms); deploying code that assumes `024` before SQL is applied (mitigate: PR-1 code is behind column-existence guards or ships only after apply — see §5).

### Phase 2 — Conversation API + inbox reads (feature-flagged)

**Workstreams:**
1. Endpoints §3.3 (`conversations`, `delta`, `:id/messages`, `PATCH`), Zod-validated, tenant-scoped, `update_sales`.
2. `TenantFeatureFlag` key `chat_inbox_v2` (default off) gates the client switch; old path remains.
3. Client: `SoftCopilotInbox.tsx` uses server list + per-thread fetch; status/tags/read move to `PATCH`. One-time import of localStorage status/tags into DB on first v2 load (decision §9).
4. `aiMode` column + migration of `TenantFeatureFlag.config.agentState` → `ChatConversation.aiMode` with read fallback; `inbound-hook.ts` reads column first (still fail-closed).
5. WA peer → `Client` link: on conversation create, match `Client.normalizedPhone` within tenant; set `clientId` (IG skipped).
6. Tests: `chat-conversations-api.test.ts` (filters, cursor stability, tenant isolation), `soft-ai-server-truth.test.ts` extended (column precedence), client helper tests for the new reducer.

**Acceptance tests**

| # | Given | When | Then |
|---|---|---|---|
| 2.1 | Tenant with 2 WA + 1 IG accounts, 40 conversations | `GET /conversations?limit=20` then `cursor` | 20 + 20 distinct, sorted by `lastMessageAt desc`, no gaps/dups across a concurrent inbound |
| 2.2 | Filter `socialAccountId=B` | List | Only B’s conversations; each item’s `channel.id == B` |
| 2.3 | Agent 1 sets status `hecho` + tag `VIP` in browser 1 | Agent 2 polls in browser 2 | Sees `hecho` + `VIP` within ≤ 5 s |
| 2.4 | Conversation with 3 unread for agent 1 and agent 2 | Agent 1 opens thread (`POST …/read`) | Agent 1 unread = 0; agent 2 still 3 (per-user); a reply by agent 2 sets agent 2 to 0 too |
| 2.4b | Tenant with 500 conversations | Cutover baseline chosen in §9 #3 | Either all members show 0 unread (seeded) or history shows as unread — matches the decision, no mixed state |
| 2.5 | Tenant B calls `PATCH /conversations/<id of tenant A>` | — | 404 (not 403 leaking existence) |
| 2.6 | Legacy `agentState[key] = 'human'` in feature-flag config, no column | Inbound | AI does **not** reply (fallback read honored) |
| 2.7 | New WA peer `+50661043737` matches `Client.normalizedPhone` | Conversation created | `clientId` set; rail “Detalle” shows client name |
| 2.8 | Flag off | `/chats` | Behaves exactly like today (old endpoints); flag on → v2 |

**Non-goals:** visual changes beyond text/badges; per-user unread; IG identity merge.
**Risks:** double state during flag window (mitigate: server wins; localStorage read-only after import); `aiMode` migration must never turn AI on where it was off (mitigate: only copy explicit values; NULL inherits; test 2.6).

### Phase 3 — Channel identity: names, logos, Connect naming

**Workstreams:**
1. Persist provider identity at connect: `exchange/route.ts` stores `displayPhoneNumber`, `providerDisplayName` (`verified_name`), `wabaId`; `instagram/complete` + `callback` store `providerUsername`, `providerDisplayName` (Page name), `pageId`. Default `displayName` per §7.2.
2. Lazy backfill for existing accounts: `GET /api/chat/accounts` triggers a throttled (≤ 1/h/account) Graph identity refresh when fields are NULL; or a one-off script.
3. `PATCH /api/chat/accounts/:id { displayName }`; `/config/social` card: logo + name + phone/handle + “Renombrar” inline + health badge + “Agregar otro WhatsApp / otra Instagram”.
4. `ChannelLogo.tsx` (inline SVG, brand-compliant, `aria-label`), used in `SoftConversationList` rows, `SoftThreadPane` header, account `<select>` (grouped `<optgroup>` per platform), `/config/social`.
5. Soft AI context: worker system prompt receives `channel.displayName` (“You are answering for Forge’s WhatsApp”) — no behavior change otherwise.
6. Tests: `channel-display-name.test.ts` (fallback chain, validation), `accounts` API test, connect route tests extended for persisted identity.

**Acceptance tests**

| # | Given | When | Then |
|---|---|---|---|
| 3.1 | Owner connects a second WA number via Embedded Signup | Exchange completes | New `SocialAccount` with `displayPhoneNumber`, `providerDisplayName`, `wabaId` populated; default `displayName` = verified name |
| 3.2 | Owner renames account to “Forge” | `PATCH` | `/chats` list rows, thread header, filter dropdown all show “Forge” + WA logo within one poll |
| 3.3 | Two WA accounts (“Forge”, “Tienda 2”) each receive a message | List | Each row shows its own name + WA logo; reply from “Tienda 2” thread goes out via Tienda 2’s `phone_number_id` (assert in Graph request mock) |
| 3.4 | IG account connected | List | Row shows IG logo + `@username` (never numeric id) |
| 3.5 | `displayName` 41 chars / empty / control chars | `PATCH` | 400 / reset to default / 400 |
| 3.6 | Account with NULL identity fields (legacy Forge row) | `/config/social` loads | Identity refreshed from Graph once; card shows phone + verified name |
| 3.7 | Chrome files | `git diff` | `SoftSlimNav.tsx`, `SoftInboxBuckets.tsx`, `SoftCopilotRail.tsx` unchanged (CI check via `git diff --exit-code` on those paths) |

**Non-goals:** custom colors/avatars per channel; Soft chrome redesign; channel reordering.
**Risks:** Meta brand rules (mitigate: use official mono glyphs, §7.4, Rafael sign-off); Graph identity fetch failing (mitigate: fallback chain always renders).

### Phase 4 — Scale & reliability (≥ 5k → 50k messages)

**Workstreams:** revision-based `changes` polling (one request per tenant) + periodic full reconciliation; thread tail fetch; windowing in thread; template cache (per WABA, 5 min, Upstash/in-memory); `ChatAutomationJob` durable Soft AI queue (§3.4b) — mandatory here, earlier if webhook p95 > 1 s or AI drops observed; media rendering for image/audio/document via `providerMediaId` → Betsy Blob cache (never persist Meta URLs) (S); load-test seed script (50k msgs, 2k conversations, 5 accounts) on local Postgres; observability: structured log per webhook with `socialAccountId`, `durationMs`, `result`; replay fixtures for signed webhook payloads.

**Acceptance tests**

| # | Given | When | Then |
|---|---|---|---|
| 4.1 | Local Postgres seeded 50k msgs / 2k conversations / 5 accounts | `GET /conversations?limit=30` | p95 < 150 ms (EXPLAIN uses `(tenantId, lastMessageAt)` index) |
| 4.2 | Same | `GET /conversations/changes?afterRevision=<max>` idle | p95 < 60 ms; payload < 1 KB |
| 4.3 | Same | Open a 3k-message thread | First paint ≤ 100 msgs; “cargar anteriores” pages by cursor; no > 500-node DOM growth per page |
| 4.4 | Inbox open 10 min idle | Network | ≤ 1 request / 5 s regardless of account count (was N/4 s) |
| 4.5 | 500 webhook events in 60 s across 5 accounts | Vercel | 0 dups, 0 429s, p95 handler < 800 ms |
| 4.6 | Template picker opened twice within 5 min | Graph mock | 1 upstream call |
| 4.7 | Soft AI reply path (if durable job adopted) killed mid-run | Retry | Exactly one outbound reply (delivery key unique) |

**Non-goals:** SSE/WebSocket; Supabase Realtime; search engine.
**Risks:** Upstash quota; Vercel function duration for media proxy (stream, 10 MB cap).

### Phase 5 — Self-serve Meta & token health

**Workstreams:** server RBAC gates (§3.6); IG `isActive = subscribeOk`; real `expiresAt`; token-health cron + `tokenStatus`; “Reconectar” banners in `/chats` and `/config/social`; unlink → soft-deactivate; store-owner runbook in `src/content/docs/social-accounts.mdx` (fix the “history kept” claim to match reality); coexistence FAQ; IG App Review pack alignment (Meta ops — blocked until Rafael GO to Submit).

**Acceptance tests**

| # | Given | When | Then |
|---|---|---|---|
| 5.1 | ADMIN (non-owner) session (per §9 decision) | Opens `/config/social` directly | Server 403/redirect (not client-only) |
| 5.2 | Store OWNER with zero Meta-dev-console access | Connects WA Business App number via coexistence | Account active, message round-trip in `/chats` without any CoS click |
| 5.3 | IG subscribe fails | Complete | `isActive=false`, card shows “Re-suscribir” |
| 5.4 | Account token revoked at Meta | Daily cron | `tokenStatus='revoked'`, banner “Reconectar Instagram · @shop” in `/chats` within 24 h; send returns 400 with Spanish copy |
| 5.5 | Owner unlinks then reconnects the same number | — | Same `SocialAccount.id` reactivated; all prior conversations visible |
| 5.6 | `test:security` | CI | New RBAC cases green |

**Non-goals:** automating Meta App Review; supporting Creator IG accounts.
**Risks:** IG Advanced Access still pending → IG for non-tester customers cannot be proven in prod (Meta-blocked; WA path is not blocked).

### Phase 6 — Soft `/chats` UX redesign — HOLD

Only after Rafael GO on the 11-point brief. By then the data layer (Phases 1–4) is done, so the redesign is a pure view swap: continuous canvas, conversation hero, Customer Context rail, AI/Human control language, channel `displayName` + logo already available. **No work, no PR, no Figma freestyle before GO.**

---

## 5. PR / sequencing plan (fat PRs, one writer)

| PR | Contents | Depends on | Human gate |
|---|---|---|---|
| **PR-1 “schema”** | `024` SQL + `schema.prisma` + backfill/verify scripts + unit tests (no runtime behavior change) | §9 approvals | SQL review ledger + apply `024` on Supabase (gated script) + run backfill dry-run → real |
| **PR-2 “write+read v2”** | Phase 1 dual-write, statuses, rate-limit rework, `025` SQL, Phase 2 API + client behind `chat_inbox_v2` | `024` applied, backfill verified | Apply `025` after verify = 0 dups; flag on for one pilot tenant (Forge) |
| **PR-3 “identity”** | Phase 3 names/logos/connect naming | PR-2 | Rafael eye on logo usage |
| **PR-4 “scale”** | Phase 4 | PR-2 | Load-test report attached |
| **PR-5 “self-serve”** | Phase 5 | PR-3 | RBAC decision; docs fix |

PR-2 and PR-3 may be merged into one fat PR if preferred; PR-1 must stay separate because its SQL needs the human apply gate before dependent code ships. Two distinct production gates are non-negotiable: **gate A** = apply `024` → deploy dual-write code → run backfill; **gate B** = verify zero collisions → apply `025` → enable constraint-based dedup. Never deploy code that assumes `024` columns before `024` is applied.

---

## 6. Scale plan for ≥ 5k messages (and 50k)

| Layer | Today | Target |
|---|---|---|
| **DB** | Peer/provider lookups via JSON path (seq scan); 2 indexes | Promoted columns + composite `(…, lastMessageAt DESC, id DESC)` indexes (§3.1); partial unique for idempotency; `(tenantId, revision)` for changes feed |
| **Webhook** | 120/min per-IP limiter **before** HMAC; check-then-insert | HMAC first; valid traffic never IP-throttled; `ON CONFLICT` + transaction; p95 < 400 ms; statuses as updates; persist-before-200 |
| **API** | `messages?socialAccountId&limit=100` per account | `conversations` (composite cursor ≤ 50), `changes?afterRevision`, `:id/messages` (`before`/`after` composite cursors ≤ 100) |
| **Client** | N requests / 4 s; regroup all; localStorage state | 1 changes request / 4 s per tenant + 1 thread tail; server-grouped; windowed thread (> ~200 rows) |
| **Idempotency** | JSON path dedup, race-prone | Unique `(socialAccountId, providerMessageId)`; echo/send collision handled; duplicate → `skipped`; null ids allowed + metric |
| **Soft AI** | fire-and-forget | `ChatAutomationJob` lease queue, separate from staff bot tables |
| **Templates** | Graph per send/open | 5-min cache per WABA; APPROVED gate unchanged |
| **Observability** | console logs | Structured per-webhook log + `WebhookLog` retained; p95 dashboards via Vercel logs |

Capacity math: 5k msgs ≈ 300–800 conversations for a store; 50k msgs ≈ 3–8k conversations; all queries are index-range scans bounded by `limit`, independent of total table size.

---

## 7. Product spec — “Channel display name”

### 7.1 Definition
Every connected channel (`SocialAccount`) has a **human name** shown wherever a thread’s origin matters. It answers “which of our numbers/accounts did this customer write to?”.

### 7.2 Data & defaults
- `displayName` (1–40 chars after trim; letters/digits/spaces/`-_.&’`; no control chars; not required unique — duplicate names get a soft warning in `/config/social`).
- Default at connect: WA → `verified_name` if present else `display_phone_number`; IG → `@username`. Owners can rename anytime; clearing resets to default.
- **Fallback render chain** (never blank): `displayName` → `providerDisplayName` → `displayPhoneNumber` / `@providerUsername` → `WA · …last4` / `IG · …last4`.

### 7.3 Where it appears
| Surface | Format |
|---|---|
| Conversation row (`SoftConversationList`) | `[logo] Forge` (12/400, secondary color) under name/snippet — replaces `WA · …1234` |
| Thread header (`SoftThreadPane`) | `WhatsApp · Forge · +506 6104 3737` (brief-style, no pill) |
| Account filter | `<optgroup label="WhatsApp">` `Forge`, `Tienda 2` · `<optgroup label="Instagram">` `@betsy_crm` |
| `/config/social` card | Logo · **Forge** · `+506 6104 3737` · `Meta: Forge Store` · health badge · Renombrar · Re-suscribir · Desconectar |
| Soft AI context | System prompt line “Canal: WhatsApp · Forge” |
| Send errors / banners | “La ventana de 24 horas cerró en **Forge**…”, “Reconectar WhatsApp · Forge” |

### 7.4 Logos
- `ChannelLogo` component: official WhatsApp and Instagram glyphs as inline SVG, monochrome variants allowed by Meta brand guidelines; default 14 px in rows, 16 px in headers, 20 px in config cards; `role="img"` + `aria-label="WhatsApp"|"Instagram"`; text name always accompanies the logo (never logo-only).
- Colors: WA `#25D366` on light; IG mono `#111827` or gradient only in config cards. Both inside the brief’s palette; not chrome changes.
- Rafael sign-off on the exact asset before PR-3.

### 7.5 API
`GET /api/chat/accounts` → `{ id, platform, displayName, providerDisplayName, providerUsername, displayPhoneNumber, logoKey: 'whatsapp'|'instagram', tokenStatus, isActive }`. `PATCH /api/chat/accounts/:id { displayName }` (`update_config`), returns updated account; 400 on validation; 404 cross-tenant.

### 7.6 Acceptance (product)
An agent looking at any row or thread can name the channel in ≤ 1 s without opening settings; adding a third WA number requires only “Agregar otro WhatsApp” + Embedded Signup + optional rename.

---

## 8. Reliability verification matrix (executed at end of Phases 3 and 5, pilot tenant Forge + a second test number)

| Flow | Single-channel check | Multi-channel check |
|---|---|---|
| Connect | WA Embedded Signup (Cloud API) · WA coexistence (Business App) · IG OAuth | Two WA numbers + one IG on the same tenant, each with its own name |
| Receive | Inbound stored once, appears ≤ 5 s | Message to number B appears under **B** (logo + name), never under A |
| Send | Text reply 200, stored outbound | Reply from B thread hits Graph `/{B.phone_number_id}/messages` |
| Takeover | AI → human → resume; composer state | Per conversation; taking over B does not change A |
| 24h window | Closed window → template CTA; template send APPROVED gate | Window computed per conversation from `lastInboundAt` |
| Templates | List APPROVED for WABA | Picker shows B’s WABA templates when in a B thread |
| Webhooks | HMAC valid/invalid; verify token; duplicates; statuses | PARTNER_REMOVED on WABA-B deactivates only B |
| Failure copy | Spanish, no raw HTML/JSON errors | Includes channel name |

---

## 9. What Rafael must approve before Phase 1 code

1. **Plan GO** for Phases 1–3 as the first implementation tranche (Phases 4–5 planned, GO separately).
2. **Conversation status vocabulary**: keep Soft `nuevo / en_curso / hecho` in DB (recommended) vs Respond.io-style `open / pending / closed`.
3. **Unread semantics**: per-user read state via `ChatConversationReadState` (recommended, Advisor-endorsed) vs tenant-level counter; plus the **cutover baseline** — seed all active members as read at cutover (recommended) or expose history as unread.
4. **localStorage state**: import existing status/tags into DB on first v2 load (recommended) vs start clean.
5. **Self-serve RBAC**: who may connect/rename/unlink channels — OWNER only (matches UI today) vs OWNER + ADMIN (matches `/api/social/*` today).
6. **Unlink behavior**: soft-deactivate keeping history (recommended) vs today’s hard delete; confirm docs fix.
7. **Logo assets**: approve WA/IG glyph usage + mono variant (§7.4).
8. **SQL apply window**: authorize `024` (+ backfill) and later `025` on shared Supabase via the gated script, with a fresh Vercel Blob backup taken first (`npm run backup:*`).
9. **Pilot tenant** for `chat_inbox_v2` flag: Forge’s tenant first.
10. **IG App Review Submit**: separate GO (Meta ops; not blocking WA phases).
11. **Soft UX redesign** remains HOLD; confirm Phase 6 waits for the 11-point brief GO.
12. **`direct-oauth` fallback route**: harden (auth + validated `state`) vs remove now that Embedded Signup + coexistence cover WA onboarding.
13. **Global active-asset uniqueness**: one Meta phone/IG asset may be active in exactly one tenant (partial unique in `025`) — confirms today’s runtime refusal as a DB rule.
14. **Realtime strategy**: 4 s revision polling per tenant as v1 (no SSE / Supabase Realtime).
15. **Durable CRM automation queue** (`ChatAutomationJob`) separate from the staff bot tables — confirm this does not conflict with the HARD LOCK reading (it copies the pattern, shares nothing).

---

## 10. Notion mental-model updates (for CoS)

- Add to “Already in code”: multi-account storage + `Agregar otro` UI; coexistence; tenant-safe webhook; encrypted tokens; WA APPROVED gate; Soft AI server truth.
- Correct “Missing vs Respond.io”: WA template path **exists**; 24h window UI **exists** (client-side); tokens **are encrypted**. Still missing: Conversation model, names/logos, statuses, health, assignment, shared tags, client link.
- Correct `social-accounts.mdx`: unlink currently **deletes** history (to be changed in Phase 5).

## 11. Advisor (Sol `gpt-5.6-sol-high`) plan-mode review — 2026-09-21

**Assessment:** extend, do not rebuild. Meta parsing, encrypted credentials, tenant-scoped APIs, Embedded Signup/coexistence, cursor pagination and the ambiguity refusal are sound foundations. Structural debts confirmed: (1) conversation identity only in JSON/client grouping, (2) provider ids and delivery state lack indexed, race-safe persistence, (3) onboarding lacks consistent server RBAC, subscription health and token lifecycle. Polling scales by account instead of tenant.

**Corrections to the Executor's draft (verified in code and folded into §1.2 / §3 / Phase 1):**
- `GET /api/auth/whatsapp/direct-oauth` is **fully unauthenticated** and its CSRF `state` is never persisted/validated — not merely “tenant-session only” (`direct-oauth/route.ts:14-50`).
- The IG 60-day `expiresAt` is a Betsy assumption, not Meta data.
- `apply-betsy-v2-additive-sql.mjs` hard-codes `018`–`023`; `024`/`025` need explicit entries + postconditions.
- The per-IP webhook limiter runs **before** HMAC — attacker can exhaust it before signature rejection; Meta fan-in shares egress IPs. Verify HMAC first; never app-throttle valid signed traffic.

**Adopted recommendations:** per-user `ChatConversationReadState` with `inboundCount − readInboundCount` (no message counting); `revision` sequence + `changes?afterRevision` feed instead of `updatedAt` deltas; deterministic composite cursors `(lastMessageAt, id)` / `(sentAt, id)`; conversation unique `(tenantId, socialAccountId, peerId)`; partial global unique on active `(platform, accountId)`; backfill quarantines peer-less rows (no “unknown” conversation), keeps earliest canonical row and marks later rows `duplicateOfMessageId` (no deletes, no content fingerprinting); outbound `pending → sent/delivered/read/failed`; `providerMediaId` with Betsy-Blob-only `mediaUrl`; `ChatAutomationJob` copying the `BotInboxMessage` lease pattern while sharing nothing with the staff bot; persist-before-200; assignee membership validation; unlink = soft-deactivate; `debug_token`-sourced expiry; two production gates (`024`+code+backfill, then `025`).

**Deferred / kept as Executor default with rationale:** conversation status vocabulary stays a Rafael decision (§9 #2: Soft `nuevo/en_curso/hecho` vs Advisor's `open/pending/snoozed/closed`); tags stay `text[]` in v1 (Soft has 3 fixed tags) with normalized tag tables as the **L** upgrade; SSE / Supabase Realtime remain **L**.

**Advisor phase ordering matches §4** (foundation SQL → integrity/uniqueness → API cutover → identity/connect naming → inbox parity → scale/reliability → self-serve Meta → visual refresh only after HOLD removal), with RBAC/OAuth hardening allowed to ship early (placed in Phase 1 item 6).
