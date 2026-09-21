# Chat Phase 4 — scale report

> **Status:** pending local postgres (Cloud Agent environment has no Docker / local
> Postgres; `DATABASE_URL` points at shared Supabase and must never be used for seed/bench).
>
> Fill numbers by running on a loopback Postgres:
>
> ```bash
> # 1) ephemeral local DB (example)
> export CHAT_SCALE_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/chat_scale'
> # 2) apply Prisma base schema via safe local push, then 024/025 SQL
> # 3) npm run chat:scale:seed
> # 4) npm run chat:scale:bench   # rewrites this file + chat-phase4-scale-report.json
> ```

## Seed counts

| Entity | Count |
|---|---|
| SocialAccounts | pending (target 5) |
| ChatConversations | pending (target 2000) |
| ChatMessages | pending (target 50000; one thread 3000) |

## Latency (ms)

| Query | n | p50 | p95 | min | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| List `LIMIT 30` (4.1) | — | — | — | — | — | — |
| Changes idle head (4.2) | — | — | — | — | — | — |

Idle changes approximate payload size: **pending**.

## Index assertions

| Query | Expected index | Observed |
|---|---|---|
| List | `ChatConversation_tenantId_lastMessageAt_id_idx` | pending |
| Changes | `ChatConversation_tenantId_revision_idx` | pending |

## Acceptance table (4.1–4.7)

| # | Criterion | Target | Measured | Status |
|---|---|---|---|---|
| 4.1 | List p95 + index | p95 < 150 ms; uses `(tenantId, lastMessageAt)` | pending local postgres | pending |
| 4.2 | Changes idle p95 + payload | p95 < 60 ms; payload < 1 KB | pending local postgres | pending |
| 4.3 | 3k-thread first paint window | ≤ 100 msgs / page; cursor pages; no >500-node DOM growth | pending UI harness | pending |
| 4.4 | Idle network ≤ 1 req / 5 s | `CHAT_INBOX_V2_POLL_MS ≤ 5000` (account-count independent) | unit: `chat-idle-network-assert` | unit shipped |
| 4.5 | 500 webhooks / 60 s across 5 accounts | 0 dups on unique mid; 0 429s; p95 handler < 800 ms | unit: `chat-webhook-burst` (in-memory store) | unit shipped |
| 4.6 | Template picker opened twice within 5 min | 1 upstream Graph call | not in this tooling slice | pending |
| 4.7 | Soft AI reply path killed mid-run | exactly one outbound (delivery key unique) | needs `ChatAutomationJob` (026 sibling) | pending |

## Tooling shipped this slice

| Script / test | npm script |
|---|---|
| `scripts/chat-scale-seed.ts` | `chat:scale:seed` |
| `scripts/chat-scale-benchmark.ts` | `chat:scale:bench` |
| `scripts/chat-webhook-burst.ts` | `chat:webhook:burst` |
| `scripts/chat-idle-network-assert.ts` | (via `test:chat-scale`) |
| Guard + unit tests | `test:chat-scale` |
| Fixture helper | `tests/fixtures/chat-webhook/signed-payload.ts` |

## EXPLAIN — list

```
pending local postgres
```

## EXPLAIN — changes idle

```
pending local postgres
```
