# Data ownership

Two schemas, one Postgres (`public`). Prisma does **not** know about `lm_*`.

## Identifiers

| ID | What | Unique how | Used by |
|----|------|------------|---------|
| `Order.id` | Prisma cuid | Global PK | `lm_orders.crm_order_id`, CE payments, retiro handoffs |
| `Order.orderId` | Display number | `@@unique([tenantId, orderId])` | UI, bot, exports — **not** the logistics join |
| `Order.tenantId` / `lm_orders.crm_tenant_id` | CRM tenant | Must be managed-allowlisted for LM writes | Logistics filter |
| `Tenant.slug` | Human slug | Prisma unique | Finance `brand=` query |
| Employee `code_hash` | HMAC of punch code | Per employee | `/work-clock` |

Mixing `Order.id` and `Order.orderId` is the most common agent bug on this boundary.

There is **no FK** from `lm_orders.crm_order_id` to `"Order".id`. Orphans are possible.

## Prisma (CRM) — `prisma/schema.prisma`

Tenant-scoped business data. Isolation via `getTenantPrisma` / `TENANT_MODELS` (`src/lib/prisma-tenant.ts`).

| Model | Owner domain | Notes |
|-------|--------------|--------|
| `Tenant` | tenancy / billing | `plan`, Tilopay ids, `botAccessCode`, `settings` JSON |
| `User` | auth | Global; flags `isSuperAdmin`, `isLogisticsAdmin` |
| `Membership` | tenancy | Role + `isActive` |
| `Order` | sales | EA/RA, status, CE flags, `customFields` JSON |
| `Client`, `InventoryItem`, `Seller` | sales/inventory | Tenant catalogs |
| `ProductField`, `ProductOptionSet`, `ProductOption` | config | Dynamic sales form |
| `OrderStatus` | config | Per-tenant Kanban keys |
| `ShippingMethod`, `ShippingConfig`, `ShippingGuia` | shipping | Tenant-side guías |
| `Invoice` | customer facturas | **Not** SaaS billing |
| `BillingTransaction`, `UsageLog`, `WebhookLog` | SaaS billing | Tilopay |
| `ApiKey`, `IntegrationLog` | website integration | `IntegrationLog.tenantId` nullable |
| `BotSession` | bot | Unique `(platform, platformId)` |
| `SocialAccount`, `ChatMessage` | social inbox | UI `/chats` disabled |
| `AuditLog`, `FeedbackTicket` | ops | |
| `ChangelogEntry` | ops | `tenantId` nullable = global row |
| `BusinessInfo` | config | Extra form fields |

Mechanical list: [generated/LM_SCHEMA.md](./generated/LM_SCHEMA.md). Generated `tenantId = yes` means the field exists; `ChangelogEntry` and `IntegrationLog` allow null (global / unauthenticated rows).

Do **not** add logistics overlay columns to Prisma `Order` unless product explicitly wants every SaaS tenant to see them. Prefer `lm_orders`.

## `lm_*` (logistics) — not in Prisma

Created by `supabase/migrations/*.sql` and/or runtime `CREATE TABLE IF NOT EXISTS`. App access is `prisma.$queryRaw` / `postgres` with the service role, **not** Supabase Auth RLS (even though `lm_is_admin()` exists in SQL).

Mechanical list and backup gaps: [generated/LM_SCHEMA.md](./generated/LM_SCHEMA.md).

| Table | Purpose |
|-------|---------|
| `lm_tenant_links` | Historical linked tenants (display overrides also in `lm_carrier_configs`) |
| `lm_orders` | Overlay: carrier, LM status, CE flags, archive, billed week, Correos cost |
| `lm_order_statuses` | Legacy kanban defs; app mostly uses free-text `lm_orders.status` |
| `lm_order_costs`, `lm_cost_rules`, `lm_handling_costs` | Costing |
| `lm_carrier_configs` | KV: rates, Correos WS, salary, Telegram |
| `lm_ce_payments` | COD collections |
| `lm_order_events` | Logistics audit JSON |
| `lm_billing_weeks` | Finalized weekly locks |
| `lm_documents` | Stored guía/report paths |
| `lm_accounting_entries` | Manual income/expense |
| `lm_gd_balance_entries` | Green Delivery ledger |
| `lm_work_days` | Legacy planilla by staff name |
| `lm_employees`, `lm_schedule_shifts`, `lm_time_entries`, `lm_workforce_audit_events` | Workforce |
| `lm_retiro_stock`, `_movements`, `_product_aliases`, `_handoffs`, `_order_allocations` | Laura RA inventory (runtime DDL in `src/lib/retiro-stock.ts`) |
| `lm_private_delivery_confirmations` | Mensajería privada (runtime DDL) |
| `lm_operational_costs` | Admin P&L opex — used by APIs; **no `CREATE TABLE` in migrations/`src`** (fixture only) |

### Known mechanical gaps

- `lm_retiro_order_allocations` is created at runtime in `src/lib/retiro-stock.ts`. It is now in `REQUIRED_LM_TABLES` so Blob backups include per-unit Laura mappings. Still **no dedicated migration file** (runtime DDL only).
- `lm_operational_costs` is in the backup allowlist but has no in-repo `CREATE TABLE` outside `tests/fixtures/backup-source.sql`.
- Duplicate migration numbers (`005_order_archive.sql` and `005_logistics_phase2.sql`). Ordering is operationally unclear; do not “normalize” without a human.
- Early `002` used `status_id` + NOT NULL carrier; `004_schema_alignment.sql` moved to TEXT status + nullable carrier. App columns like `completed_at` evolved in code.

## Schema change policy

| Want to change | Do this | Never |
|----------------|---------|-------|
| CRM models | Prisma schema + generate. **Do not** `db push` on shared Supabase | `prisma migrate` / `db push` against injected `DATABASE_URL` |
| `lm_*` | New file under `supabase/migrations/`, update `REQUIRED_LM_TABLES`, `npm run test:backups` | Drop tables to “match Prisma” |
| Runtime DDL | Only for tables that already use `CREATE TABLE IF NOT EXISTS` in app code | Invent new runtime tables without a migration + backup row |

`npm run db:push` → `scripts/safe-db-push.mjs` (refuses Supabase, port 6543, non-loopback, any DB with `lm_%` unless `ALLOW_LM_DROP=1` on a disposable DB). Never `--accept-data-loss`. `db:push:unsafe` exists and must not be used on shared Supabase.

Cloud Agent `DATABASE_URL` / `DIRECT_URL` are injected secrets and **override** `.env`.

## Backups

`src/lib/backups/`: private Vercel Blob logical dumps. Full cron 02:00 UTC, hot cron 14:00 UTC. Hot set = all `lm_*` plus `HOT_PRISMA_TABLES`. Restore: `scripts/restore-from-backup.ts` against `RESTORE_DATABASE_URL` (loopback default). Prove with `npm run test:backups` and `npm run test:backup-roundtrip` (local Postgres). Do not rely on paid Supabase PITR.

## RLS vs app auth

SQL helpers `lm_is_admin()` join Supabase `auth.users` email to Prisma users. The Next.js app does **not** use that for authorization. Logistics auth is NextAuth `isLogisticsAdmin` + `guardLogisticsApi`. Do not “fix” RLS assuming it is the live gate.
