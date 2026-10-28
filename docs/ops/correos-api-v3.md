# Correos de Costa Rica — API v3 (REST) go-live runbook

Branch `claude/correos-v3`. Built 2026-10-28 next to the legacy SOAP Web Service, which stays as it is and stays
the default. Review of what v3 adds: `docs/plans/correos-api-v3-review-2026-10-28.md` (main checkout).

## What ships

| Piece | Where | Off until |
|---|---|---|
| v3 client, geo cache, validation, provider selection | `src/lib/correos/v3/` | platform switch on |
| Platform settings (user, encrypted password, test/prod, switch, pickup cédula/email) | Logística › Config › Correos CR › "API v3" (`/api/logistics/correos-v3`) | — |
| Store opt-in, origin place, default weight, pickup contact | Configuración › Envíos (setup wizard Correos step) | platform switch on (the toggle is hidden before) |
| Guía dialog: package, address check, restricted zones, branch picker, live price, PDF + thermal ZPL, tracking timeline, pickups | `GuiaGenerator.tsx` + `produccion/components/correos/` | store chose v3 |
| Logistics bulk: once-per-order claim (new for SOAP too), v3 per store, chunks of 10 | `api/logistics/guias/generate-bulk` | claim is live on deploy |
| Tracking sync cron (every 5 min) | `api/cron/correos-tracking` | `CORREOS_TRACKING_SYNC=1` + v3 on in **prod** |
| Inbox agent tools `find_correos_branches`, `check_correos_address` | soft-ai tool runner | enabled per agent in /config/agentes |
| Data | `supabase/migrations/065_correos_v3.sql` | applied with `BETSY_V2_APPLY_FILES=065` |

Without 065 everything still works; the v3 extras (ZPL, branch, tracking history, pickups) are simply not stored.

## Go-live steps (each needs Rafael's GO)

1. **Correos**: get the test account working (the test login at `servicios.correos.go.cr:459` returns
   `401 Credenciales no válidas` with the user/password in the test manual). Ask them too:
   what `variable1`–`variable16` mean (is one of them contra-entrega / declared value?), how to cancel a guía,
   what `montoFlete` must contain, rate limits, size units (cm?), the custom `envioId` format.
2. **Smoke on test** (read-only, then one test guía):
   ```bash
   npx tsx --import ./scripts/shim-server-only.mjs scripts/correos-v3-smoke.ts
   CORREOS_V3_SMOKE_ALLOW_WRITE=1 npx tsx --import ./scripts/shim-server-only.mjs scripts/correos-v3-smoke.ts --register
   ```
   Uses `CORREOS_V3_TEST_*` from `.env.local` (never commit it).
3. **Network**: production traffic goes through the Jetson relay (`CORREOS_PROXY_URL`). Add a route
   `/v3/test/* → https://servicios.correos.go.cr:459/api/v3/*` and `/v3/prod/* → https://amistadpro.correos.go.cr:449/api/v3/*`
   (same `X-Correos-Secret` check), or set `CORREOS_V3_BASE_URL` / `CORREOS_V3_TEST_BASE_URL` to bypass it.
   Ask Correos whether the relay IP must be allow-listed for port 449.
4. **SQL**: apply 065 (`BETSY_V2_APPLY_FILES=065`), then move the three tables from `PENDING_LM_TABLES` to
   `REQUIRED_LM_TABLES` in `src/lib/backups/config.ts`.
5. **Deploy** the branch (merged onto the live line).
6. Set `CORREOS_V3_ALLOWED=1` on the host that should talk to Correos v3 (production only; never on the
   Railway preview, which shares the database: without this flag the DB switch does nothing there).
   On Cloudflare: `npx wrangler secret put CORREOS_V3_ALLOWED` (and later `CORREOS_TRACKING_SYNC`), then redeploy;
   the Worker forwards only the keys listed in `CONTAINER_ENV_KEYS` (src/cf-container-worker.ts), v3 keys included.
7. Logística › Config › Correos CR › API v3 (super admin only): user, password, client code, service 1564,
   environment **Pruebas**, the pilot store's tenant id under "Tiendas que pueden usar v3", check "Habilitar",
   Guardar, "Probar conexión".
8. The pilot store: setup wizard › Envíos → origin place, weight, its own pickup cédula/email, "Usar la nueva API".
   Make a branch guía and a home guía on test, check PDF, ZPL, tracking.
9. Switch the platform to **Producción** with the prod password, repeat one real guía, then turn on
   `CORREOS_TRACKING_SYNC=1` (and later `CORREOS_TRACKING_LM_STATUS=1` once the status words are confirmed).

Rollback: uncheck "Habilitar v3" (everything goes back to SOAP within a minute, the config cache is 60 s).

## Limits and gates (SecureDog review 2026-10-28)

- v3 is on only with the DB switch **and** `CORREOS_V3_ALLOWED=1` on the host.
- A store writes (guías, pickups) through v3 only if it is in `correos_v3_tenants` and chose v3 itself.
- A store tracks / picks up / downloads labels only for completed Correos guías it holds alone; a hand-typed
  (manual) number never counts, and a manual number already used by another store is refused.
- Pickups: the store's own cédula + email (never the platform's), max 5 per store per 24 h, a guía only once
  per 24 h, 5 write calls / min / store (Upstash). Reads: 120 / min / store.
- Correos' negotiated discount is not shown to stores (only the total).
- Retention (open): ZPL labels, receiver names and GPS events have no purge rule yet; add them to the
  Ley 8968 export / erase work before many stores use v3.

## Safety rules kept

- One Correos guía per order: the claim `correos-guia:<Order.id>` is shared by the store flow, the logistics bulk
  screen and the staff bot. v3 data checks run before the claim; a clean Correos refusal releases it (retry works);
  a timeout after sending keeps it (`provider_unknown`) until a person checks Correos.
- Guía and pickup calls are never retried automatically.
- The staff bot (Telegram / WhatsApp) is untouched and stays on SOAP.
- Inbox agents only read (branches, address check, tracking). They never quote Correos' price: the store's own
  shipping price stays the truth.
