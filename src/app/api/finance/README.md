# Finance API (external read-only)

Every route under this directory **must** call `guardFinanceApi(req)` before any data access.
This prefix is public in middleware (like `/api/cron`); auth is handler-enforced.

## Endpoints

- `GET /api/finance/v1/meta`
- `GET /api/finance/v1/facturacion`
- `GET /api/finance/v1/costs`
- `GET /api/finance/v1/payroll`
- `GET /api/finance/v1/orders` — order rows with business/channel tags (`unassigned` = finance-app manual inbox)

See `D:\Coder\ADs\docs\BETSY_FINANCE_API.md` for consumer setup.
