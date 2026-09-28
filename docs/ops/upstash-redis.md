# Upstash Redis — what it does in Betsy

Upstash is a hosted Redis (key/value store over HTTPS). Betsy uses it as **shared, short-lived
memory** that survives restarts and is the same for every server instance. It never stores
business records (orders, clients, chats) — those live in Supabase.

Enabled by two env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
(aliases `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Unset → every feature below falls back to
per-process memory (works on one instance, resets on restart/deploy).

| Use | Code | Keys | What changes when Redis is on |
|---|---|---|---|
| Rate limits (login, register, reset password, phone OTP, chat send, chat webhook, exports, work-clock, integrations) | `src/lib/rate-limit.ts` | `ratelimit:<name>:<ip-or-id>` | Limits hold across deploys, sleep and multiple containers. On Redis error or >1 s → falls back to memory (fail-open). |
| Staff bot conversation memory (Telegram/WhatsApp staff bot — HARD LOCK, not the inbox) | `src/lib/bot/conversation-memory.ts` | `betsy:conversation:*` | Bot keeps context across restarts. If a Redis read fails the bot answers without history. |
| WhatsApp template cache | `src/lib/chat-template-cache.ts` | `chat:wa-templates:v1:*` | Fewer Meta API calls when opening the template picker. |
| Instagram pending connect | `src/lib/instagram-pending-connect.ts` | (pending OAuth state) | IG connect flow survives a restart mid-login. |

Not covered by Redis today: **credentials login** per-email limiter uses the sync memory-only
`rateLimit()` (`src/lib/auth-options.ts`); moving it is an auth change (needs Rafael GO).

## Rules
- **One Upstash database per environment** (production on Cloudflare, preview on Railway).
  Keys have no environment prefix, so sharing a database would share lockouts and staff-bot memory.
- Secrets only via `wrangler secret put` (Cloudflare) / Railway variables — never in chat, Notion or git.
- The Cloudflare worker already forwards both vars to the container (`src/cf-container-worker.ts`).
- Client IP for rate limits comes from `cf-connecting-ip` on Cloudflare (`TRUSTED_IP_HEADER`,
  set by the worker). See security register AUTH-01.

## Status (2026-09-28)
- Railway preview: both vars set.
- Cloudflare production: unknown — check Workers & Pages → `betsy-crm-daytime-smoke` → Settings →
  Variables and Secrets. If missing, create a **separate** production Upstash DB and add both secrets.
