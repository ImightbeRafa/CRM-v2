# Betsy agent knowledge base

Canonical architecture for future agents working on this repo. **One Next.js 15 app, two operational surfaces**, one shared Supabase database.

| Surface | Who | Data | Code |
|---------|-----|------|------|
| **Betsy CRM** (client SaaS) | Tenant members (OWNER…VIEWER) | Prisma models in `prisma/schema.prisma` | `/ventas`, `/produccion`, `/estadisticas`, `/config`, `/dashboard`, `/api/orders`, bots, Tilopay |
| **HolaMA Logistics** (personal / internal ops) | `User.isLogisticsAdmin` + warehouse workers | Raw SQL `lm_*` tables (**not** in Prisma) | `/logistics/**`, `/work-clock`, `/api/logistics/**`, `/api/finance/**` |

They share `Order` rows. Logistics overlays `lm_orders.crm_order_id = Order.id` (cuid). There is **no database foreign key**.

## Source precedence

When docs disagree, trust in this order:

1. **`AGENTS.md`** — Cloud gotchas and hard stops (never `prisma db push` against Supabase).
2. **This folder (`docs/kb/`)** — architecture, boundaries, auth, data, flows.
3. **`docs/audits/`** — living slim/WIP ledgers and agent changelog, not architecture.
4. **`DOCUMENTATION.md`** — legacy overview. Treat as stale until a fact is verified in code.
5. **Customer MDX** under `src/content/` — product help, not agent architecture.

Authoritative code always wins over any markdown. Every factual table below names its source file.

## Reading order

1. [SYSTEM_BOUNDARIES.md](./SYSTEM_BOUNDARIES.md) — what is CRM vs logistics vs shared infra
2. [AUTH_AND_TENANCY.md](./AUTH_AND_TENANCY.md) — JWT, membership roles, logistics flag, API keys
3. [DATA_OWNERSHIP.md](./DATA_OWNERSHIP.md) — Prisma vs `lm_*`, backups, ID semantics
4. [ORDER_LOGISTICS_FLOW.md](./ORDER_LOGISTICS_FLOW.md) — how an order moves between the two surfaces
5. [ROUTE_MAP.md](./ROUTE_MAP.md) — curated route families (exhaustive list is generated)
6. [INTEGRATIONS_AND_FINANCE.md](./INTEGRATIONS_AND_FINANCE.md) — Tilopay, bots, Correos, Bitácora
7. [TESTING_RUNBOOK.md](./TESTING_RUNBOOK.md) — safe commands and smoke flows

Generated (do not hand-edit; `npm run kb:generate`):

- [generated/ROUTES.md](./generated/ROUTES.md)
- [generated/LM_SCHEMA.md](./generated/LM_SCHEMA.md)

## Glossary

| Term | Meaning |
|------|---------|
| **Tenant** | SaaS customer org. Prisma `Tenant`. Isolation key is `tenantId`. |
| **Membership** | `User` ↔ `Tenant` with `MemberRole` (OWNER, ADMIN, MANAGER, SALES, PRODUCTION, VIEWER). |
| **Managed tenant** | CRM tenant logistics may operate. Allowlist in `src/lib/logistics-managed-tenants.ts`. |
| **Finance tenant / brand** | Subset of managed tenants exposed to Bitácora. Allowlist in `src/lib/finance-tenants.ts`. |
| **Finance business** | Classifier output (`deepsleep`, `patchhouse`, `purasonrisa`, `bloom`, `deepclean`, `forge`, `unassigned`). DeepSleep is one tenant → three businesses. |
| **EA / RA** | CRM `Order.orderType`: envío a domicilio vs retiro (pickup). |
| **`Order.id`** | Prisma cuid. Logistics join key (`lm_orders.crm_order_id`). |
| **`Order.orderId`** | Tenant-local display id (e.g. `ORDER-…`). Unique per `(tenantId, orderId)`, not globally. |
| **HolaMA** | Internal name of the logistics UI (`src/app/logistics/layout.tsx`). |
| **CE** | Contra entrega (COD). Flags on Prisma `Order` and rows in `lm_ce_payments`. |
| **GD** | Green Delivery / mensajería privada. Ledger: `lm_gd_balance_entries`. |
| **Laura / Marlenn** | RA pickup locations, **not** CRM tenants. Inventory `agent_key = 'laura'` only for Laura Escazú. |
| **Bitácora** | External ads/PnL app. Reads `/api/finance/v1/*` with `FINANCE_API_KEY`. |
| **Legacy MASTER / REGULAR** | Old `User.role`. Middleware maps MASTER → OWNER. Prefer `Membership.role`. |

## First files to open

**CRM:** `prisma/schema.prisma`, `src/middleware.ts`, `src/lib/auth-options.ts`, `src/lib/rbac.ts`, `src/lib/prisma-tenant.ts`, `src/app/api/orders/route.ts`

**Logistics:** `src/lib/logistics-managed-tenants.ts`, `src/lib/logistics-auth.ts`, `src/app/api/logistics/orders/route.ts`, `src/lib/logistics-crm-sync.ts`, `src/lib/retiro-stock.ts`, `supabase/migrations/002_logistics_manager.sql`

**Safety:** `AGENTS.md`, `docs/audits/SAFETY_GATES.md`, `scripts/safe-db-push.mjs`, `src/lib/backups/config.ts`

## When you change the product, update this KB

Run `npm run kb:generate` and commit `docs/kb/generated/` if you add/remove:

- App Router `page.tsx` / `route.ts`
- Prisma models or enums
- `lm_*` `CREATE TABLE` (migration or runtime)

`npm run kb:check` must stay clean. Also update the matching curated file if behavior, auth, or ownership changed — not only the generated lists.

Do **not** put agent architecture into `src/content/` (customer docs) or rewrite `DOCUMENTATION.md` as the source of truth.
