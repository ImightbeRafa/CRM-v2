# Betsy CRM verification map

This directory is the maintained source for verifying the user-facing Soft owner UI. Read this index, then drive one feature file as the recipe. Logistics routes are not in this map.

## Baseline preconditions

- Pick a target origin and export it as `BETSY_VERIFY_BASE_URL`.
  - Read-only contrast or smoke of deployed UI: production origin from `BETSY_API_URL`.
  - A change that is only on a branch, or any write: that branch's existing Vercel Preview URL.
  - A change with no deployment: `http://127.0.0.1:3000` after `npm run dev` is ready.
- `www` and Preview and local dev all use the shared production database. Read-only on `www`. Do not run Prisma migrate or `db push`.
- Sign in as `betsyv2.isolated@betsycrm.test` on tenant `cmteijij70000jsoyedmtfnl1`. Password comes from secure store `betsy-preview` via `BETSY_V2_TEST_PASSWORD`. Never ask Rafael. Never print the password.
- Run `node .cursor/skills/verify-betsy/scripts/doctor.mjs` and require state `READY` before driving.
- Drive only an origin whose latest doctor result is `READY`.

## Driving conventions

- Start every recipe from `/auth/signin` unless its preconditions say the session is already the isolated tenant.
- Prefer ARIA roles and accessible names. Thread rows also expose `data-soft-conv-key`.
- Treat commands in each feature file as literal.
- Run browser actions through Playwright (Chromium). CDP is allowed only with the same roles and assertions.
- Default drives do not click `Probar (sin Meta)`, panic controls, channel connect, or `Enviar`.
- Do not remove files in `../evidence/` during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a screenshot under `../evidence/` and a short markdown note with the feature id, origin, and assertions.
- Contrast proof records computed foreground color.
- Record the feature id and entry point used with every artifact.
- Report an unreachable path with the command you ran and the unmet precondition (`AUTH_BLOCKED`, `TARGET_BLOCKED`, or empty tenant data).
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly four H2 sections in this order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright`
4. `Gotchas`

## Features

- [Agentes contrast](./agentes.md) covers `/config/agentes` sections, dark readable text, and no full document remount when opening conocimiento.
- [Conocimiento wizard](./agentes-conocimiento.md) covers the in-page wizard while the URL stays `/config/agentes`.
- [Soft inbox](./chats.md) covers `/chats`: open a thread and see the composer. Current Soft chrome only.
- [Canales conectados](./social.md) covers `/config/social` loading the channel list without the staff bot.
- [Ventas](./ventas.md) covers `/ventas` loading (not a 404).
