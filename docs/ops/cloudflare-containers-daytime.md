# Cloudflare Containers — daytime (safe)

Temp hostname only. `www.betsycrm.com` stays on Vercel until Rafael’s madrugada GO.

Image start: `node server.js` (Next standalone), port 3000.

## Files (Wrangler bridge)

- `wrangler.jsonc` — Worker `betsy-crm-daytime-smoke`, container image `./Dockerfile`, DO binding `BETSY_CRM_CONTAINER`, class `BetsyCrmContainer`, `max_instances: 1`, migration `v1` (`new_sqlite_classes`).
- `src/cf-container-worker.ts` — Worker entry. Exports `BetsyCrmContainer` (`defaultPort = 3000`, `sleepAfter = "10m"`) and proxies every request to one container instance via `getContainer`.
- `tsconfig.cf-worker.json` — typechecks the Worker (`npm run cf:typecheck`). The Worker file is excluded from the root `tsconfig.json` so Next builds are unaffected.
- `Dockerfile` and the `DISABLE_CRONS` middleware are unchanged.

## Smoke Worker deploy (daytime only)

1. `npm install` (Node >= 22 required by Wrangler).
2. `npm run cf:typecheck`.
3. Deploy with `npx wrangler deploy` (same command Workers Builds runs; `npm run cf:deploy` is an alias). Docker must be available where the image is built.
4. Set secrets and vars in the Cloudflare dashboard or with `npx wrangler secret put <NAME>`. Never commit them.
   - `DISABLE_CRONS=1`
   - `NEXTAUTH_URL` = the temp `*.workers.dev` hostname (`https://…`)
   - `NEXTAUTH_SECRET`, `EMPLOYEE_CODE_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `RESEND_API_KEY`, and any other secrets the app needs.
   - The Worker must forward these to the container (e.g. `envVars` on the Container class) before the app sees them; that is not wired yet.
5. Run the smoke checks below against the temp hostname only.

## Required on the copy

- `DISABLE_CRONS=1` (or `true`) before the container can reach the live database. Every `/api/cron/*` returns 503. Do not run this copy’s crons and Vercel crons together.
- `NEXTAUTH_URL` = the temp hostname (`https://…`).
- Copy secrets in the host UI. Do not put them in git or chat.

## Do not

- Point Meta webhooks (Inbox `/api/chat/webhook` or Staff `/api/bot/whatsapp/webhook`) at the temp host.
- Change DNS, `www`, or Vercel Production.

## Smoke (daytime)

- Login
- `/chats`
- `/config/agentes`

## Domain

DNS / `www` cutover is madrugada only, with Rafael present.
