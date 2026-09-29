# Aurora release → Cloudflare (www.betsycrm.com)

Release candidate: branch `rafa/aurora-on-live`, PR #88 (base `claudio/team-users-sota` = code live
on www today). **Only with Rafael's explicit GO, in the madrugada.** No DB migration is part of this
release (032 indexes are optional and stay unapplied), so rollback is code-only.

## 0. Before the night (day, read-only)
- [ ] PR #88 reviewed: verifier PASS WITH NOTES (fixed), SecureDog OK (fixed); Notion register has no
      Critical/High open.
- [ ] Railway preview (`betsy-crm-pr72`) green on the exact commit to ship; walkthrough done.
- [ ] Machine for the deploy has **Docker running** (the image is built locally by wrangler) and
      `CLOUDFLARE_API_TOKEN` in its environment (never pasted in chat).
- [ ] Secret names present on the Worker (names only):
      `npx wrangler secret list --name betsy-crm-daytime-smoke`
      Must include at least: DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, ENCRYPTION_KEY,
      BLOB_READ_WRITE_TOKEN, RESEND_API_KEY, CRON_SECRET, META_* keys. Optional: UPSTASH_REDIS_REST_URL /
      _TOKEN (separate production DB — see docs/ops/upstash-redis.md).

## 1. Record the rollback target (2 min)
```bash
npx wrangler deployments list --name betsy-crm-daytime-smoke
```
Write down the **current** version id (what www runs now). That id is the rollback.

## 2. Deploy (≈10–15 min, image build included)
```bash
git fetch origin && git checkout rafa/aurora-on-live && git reset --hard <approved-commit>
npm ci
npx wrangler deploy
```
This also turns off the `*.workers.dev` / preview URLs (INFRA-03) and ships the worker hardening
(cf-connecting-ip for rate limits, stripped internal headers).

## 3. Smoke on www (10 min) — stop at the first failure and roll back
1. Sign in (Google **and** password) → /dashboard loads, greeting without email.
2. /chats: list loads, open a chat, send a text to **your own phone** on a real line, receive a reply
   (WhatsApp) — and one Instagram message in/out.
3. /ventas: open a pedido detail; create a test order in the test business (PeterTesting), delete it.
4. /produccion loads with orders; /estadisticas; /config?tab=users; /config?tab=social (lines healthy).
5. Tail logs while doing this: `npx wrangler tail betsy-crm-daytime-smoke` — no 5xx bursts.
6. Next morning: confirm the 02:00 UTC backup ran (Respaldos page on www).

## 4. Rollback (≈2 min)
```bash
npx wrangler rollback <previous-version-id> --name betsy-crm-daytime-smoke
```
Restores the previous Worker + container image. Nothing to undo in the database. Then re-run smoke
steps 1–2 on www.

## After
- Rafael merges PR #88 when satisfied (agents never merge).
- Turn on `chat_outbound_media_v1` only for a tenant with a tested line.
- Update Notion (Aurora tablero + security register) and `docs/audits/CHANGELOG_AGENTS.md`.

## Outage: Error 1101 / "internal error; reference = …" on every request
1. `npx wrangler tail betsy-crm-daytime-smoke --format pretty` — if the exception is `internal error;
   reference = …` the Worker cannot reach its container (platform side, our code never ran).
2. `npx wrangler containers list` + `npx wrangler containers instances <id>` — look for an instance
   stuck `inactive`. The Worker fails over to `betsy-standby-1` automatically (since 2026-09-29).
3. If both are stuck: bump the names in `src/cf-container-worker.ts` (`CONTAINER_INSTANCE_NAME`,
   `STANDBY_INSTANCE_NAME`) and `npx wrangler deploy` — a new name = a fresh container. A plain
   redeploy does **not** reset a stuck object.
4. Still down → Cloudflare support with the reference ids from step 1.
5. Build crash `Cannot create property '_interopRequireDefault'` during "Collecting build traces" is
   transient: re-run the deploy.
