# Route map (curated)

Exhaustive file list: [generated/ROUTES.md](./generated/ROUTES.md). This file is the **semantic** map.

Auth legend:

- **JWT** — NextAuth, middleware injects headers
- **RBAC page** — `requirePermission` / `getSessionWithTenant`
- **LM admin** — `isLogisticsAdmin` (middleware + layout + `guardLogisticsApi`)
- **Handler key** — middleware-public; handler must auth
- **Public** — no session

Tenant column: **scoped** = uses active `tenantId`; **allowlist** = managed/finance ids; **none** = global or public.

## CRM product (tenant members)

| Family | Paths | Auth | Tenant | Data |
|--------|-------|------|--------|------|
| Marketing | `/`, `/home` | Public | none | none |
| Auth UI | `/auth/*` | Public / setup | none → tenant | `User`, `Membership` |
| Setup | `/setup-wizard`, `/setup-tenant` | JWT; wizard needs `update_config` | scoped | Tenant catalogs |
| Hub | `/dashboard` | JWT | scoped | light stats |
| Sales | `/ventas`, `/ventas/dashboard` | `view_sales` | scoped | `Order`, clients |
| Production | `/produccion` | `view_production` | scoped | `Order` Kanban, guías, invoices |
| Stats | `/estadisticas` | `view_statistics` | scoped | aggregations |
| Config | `/config`, `/config/integrations`, `/config/ai-assistant`, `/config/social` | `view_config`; billing UX for OWNER | scoped | catalogs, Tilopay, bot code |
| Exports / backups UI | `/exports`, `/backups` | sales / config | scoped | reads |
| Help | `/help/*` | JWT | none | private MDX |
| Public docs | `/docs/*` | Public | none | public MDX |
| Legal | `/privacy`, `/terms`, `/data-deletion` | Public | none | Meta compliance |
| Super-admin | `/super-admin` | `isSuperAdmin` | bypass | all tenants |
| Chats | `/chats` | **redirect `/dashboard`** | — | disabled |

### CRM APIs

| Family | Prefix | Auth | Notes |
|--------|--------|------|-------|
| Orders / sales | `/api/orders/*`, `/api/sales/*` | JWT | Often `authenticateAPI` only — not full RBAC |
| Config / users / tenant | `/api/config/*`, `/api/users/*`, `/api/tenant/*`, `/api/setup/*` | JWT | |
| Stats | `/api/estadisticas/*` | JWT | |
| Invoices | `/api/invoices/*` | JWT | Customer facturas. Email route currently logs success without sending (Phase 1 W4) |
| Shipping | `/api/shipping/*` | JWT | Tenant Correos guías |
| Bot (authenticated) | `/api/bot/*` except webhooks | JWT | Access code, sessions |
| Integration | `/api/integration/*` | **API key** (public prefix) | External websites |
| Super-admin | `/api/super-admin/*` | super-admin | |
| Catch-all | `/api/[...catch-all]` | JWT | Do not hide new APIs behind this |

## Logistics (HolaMA)

All `/logistics/*` and `/api/logistics/*`: **LM admin**. Data: Prisma `Order` (managed tenants) + `lm_*`.

| UI | Purpose |
|----|---------|
| `/logistics` | Dashboard |
| `/logistics/carriers` (+ `/correos`, `/mensajeria`) | Assign carrier/status |
| `/logistics/mensajeria-privada` | Private courier confirm/pay/archive |
| `/logistics/retiros` | RA Laura / Marlenn |
| `/logistics/guias` (+ `/correos`, `/mensajeria`) | Guía generate/history |
| `/logistics/accounting` | Per-tenant cost / CE / GD |
| `/logistics/workforce` | Employees, schedule, punches, payroll |
| `/logistics/reports` | Period reports + PDF |
| `/logistics/config` | Rates, tenant display, Correos WS, feedback |
| `/logistics/admin` | Profitability, revenue, usage, op costs |

Nav: `src/app/logistics/nav-items.ts`.

API groups: orders, carriers/guias/correos, retiros, contra-entrega, billing-weeks, workforce, admin, reports. See generated inventory for methods.

## Workforce

| Path | Auth | Data |
|------|------|------|
| `/work-clock` | Public + HMAC code | `lm_employees`, shifts, time entries |
| `POST /api/work-clock/lookup` | Public, rate-limited | |
| `POST /api/work-clock/punch` | Public, rate-limited | |

## Billing (SaaS Tilopay)

`/api/billing/*`, `/api/tilopay/*`. Webhooks/callback are **public prefixes** — verify signatures in handler (`src/lib/tilopay.ts`). Incomplete: token cache, webhook hash (Phase 1 W3). `/api/stripe/webhook` exists as a public prefix; do not assume Stripe is a live product path.

## Bots and social webhooks (must stay public)

| Path | Provider |
|------|----------|
| `/api/bot/telegram/webhook`, `/health` | Telegram |
| `/api/bot/whatsapp/webhook` | WhatsApp Cloud |
| `/api/chat/webhook` | Meta (IG/WA/FB) |
| `/api/auth/instagram/data-deletion` | Meta |

Deleting these because Knip flags them unused is a hard stop (`docs/audits/SAFETY_GATES.md`).

## Finance (Bitácora)

Middleware-public. `guardFinanceApi` required on every route (`src/app/api/finance/README.md`).

- `GET /api/finance/v1/meta`
- `GET /api/finance/v1/facturacion`
- `GET /api/finance/v1/costs`
- `GET /api/finance/v1/payroll` — **global**, not per brand
- `GET /api/finance/v1/orders`

Allowlist: `src/lib/finance-tenants.ts`. Operator setup: `docs/FINANCE_API_SETUP.md` (do not copy secrets).

## Cron / backups

`/api/cron/*` — `CRON_SECRET` in handler. Backup implementation `src/lib/backups/`. UI `/backups` is tenant config, not the Blob dump admin.

## Adding a route

1. Put it in the correct tree (`src/app/api/logistics` vs `src/app/api/orders`, etc.).
2. If the prefix is middleware-public, add handler auth **before** any data access.
3. Run `npm run kb:generate` and update this file’s family table if you added a new family.
4. Do not add CRM features under `/logistics` or LM features under `/ventas`.
