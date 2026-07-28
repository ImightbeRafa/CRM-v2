# Finance API (external read-only)

Every route under this directory **must** call `guardFinanceApi(req)` before any data access.
This prefix is public in middleware (like `/api/cron`); auth is handler-enforced.

See `D:\Coder\ADs\docs\BETSY_FINANCE_API.md` for consumer setup.
