# Integrations and finance

Secrets stay in env / Vercel. This page maps **entrypoints and ownership**, not how to mint keys. Operator finance runbook: [`docs/FINANCE_API_SETUP.md`](../FINANCE_API_SETUP.md) and [`src/app/api/finance/README.md`](../../src/app/api/finance/README.md).

Optional integrations generally **degrade** when unset. Exceptions: `NEXTAUTH_SECRET` (middleware), `RESEND_API_KEY` (import-time throw), `EMPLOYEE_CODE_SECRET` (stable hashes), `FINANCE_API_KEY` (fail-closed 503).

## SaaS payments — Tilopay

| | |
|--|--|
| Owner | CRM billing |
| Code | `src/lib/tilopay.ts`, `src/lib/tilopay-fees.ts`, `src/app/api/tilopay/**`, `src/app/api/billing/**` |
| Auth | JWT for app; webhook public + secret |
| Writes | `Tenant` subscription fields, `BillingTransaction`, `WebhookLog` |
| Env | `TILOPAY_API_KEY`, `TILOPAY_USER`, `TILOPAY_PASSWORD`, `TILOPAY_BASE_URL`, `TILOPAY_WEBHOOK_SECRET` |
| Status | Token cache incomplete; webhook verification permissive (Phase 1 W3). Failed-payment email TODO. |

Do not confuse with customer `Invoice` or logistics `lm_billing_weeks`.

## AI sales bot — Telegram / WhatsApp

| | |
|--|--|
| Owner | CRM |
| Code | `src/lib/bot/*` (`ai-agent.ts`, `ai-tools.ts`, `xai-responses.ts`, `telegram.ts`, `whatsapp.ts`) |
| Model | xAI **Responses API**, default `grok-4.6`, reasoning `low` (WhatsApp 15s). `store: false`. No `previous_response_id`. |
| Join | Tenant `botAccessCode` (12-char) → `BotSession` |
| Env | `XAI_API_KEY`, `XAI_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_*`, `META_APP_SECRET`, Upstash Redis (in-memory fallback) |
| Prove | `npm run test:bot-grok` |

`DOCUMENTATION.md` may still say OpenAI GPT-4o — **wrong**. Keep webhooks public.

## Meta social / CAPI

`src/lib/meta-api.ts`, `meta-chat.ts`, `meta-capi.ts`. Inbox UI `/chats` is middleware-disabled. CAPI optional (`META_CAPI_ACCESS_TOKEN`). Data-deletion routes must stay public for app review.

## External website orders

`/api/integration/*` — Prisma `ApiKey`, CORS in middleware. `src/lib/integration-auth.ts`, `integration-orders.ts`. Creates CRM `Order` rows (same as ventas).

## Correos de Costa Rica SOAP

`src/lib/correos/**`. Two credential paths:

1. Logistics UI → `lm_carrier_configs` (`correos_ws_*`)
2. Platform/bot → `CORREOS_WS_*` env (`credentials.ts`)

Writes Prisma `ShippingGuia`. Logistics also upserts `lm_orders`. WSDL/SOAP — treat as flaky external IO; do not block CRM order create on Correos.

## Finance API — Bitácora / Adsadder

Read-only HTTP API for the internal ads/PnL app. **Not** a CRM feature and **not** the full logistics tenant set.

Allowlist (`src/lib/finance-tenants.ts`):

| slug | CRM tenant id |
|------|----------------|
| `deepsleep` | `cmhsibjue0004js04gie724nx` |
| `bloom` | `cmm4pv8fl0000jr045en1nik9` |
| `deepclean` | `cmln5u7k70000ld042qify2og` |
| `forge` | `cmsrgct420000vipcp3xyqb0m` |

WhatASheet, WAS CR, Kroma Lab, SimplePatch, PeterTesting are logistics-managed **but not** finance brands.

### Classifier (`src/lib/finance-order-classifier.ts` v1.1.0)

- Bloom, DeepClean, Forge: 1:1 tenant = finance business.
- DeepSleep tenant splits businesses `deepsleep` | `patchhouse` | `purasonrisa` from product/source; `unassigned` is the finance-app manual inbox.
- Channel `web` vs `messages` from seller/source aliases.
- Bump `FINANCE_ORDER_CLASSIFIER_VERSION` when rules change so consumers re-bootstrap.

### `brand=all` payload shape

Bitácora reads both `brands[]` and extra top-level keys (`deepsleep`, `bloom`, `deepclean`, `forge`) via `keyedBySlug`. A missing key is “Pendiente de Betsy”, not ₡0. Payroll is global — consumers must not sum it per brand.

The consumer contract also lives outside this repo (ADs `BETSY_FINANCE_API.md`). Do not change response keys without that owner.

Auth: `src/lib/finance-auth.ts`. Dates: `America/Costa_Rica` (`src/lib/finance-dates.ts`). Order date for costs = `COALESCE(lm.completed_at, Order.timestamp)`.

## Redis / rate limits / Blob / Sentry

| Piece | Env | Fallback |
|-------|-----|----------|
| Upstash | `UPSTASH_REDIS_REST_URL/TOKEN` | in-memory |
| Vercel Blob backups | `BLOB_READ_WRITE_TOKEN` | backups fail |
| Sentry | standard Sentry env | tunnel `/monitoring` is public |
| Encryption | `ENCRYPTION_KEY` | falls back to `NEXTAUTH_SECRET` |

## Cron

`/api/cron/*` + `CRON_SECRET`. Backups: full 02:00 UTC, hot 14:00 UTC. Handler-enforced.

## Email

Resend. Required non-empty API key at import. Sending otherwise non-blocking in dev. Invoice email route is incomplete (Phase 1 W4).

## Changing allowlists

`MANAGED_TENANTS` and `FINANCE_TENANTS` are hardcoded production ids. Agents must **not** add/remove them without an explicit human request. After an approved change, update this file, `ORDER_LOGISTICS_FLOW.md`, and tests under `src/lib/__tests__/finance-*.test.ts`.
