# Cloudflare Containers — daytime + madrugada cutover prep

Temp hostname: `https://betsy-crm-daytime-smoke.rafaeser.workers.dev`.
`www.betsycrm.com` stays on Vercel until CoS coordinates the flip (after Meta secrets + Vercel cron disable).

Image start: `node server.js` (Next standalone), port 3000.

## Files (Wrangler bridge)

- `wrangler.jsonc` — Worker `betsy-crm-daytime-smoke`, container image `./Dockerfile`, DO binding `BETSY_CRM_CONTAINER`, class `BetsyCrmContainer`, `max_instances: 1`, migration `v1`, **triggers.crons** (8 unique schedules covering the 9 Vercel cron paths).
- `src/cf-container-worker.ts` — Worker entry. Exports `BetsyCrmContainer` (`defaultPort = 3000`, `sleepAfter = "24h"`), forwards production runtime keys via `CONTAINER_ENV_KEYS` / `envVars`, proxies HTTP to the container, and implements `scheduled` → internal `GET` with `Authorization: Bearer ${CRON_SECRET}`.
- `tsconfig.cf-worker.json` — typechecks the Worker (`npm run cf:typecheck`).
- `Dockerfile` and the `DISABLE_CRONS` middleware are unchanged.

## Cron map (UTC, same as `vercel.json`)

| Schedule       | Paths |
|----------------|-------|
| `0 2 * * *`    | `/api/cron/backup`, `/api/cron/process-subscription-expiry` |
| `0 14 * * *`   | `/api/cron/backup/hot` |
| `*/5 * * * *`  | `/api/cron/bot-inbox` |
| `*/1 * * * *`  | `/api/cron/chat-automation` |
| `30 3 * * *`   | `/api/cron/chat-agent-retention` |
| `0 5 * * *`    | `/api/cron/logistics-report` |
| `0 18 * * SUN`   | `/api/cron/logistics-finalize` |
| `0 6 * * *`    | `/api/cron/chat-token-health` |

While `DISABLE_CRONS=1` (or `true`) on the Worker, `scheduled` logs and returns without calling the container. App middleware also 503s `/api/cron/*`. Dual crons with Vercel are forbidden once CF crons are live — clear `DISABLE_CRONS` only after Vercel crons are off.

## Smoke Worker deploy (prep)

1. `npm install` (Node >= 22 required by Wrangler).
2. `npm run cf:typecheck`.
3. Deploy with `npx wrangler deploy` (or `npm run cf:deploy`). Docker must be available where the image is built.
4. Secrets: `npx wrangler secret put <NAME>` (never commit / never paste values into chat).
   - Keep `DISABLE_CRONS=1` until flip.
   - Keep `NEXTAUTH_URL=https://betsy-crm-daytime-smoke.rafaeser.workers.dev` until flip.
   - Forwarded keys include Meta/WA/IG, Blob, Telegram, Tilopay, Correos, Finance, backup, and server-readable `NEXT_PUBLIC_*`.
5. Smoke against the temp hostname only (login, `/chats`, `/config/agentes`). Do **not** point Meta webhooks at workers.dev.

## NEXT_PUBLIC_* note

Client bundles embed `NEXT_PUBLIC_*` at **Docker build** time. The daytime Dockerfile does not bake production public Meta IDs into the client bundle. Server-side `process.env.NEXT_PUBLIC_*` still works if secrets are forwarded. For full Embedded Signup UI on CF, rebuild the image with build-args for those public IDs (or accept client stubs until a dedicated image rebuild).


## Instance size + NEXT_PUBLIC bake (post-flip fix 2026-09-26)

- `instance_type`: **`standard-2`** (1 vCPU / 6 GiB). Default `lite` (256 MiB) OOMs / starves Next.js.
- `sleepAfter`: **`24h`** (unchanged in `src/cf-container-worker.ts`).
- Dockerfile accepts `ARG`/`ENV` for `NEXT_PUBLIC_*` Meta Embedded Signup IDs; Wrangler `containers.image_vars` supplies Vercel Production public values at image build. Runtime Meta secrets remain Worker secrets forwarded via `CONTAINER_ENV_KEYS`.

## Madrugada cutover order (CoS)

1. **Secrets complete** on Worker (Meta + all prod keys). Verify smoke still OK on workers.dev.
2. **Deploy** latest Worker (`npx wrangler deploy --keep-vars` if only code changed).
3. **Disable Vercel crons** (see below) — do this *before* enabling CF crons / attaching www.
4. **Attach custom domain / DNS** for `www.betsycrm.com` → this Worker (Cloudflare dashboard Workers → Custom Domains, or `wrangler` routes). Zone already on account `ca21a6b8a41eec14f2b9d4455d048ca5`.
5. **Set** `NEXTAUTH_URL=https://www.betsycrm.com` (and optionally `BETSY_API_URL` / `NEXT_PUBLIC_APP_URL`):
   ```bash
   printf '%s' 'https://www.betsycrm.com' | npx wrangler secret put NEXTAUTH_URL --name betsy-crm-daytime-smoke
   ```
6. **Clear DISABLE_CRONS** (delete secret or set empty / remove):
   ```bash
   npx wrangler secret delete DISABLE_CRONS --name betsy-crm-daytime-smoke
   ```
   Then redeploy or restart container so envVars refresh as needed.
7. **Smoke** www + one manual cron curl (Bearer CRON_SECRET). Update Meta Inbox webhook to www only when CoS confirms (never Staff `/api/bot/whatsapp/webhook` in this cutover).

## Disable Vercel crons (safe methods — report; CoS executes)

**Preferred (dashboard):** Vercel → project `crm-v2` → Settings → Cron Jobs → disable/remove each of the 9 paths (or pause Production crons if UI offers it).

**API (names only; needs Vercel token):** remove or empty the `crons` array via project deploy config — safest operational path is a temporary commit/deploy of `vercel.json` with `"crons": []` on Production, or use Vercel dashboard. Do **not** leave CF `DISABLE_CRONS` cleared while Vercel still schedules the same paths.

**Do not** delete the Vercel project; only stop cron invocations.

## Manual cron smoke (workers.dev or www — no secret values in logs)

```bash
# Export CRON_SECRET in your shell first (do not echo it).
BASE=https://betsy-crm-daytime-smoke.rafaeser.workers.dev
for path in \
  /api/cron/backup \
  /api/cron/backup/hot \
  /api/cron/process-subscription-expiry \
  /api/cron/bot-inbox \
  /api/cron/chat-automation \
  /api/cron/chat-agent-retention \
  /api/cron/logistics-report \
  /api/cron/logistics-finalize \
  /api/cron/chat-token-health
do
  echo "GET $path"
  curl -sS -o /tmp/cron-out.json -w "%{http_code}\n" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${BASE}${path}"
  # Expect 503 while DISABLE_CRONS=1; 200 after clear (backup may take longer).
done
```

## Rollback

1. Re-point `www.betsycrm.com` Custom Domain / DNS back to Vercel (or remove Worker custom domain so zone record returns to previous Vercel target).
2. Re-enable Vercel crons (restore `vercel.json` crons / dashboard).
3. On Worker set `DISABLE_CRONS=1` again and keep or remove CF cron triggers.
4. Restore `NEXTAUTH_URL` on Vercel Production if changed.

## Do not

- Point Meta webhooks (Inbox `/api/chat/webhook` or Staff `/api/bot/whatsapp/webhook`) at the temp host.
- Clear `DISABLE_CRONS` or attach www while Vercel crons still run.
- Touch Staff Meta app / Staff WhatsApp webhook path in this cutover.
