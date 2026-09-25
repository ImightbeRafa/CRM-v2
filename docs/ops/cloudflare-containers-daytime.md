# Cloudflare Containers — daytime (safe)

Temp hostname only. `www.betsycrm.com` stays on Vercel until Rafael’s madrugada GO.

Image start: `node server.js` (Next standalone), port 3000.

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
