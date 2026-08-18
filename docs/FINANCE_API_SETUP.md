# Betsy Finance API — operator setup

## 1. Generate a key (local machine)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Must be **≥ 24 characters**. Do not commit it. Do not paste it into chat/PRs.

## 2. Put it on Betsy (CRM-v2)

**Local** — add to `.env.local` (gitignored):

```bash
FINANCE_API_KEY=paste_generated_value_here
```

Optional rotation later:

```bash
FINANCE_API_KEY=new_key
FINANCE_API_KEY_PREVIOUS=old_key
```

**Production (Vercel)** — set `FINANCE_API_KEY` for Production (and Preview if you test there), then redeploy so lambdas pick it up.

Until this is set, endpoints return **503**.

## 3. Put the same key on ADs

In `D:\Coder\ADs\.env.local`:

```bash
BETSY_API_URL=https://www.betsycrm.com
BETSY_FINANCE_API_KEY=paste_same_value_here
```

For local CRM testing use `BETSY_API_URL=http://localhost:3000`.

Full consumer contract: `D:\Coder\ADs\docs\BETSY_FINANCE_API.md`.

## 4. Smoke test

```bash
curl -i -H "x-api-key: $FINANCE_API_KEY" https://www.betsycrm.com/api/finance/v1/meta
```

Expect JSON catalog (200). Without header → 401.

curl -s -H "x-api-key: $FINANCE_API_KEY" \
  "[REDACTED]/api/finance/v1/facturacion?brand=deepclean&dateFrom=2026-08-01&dateTo=2026-08-17"

Orders (period bootstrap, DeepSleep):

```bash
curl -s -H "x-api-key: $FINANCE_API_KEY" \
  "https://www.betsycrm.com/api/finance/v1/orders?brand=deepsleep&dateFrom=2026-07-01&dateTo=2026-07-31&limit=50"
```

Manual-assignment inbox:

```bash
curl -s -H "x-api-key: $FINANCE_API_KEY" \
  "https://www.betsycrm.com/api/finance/v1/orders?brand=deepsleep&dateFrom=2026-07-01&dateTo=2026-07-31&needsManualAssignment=1"
```

## 5. Schema note (orders sync)

Orders incremental sync needs `Order.updatedAt`. Column + index add are idempotent:

```sql
ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Order_tenantId_updatedAt_id_idx"
ON "Order" ("tenantId", "updatedAt", "id");
```

One-time backfill (already applied in production — do **not** re-run after go-live or you will reset live `updatedAt` values):

```sql
UPDATE "Order" SET "updatedAt" = "timestamp";
```

Then `npx prisma generate` (already in `npm run build`).
