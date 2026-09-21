---
name: verify-betsy
description: >-
  Drive the Betsy CRM web UI (Next.js 15, Soft owner pages) the way an owner
  does and capture proof. Use for verify-betsy, "prove this Soft page",
  contrast/readability checks, inbox/social/ventas smoke, or before claiming
  a /config/agentes or /chats change works.
---

# Verify Betsy CRM

Primary surface is the **web UI** (Soft owner pages). Secondary surfaces (API webhooks, crons, staff bot) are out of scope for this skill. Logistics routes (`/logistica`, `lm_*`) are out of scope entirely.

This skill verifies **current Soft chrome**. Do not redesign Soft Copilot, restyle the inbox, or mix the staff bot into the CRM inbox while verifying.

## Targets

| Target | When | Mutations |
|---|---|---|
| Existing Vercel Preview URL for the branch under test | Preferred whenever the check can change data, or when the change is not on production yet | Preview still uses the shared production database. Prefer it over `www` for anything that writes. |
| Production origin (`BETSY_API_URL`) | Read-only contrast and smoke of what is already deployed | Read-only only. Production www is shared. |
| `npm run dev` on port 3000 | The change is not on a deployment and local env is already up | Same shared database. Do not point Prisma at another database. |

Set `BETSY_VERIFY_BASE_URL` to the origin you are driving (no trailing slash). When it is unset, doctor and drive use `BETSY_API_URL` (the public production origin).

All three targets talk to the shared Supabase database. Never run `prisma db push`, `prisma migrate`, or `npm run db:push` as part of verification.

## Auth

Sign-in URL is `/auth/signin` (there is no `/login`).

| Field | Value |
|---|---|
| Email | `betsyv2.isolated@betsycrm.test` (`BETSY_V2_TEST_EMAIL` overrides) |
| Password | Secure store entry **`betsy-preview`**, exported only as `BETSY_V2_TEST_PASSWORD` for the node process |
| Tenant | `cmteijij70000jsoyedmtfnl1` (`betsyv2-isolated-test`) |

Load the password yourself from that secure store. Do not ask Rafael, do not commit it, do not print it, and do not write it into evidence notes. If it is unset, doctor reports `AUTH_BLOCKED` and the drive stops. Do not register a substitute user on the shared database to get past that.

## Launch

**Remote (preferred for proof of deployed UI).** Nothing to start. Doctor must show the sign-in page on `BETSY_VERIFY_BASE_URL` before any drive.

**Local**, only when the change is not deployed:

```bash
npm run dev
```

Ready when `http://127.0.0.1:3000/auth/signin` returns the heading `Iniciar sesión`. Keep `NEXTAUTH_URL` on the same host you open (`localhost` and `127.0.0.1` do not share cookies). Required in `.env` (gitignored): `NEXTAUTH_SECRET`, non-empty `RESEND_API_KEY`, `NEXTAUTH_URL=http://localhost:3000`. Injected `DATABASE_URL` / `DIRECT_URL` override `.env` and point at shared Supabase.

Do not run `npm run build` while `npm run dev` is serving. The production `.next` output overwrites unhashed client JS and the sign-in form submits without hydrating.

Playwright's packaged `npm run test:e2e` starts a standalone server on port **3106** (`e2e/start-standalone.mjs`). This skill does not use that server. It drives the origin in `BETSY_VERIFY_BASE_URL` with the helper scripts below.

## Doctor

Run this first whenever anything looks off, and again after a failed drive before retrying.

```bash
node .cursor/skills/verify-betsy/scripts/doctor.mjs
```

Read-only. It checks:

- Chromium can launch (Playwright).
- `BETSY_VERIFY_BASE_URL/auth/signin` renders the heading `Iniciar sesión`.
- The evidence directory is writable.
- When `BETSY_V2_TEST_PASSWORD` is set: credentials sign-in reaches `/dashboard`, and `/api/auth/session` is the isolated tenant. The password is never printed.

Stdout is one JSON line. `state` is one of:

| State | Meaning | Exit |
|---|---|---|
| `READY` | Sign-in page is up and the isolated session matches | 0 |
| `AUTH_BLOCKED` | Sign-in page is up, password missing or session is the wrong tenant | 2 |
| `TARGET_BLOCKED` | Origin down, HTTP error, Vercel deployment protection, or Chromium missing | 3 |

Do not drive a target whose latest doctor state is not `READY`.

## Drive

Harness is **Playwright** (Chromium), using accessible roles, names, and routes. Browser CDP is acceptable when Playwright cannot attach; keep the same roles and assertions.

Sign-in sequence (every authenticated drive):

1. Open `/auth/signin`.
2. Heading `Iniciar sesión` is visible. Placeholder `tu@email.com` is visible.
3. Fill the email textbox and the password textbox. Click the button `Ingresar`.
4. URL matches `/dashboard`.
5. `GET /api/auth/session` returns `user.email` = the QA email and `user.tenantId` = `cmteijij70000jsoyedmtfnl1`.

Then follow the feature file. Stable handles used across the map:

- `/config/agentes` heading `Agentes de chat`. Sections: `Identidad`, `Voz`, `Herramientas`, `Modo`, `Conocimiento`, `Probar`, `Pánico`.
- Probar button name: `Probar (sin Meta)`. Do not click it on `www` (it calls the model).
- Conocimiento button: `Abrir wizard`. Checklist cards are buttons whose names include `Precios`, `Envíos`, `Ofertas`, or `Políticas`.
- `/chats` heading `Inbox`. Bucket buttons: `Tus chats`, `Abiertos`, `IA manejando`, `Sin asignar`, `Hechos`. Thread rows are `button` elements with `data-soft-conv-key`. Composer is a `textarea` whose placeholder is `Escribí un mensaje… Enter envía · Shift+Enter nueva línea`, `Mensaje… Enter envía`, or `Tomá control o pausá la IA para escribir`.
- `/config/social` heading `Canales conectados`. Channel sections `Instagram` and `WhatsApp`.
- `/ventas` stays on `/ventas`. Button name `Agregar orden`. Card title `Historial de Ventas`.

One-command proof for agentes contrast (read-only, the feature to run first):

```bash
node .cursor/skills/verify-betsy/scripts/drive-agentes-contrast.mjs
```

That script signs in, opens `/config/agentes`, asserts section headings and dark computed text on the title, `Probar`, `Voz`, and the Probar textarea, installs a `window` sentinel, clicks `Abrir wizard`, and asserts the URL is still `/config/agentes` and the sentinel survived (no full document remount). It does not click `Probar (sin Meta)`, edit fields, seed an agent, or use panic controls.

Other features are driven from their map files with the same Playwright session shape. A proof of one entry point does not cover the others.

## Evidence

Write proof under `.cursor/skills/verify-betsy/evidence/` (gitignored). Each drive writes:

- Screenshots of the **action and the resulting state**, not only the final screen.
- `proof-agentes-contrast.md` (or the feature's own note) with target origin, git SHA if local, UTC time, tenant email (never the password), checks, computed colors, and `mutations: none` when the drive did not write.

Standards:

- Exercise the real user path (`/auth/signin` → the page). Do not call internal setters or test-only endpoints to fake the screen.
- UI proof includes the screenshot plus the assertion results in the markdown note (heading names, URL, computed color, sentinel).
- Contrast proof uses computed foreground color, not only the `text-slate-900` / `!text-slate-900` class string.
- Side effects: default drives are read-only. If a later drive must write, do it on a Preview URL, stay on tenant `betsyv2-isolated-test`, and record what changed.
- Do not mock the CRM UI. External systems (Meta, Tilopay, Correos, Resend) stay untouched; do not click connect, pay, or send.

## Cleanup

Doctor and drive close the Chromium process they launched. Do not `pkill` by name. If a local `npm run dev` was started for this run, stop that process by its PID.

Cleanup removes the browser and any scratch file named `.doctor-write`. It does **not** delete `evidence/`. After cleanup, the screenshots and proof note must still be in `.cursor/skills/verify-betsy/evidence/`.

## Helpers

Both scripts are executable and live next to this skill. Run them from the repo root. They load Playwright from the repo dependency (`@playwright/test`). If Chromium is missing, install it once with `npx playwright install chromium` and rerun doctor.

```bash
node .cursor/skills/verify-betsy/scripts/doctor.mjs
node .cursor/skills/verify-betsy/scripts/drive-agentes-contrast.mjs
```

Optional environment (do not commit):

```bash
BETSY_VERIFY_BASE_URL=   # optional; defaults to BETSY_API_URL
BETSY_V2_TEST_EMAIL=betsyv2.isolated@betsycrm.test
BETSY_V2_TEST_PASSWORD=...   # from secure store betsy-preview, process env only
BETSY_V2_TEST_TENANT_ID=cmteijij70000jsoyedmtfnl1
```

Feature recipes: [features/README.md](features/README.md).

## Maintenance

When Soft pages change, run `/maintain-verification-skill` so this map stays honest. Do not merge to `dev` from a verification run unless Rafael explicitly says to merge.

## Hard locks

- Verify current Soft chrome. Soft Copilot redesign is on hold.
- Staff bot never appears as a CRM inbox channel. `/chats` is customer WA/IG. `/config/social` says the staff bot is not there.
- Skip every logistics route.
- `www` is shared production. Read-only contrast and smoke only. Mutating checks use a Preview URL.
- Do not merge to `dev` as part of this skill.
