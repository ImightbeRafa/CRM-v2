# Agent Changelog

Append-only. Newest entries at the top.

## 2026-09-21 — Chat inbox backfill: resume repairs stale aggregates

- Bugbot HIGH after #42: interrupted `chat-inbox-backfill --apply` can link
  messages then die before `recomputeAggregates`. Rerun `fetchBatch` skips
  `conversationId` rows, `touched` stays empty, seed `inboundCount` /
  `messageCount` 0 never get repaired.
- Apply now runs `repairConversationAggregates` after duplicate marking:
  tenant-scoped count mismatch ∪ `touched`, even when the current run linked
  nothing. Report includes `aggregateRepair`.
- Offline `node:test` in `chat-inbox-backfill-repair.test.ts` (added to
  `test:chat-harden`). No 024/025/026/027/027b/028 apply, no shared `--apply`, staff bot untouched.
- Rebased onto `dev` after #58 (`4a59dc3` A2 knowledge; parent `3beb5e1`
  #57). Resume-aggregate repair kept. #58 knowledge layer (028 gated), #57
  introductionNames, #56 agentes single-write + audit-after-commit, #55
  `session-permissions` / `server-only` browser hotfix, #54 Agent Layer
  runtime (027 gated, `chat_agent_layer_v1` off, `aiFullUnlock` empty),
  #51 self-serve, #50 media / Soft-AI queue / template cache / windowing,
  #46 channel identity, #45 send/echo stamp, escalate `aiMode`, aggregate
  monotonicity, and WA OAuth/36008 left as on `dev`. Did not import #47
  about:blank or #49 charset/Graph cap. 024/025/026/027/027b/028 SQL still
  not applied; `chat_inbox_v2` / `chat_agent_layer_v1` not toggled;
  `aiFullUnlock` not written.
- Prove: `npx tsx --test src/lib/__tests__/chat-inbox-backfill-repair.test.ts`
  + `npm run test:chat-harden`.

## 2026-09-23 — Instagram reconnect no longer 500s on SocialAccount P2002

- `upsertInstagramSocialAccount` updates the same-tenant Instagram row (active or
  inactive) and refreshes token, expiry, user, and channel identity.
- An active `(platform, accountId)` owned by another tenant — partial unique from
  `025_chat_inbox_uniques.sql`, or a legacy unique on those two columns — returns
  `InstagramSocialAccountConflictError`. Callback and complete render Spanish HTML
  409. The other tenant's row is not modified.
- Create races that hit P2002 re-read and update the same-tenant row. Unrelated
  errors still propagate.
- Prove: `src/lib/__tests__/instagram-social-account.test.ts` (in-memory delegate;
  no live DB writes). Included in `npm run test:security`.
- Out of this slice: bot paths, Soft chrome, schema/SQL, Meta Submit.

## 2026-09-22 — P4: monitor attribution in /chats (AT-WA-3, G23)

- Agent-layer delivery in `agent-turn.ts` snapshots `agentName` and `agentEmoji` onto the
  outbound `ChatMessage` metadata, next to `softAi`, `agentId`, and `turnId`.
- `softAiOutboundLabel` in `agent-inbox-projection.ts` reads that snapshot only.
  Agent layer → `<emoji> <name> envió` (emoji omitted when the snapshot is blank).
  Legacy Soft AI (`softAi` without `agentId`) and rows that have `agentId` but no stored
  name stay `IA envió`. The label never looks up the current binding.
- `SoftThreadPane` bubble footer uses the helper. Demo bubbles stay `IA envió`.
  SoftSlimNav, SoftInboxBuckets, and SoftCopilotRail are untouched.
- Out of this slice: P5 live phone proof, unlock/Probar, staff bot, Soft chrome, schema/SQL,
  Meta Submit, Vercel.
- Prove: `npm run test:soft-ai-agent` and `npm run test:chat-harden`. Screenshots wait for
  the Railway eye-test after CoS attaches this branch. Stable `dev` host:
  https://betsy-crm-production.up.railway.app
- Plan: `docs/plans/betsy-forge-wa-probar-live-fidelity-grok47-fable-2026-09-22.md` §5 P4.

## 2026-09-22 — P3: audited unlock gate (AT-P-3, AT-P-4)

- Decisions in force: **D1 off** (`strictUnlockVersion` default false; hash + agentId + model
  bound; version recorded and warned), **D2 on** (five forge-wa-v2 canaries through
  `runAgentTestTurn`), **D3** unchanged (Avanzado PATCH, no SQL).
- `AiFullUnlockRecord` accepts optional `agentId`, `agentVersion`, `model`, `canaryCount`.
  `hasAiFullUnlock` / `aiFullUnlockStatus` fail closed on hash, agent, or model mismatch.
  Resolver and pre-send gate 10 pass that context (G6).
- `mutateChatAgentLayerConfig` locks `TenantFeatureFlag` with `SELECT … FOR UPDATE`.
  Allowlist, panic remove, and unlock write go through it. Audit stays after commit (G9, P2028).
- Rebind or deactivate deletes `aiFullUnlock[accountId]` (G4). Shortcut create, update, and
  delete bump `ChatAgent.version` in the same transaction (G10). `expectedVersion` consumers
  are unchanged, so an in-flight turn fails `stale_version`.
- Replay stays read-only and accepts optional `socialAccountId`, returning `boundAgentId` (G3).
- `POST /api/chat/agents/[id]/test/unlock` (`update_config`) writes the record and audits
  `chat_agent_ai_full_unlock`. Refusals: `ACCOUNT_NOT_TENANT`, `ACCOUNT_NOT_ALLOWLISTED`,
  `ACCOUNT_NOT_WHATSAPP`, `AGENT_NOT_BOUND`, `AGENT_NOT_LIVE`, `REPLAY_FAILED`,
  `HASH_MISMATCH`, `CANARY_FAILED`, `TEST_BUDGET_BLOCKED`, `XAI_NOT_CONFIGURED`.
  Canaries ignore `flag_off` so approval does not depend on ops flags. `unlockCanaries: false`
  skips them.
- UI: Pruebas internas **Aprobar envío real** with confirm; Canales shows envío real
  desbloqueado / bloqueado / aprobación vencida. Copy says Betsy chat / agentes / Probar.
- Out of this slice: P4 monitor label, P5 live phone proof, staff bot, Soft chrome, schema/SQL,
  Meta Submit, Vercel.
- Prove: `npm run test:soft-ai-agent` and `npm run test:chat-harden`. Eye-test is Railway
  after CoS attaches the branch. Stable `dev` host: https://betsy-crm-production.up.railway.app

## 2026-09-22 — P2: Probar ↔ live runtime parity

- Shared `assembleAgentRuntimeInputs` (`agent-turn-inputs.ts`). Live tool semantics win:
  force `search_approved_knowledge` only. Probar no longer force-adds `use_shortcut` (G16).
  Canal context and customer name use the same account select (G17).
- **Live prompt change (G18):** `loadHistory` excludes the trigger message
  (`id !== triggerMessageId`) before the 24-message window, so the current inbound
  appears once as `inboundText`. Rollback is that one filter.
- Shared `decideTurnOutcome` (`agent-turn-outcome.ts`). Probar computes `wouldSend`
  after the model (`outcome === 'send'`) and returns `outcome`, `needsHuman`,
  `fallbackUsed`, `escalate`. The sandbox turn stores the real `fallbackUsed` (G20–G21).
  `historyCount` is the windowed length, max 24 (G19).
- Probar resolves the channel binding. A different or missing serving agent adds
  `not_bound_to_channel` and does not call the model (G1). When flags are off the
  binding lookup still runs, so Probar does not depend on ops flag state.
  `selectWhatsappTestChannel` no longer falls back to any WhatsApp channel (G2).
- Optional Probar inputs: `customerName`, `conversationAiMode` (`ai_active` | `human` | `paused`).
  Live-only gates are labeled "No simulado en Probar" and are not reported as passed (G22).
- Probar bubbles are `WaBubble` `{ kind: 'text', from, text, at, label? }` with an
  exhaustive switch. Text only (AT-P-2).
- Out of this slice: P3 unlock, P4 monitor label, P5 live proof, Forge agent PATCH,
  staff bot, Soft chrome, schema/SQL, Meta Submit.
- Prove: `npm run test:soft-ai-agent` and `npm run test:chat-harden`. AT-P-1, AT-P-2,
  offline half of AT-WA-2.

## 2026-09-22 — P0+P1: Soft agent Grok 4.7 allowlist + guardrails

- Decisions in force: **D1 off** (not implemented; P3), **D2 on** (not implemented; P3),
  **D3 PATCH** (Avanzado button calls the existing agent PATCH; no SQL, no Forge row write).
- P0: `DEFAULT_CHAT_AGENT_MODEL` and `FORGE_WA_V2_FIXTURE_SET_HASH` live in `agent-types.ts`.
  `FIXTURE_SET_HASH_V2` is an alias. The v2 fixture module re-exports the hash (G7).
  Locked-path test rejects `@/lib/bot`, `@/app/api/bot`, and `process.env.WHATSAPP_` on
  soft-ai, chat API, and the P0/P1 files. Literal lock: no `grok-4.6` token under
  `src/lib/soft-ai/**` except `agent-types.ts`. P2/P3 modules are covered by the
  recursive scan once they exist; missing paths are not stubbed.
- P1: allowlist `['grok-4.7', 'grok-4.6']`, default `grok-4.7`. Creation, starter
  agents, shortcut-import turn fallback, and `resolveSoftAiModel()` use the constant.
  Prisma `@default` and SQL 027 left unchanged. Prompt cache key appends `model`.
- Pricing: verified 2026-09-22 on https://docs.x.ai/developers/pricing. `grok-4.7`
  short-context is $2 input / $0.50 cached / $6 output per 1M, identical to `grok-4.6`
  (long-context ≥200k is $4 / $1 / $12 for both). Estimator keeps the shared $2 / $6
  short-context rates and still bills cached tokens at the full input rate.
  `pricingVersion` stays `xai-2026-09`.
- UI: `/config/agentes` Avanzado shows a read-only Modelo line and, for `update_config`
  when the agent is not already on the default, **Cambiar a grok-4.7** via PATCH.
- Out of this slice: P2 parity, P3 unlock, P4 monitor label, P5 live proof, staff bot,
  Soft chrome, schema/SQL.
- Prove: `npm run test:soft-ai-agent`. Staff-bot diff empty (AT-WA-4).

## 2026-09-22 — Plan: Forge WA Probar↔live fidelity + Soft agent Grok 4.7 (Fable, docs only)

- Added `docs/plans/betsy-forge-wa-probar-live-fidelity-grok47-fable-2026-09-22.md` after
  Rafael's 2026-09-21 GO (ops enable flags + this plan + later Cursor implement). Mission A:
  make `/config/agentes` Probar a faithful dry run of `executeAgentLayerTurn` (shared runtime
  input assembly, shared send/suggest/skip outcome, channel-binding check, post-model
  `wouldSend`) and add an audited `POST /test/unlock` that writes `aiFullUnlock[socialAccountId]`
  (hash + agent + model bound). Mission B: allowlist `['grok-4.7','grok-4.6']`, default 4.7,
  Forge agent migrated by audited PATCH (SQL only as gated note).
- 23 gaps with file pointers; 8 acceptance tests (AT-WA-1…4, AT-P-1…4); packs P0–P5.
- Key findings: nothing writes `aiFullUnlock` today; Probar forces `use_shortcut` while live does
  not; live history duplicates the trigger inbound; Probar `wouldSend` ignores `needsHuman`;
  rebinding keeps a stale unlock; `/chats` cannot tell agent-layer from legacy Soft AI.
- Locks: Soft chrome HOLD, staff bot HARD LOCK (empty diff), no Meta Submit, no schema/SQL in
  PRs. Implementer model lock: grok-4.7 high fast only, never grok-4.5.
- Prove: docs only — `git diff --stat` = `docs/**`. PR stays draft; no merge without Rafael GO.

## 2026-09-21 — Plan: sales-agent pipeline SoT (CoS, docs only)

- Added `docs/plans/betsy-sales-agent-pipeline-2026-09-21.md` as the source of truth
  for Rafael García’s CR store sales-agent pipeline (locked 2026-09-21 with CoS).
  Sits above Arc 2 phases: sales layer only, inventory SKU mapping, GAM via
  `getCorreosAutomatedShippingCost` (no new geography; contra entrega never
  outside GAM), payment-proof pause, order after human approve, human post-sale.
- No product code, no schema. Implementer model lock: grok-4.7 high fast only.
- Prove: docs only — `git diff --stat` = `docs/**`. PR stays draft.

## 2026-09-21 — AL2-A1 UX redo: paste-import, plain atajos, WhatsApp Probar

- Owner flow on `/config/agentes`: paste "Cargar desde mis atajos" → review checklist → one Guardar (`import/extract` does not write config; `import/apply` bumps agent version once and writes one audit). Soft LLM via `llm/client.ts` when `XAI_API_KEY` is set; heuristic mapping covers the same facts for review. Confirmation wording stays a red row. Tokens for a model call go to `testDailyTokenCap`.
- Atajos default to title, customer text, and Activo. Keys, `sys_*`, templates, kind, and delivery mode render only after Avanzado. Starter chips insert resolved Spanish or stay disabled.
- Probar is a WhatsApp thread with one Enviar. A single WA binding is pre-selected. Replay, fixtures, pass rate, and the 24 h window sit under collapsed Pruebas internas. Pánico is Detener agente; history is collapsed Cambios recientes.
- No schema, Soft chrome, or staff-bot edits.
- Prove: `src/lib/__tests__/soft-ai-shortcut-import.test.ts` and the channel case in `soft-ai-probar-sandbox.test.ts`. Preview of this branch showed the saved checklist, plain atajos, and a Probar thread for `precio con envío?` (customer bubble right, agent bubble left, Pruebas internas collapsed).

## 2026-09-21 — Plan: AL2-A1 `/config/agentes` UX redo (Fable, docs only)

- Added `docs/plans/betsy-al2-a1-ux-redo-fable-2026-09-21.md` after Rafael rejected the shipped
  Atajos / Datos de la marca / Probar screens (#64) as engineer-facing and GO'd: paste-import
  "Cargar desde mis atajos" (AI extract → review checklist → Guardar), plain atajo list with eng
  keys / `sys_*` / `{{}}` behind Avanzado, Probar as a WhatsApp bubble thread with one Enviar and
  channel auto-select, Replay / fixtures / passRate / hash under collapsed Pruebas internas.
- 12 acceptance checkboxes (AT-1…AT-12) incl. the verify bar: three Preview screenshots
  (paste→facts, plain atajo, Probar bubble for "precio con envío?") readable dark-on-white.
- Out: Soft chrome, staff bot, SINPE queue / orders / Correos, image upload beyond disabled note,
  any schema change. Implementer model lock: grok-4.7 high fast only, never grok-4.5.
- Prove: docs only — `git diff --stat` = `docs/**`. PR stays draft; no merge without Rafael GO.

## 2026-09-21 — AL2-A1 agent text layer (SQL 029 proposed, not applied)

- Gated SQL `029_chat_agent_playbooks_assets.sql` + Prisma mirror. Not applied to shared Supabase.
- Payment classifier, brand facts, editable shortcuts, Canales allowlist (empty = nobody), isolated Probar sandbox, validator v2.
- Feature flag `chat_agent_layer_v1` still off by default. No Soft chrome redesign. No staff-bot mix.
- CoS apply notes live in `docs/audits/BETSY_V2_PROD_SQL_REVIEW.md` (029 block).

## 2026-09-21 — skill: verify-betsy

- Project-local verification skill `.cursor/skills/verify-betsy/` (pstack
  create-verification-skill shape): launch/doctor/drive/evidence/cleanup,
  Playwright helpers, and five Soft feature maps (agentes contrast,
  conocimiento in-page wizard, chats, social, ventas). Logistics omitted.
  Evidence directory gitignored.
- Prove on production (`BETSY_API_URL`, read-only): doctor `READY`, then
  `drive-agentes-contrast.mjs` PASS. Sections and Probar textarea computed
  `rgb(15, 23, 42)`. Abrir wizard kept path `/config/agentes` and the
  document sentinel. Screenshots in the skill `evidence/` folder.
- Isolated QA password (`betsy-preview` / `betsyv2.isolated@betsycrm.test`)
  was not injected here; doctor without it is `AUTH_BLOCKED`. This pass used
  the existing contrast QA user. No Probar click, no seed, no merge.

## 2026-09-21 — docs: Agent Layer Arc 2 plan (Fable, plan only)

- New plan `docs/plans/betsy-agent-layer-arc2-fable-2026-09-21.md`: Phases A–D
  (payment classifier + brand facts + shortcuts + Canales + multi-turn Probar;
  images + suggestion accept; SINPE `ChatPaymentIntent` queue in `/chats` +
  staff notification outbox; post-approve order draft into `/ventas`; horario +
  reply delay). Data deltas = gated SQL `029` / `030` (proposed, not written).
- 4 read-only scouts + Sol plan-mode review folded (12 MUST, 10 SHOULD; §9).
- Status board row added. No product code, SQL, flag or Supabase change.
- Prove: `git diff --stat` = `docs/**` only.

## 2026-09-21 — HOTFIX: agentes contrast + stop reload feel

- Contrast: route `!text-slate-900 [color-scheme:light]` + FIELD/TEXTAREA/
  SELECT with solid dark values (ThemeProvider dark was washing inputs).
- Reload feel (not true document reloads): `config/loading.tsx` full-viewport
  skeleton blanked every soft nav under `/config`; conocimiento cards used
  `router.push` remounts. Fix: empty `config/loading.tsx`; open conocimiento
  **in-page** on `/config/agentes` (local panel + shared wizard module); back
  via `Link`; config hub skips remount skeleton (`mounted` starts true).
- Soft chrome / staff bot untouched. Do not merge without Rafael OK.
- Prove: screenshots Probar + sections; click wizard/back without document
  navigation; `npm run build`.

## 2026-09-21 — HOTFIX: `/config/agentes` contrast / readability

- Root cause: ThemeProvider system dark set `body` near-white `text-foreground`
  while agentes pages force light surfaces (`bg-white` / slate-50) without
  explicit control colors → light-on-white inputs, Probar textarea/result,
  selects, and wizard fields.
- Fix: route `text-slate-900 [color-scheme:light]` + shared FIELD/TEXTAREA/
  SELECT classes (`text-slate-900`, readable placeholders, solid disabled).
  Bumped meta `text-slate-400` → `slate-600`. Silent `load({ silent })` after
  mutations so edits no longer flash “Cargando…”. Config hub “Abrir Agentes”
  uses `next/link` (cheap soft-nav). Soft chrome / staff bot untouched.
- Prove: screenshots of Probar + conocimiento; `npm run build`.

## 2026-09-21 — A2 Soft Agent knowledge (028 gated, flag off)

- Additive gated SQL `028_chat_agent_knowledge_actions.sql` (NOT applied live):
  `ChatKnowledgeSource`, `ChatAgentKnowledgeSource`, plus schema-only
  `ChatAgentSuggestion` / `ChatAgentPendingAction` for A3/A4.
- Prisma mirror + manifest entry `028` (not `DEFAULT_APPLY_FILES`).
- Knowledge CRUD + approve/reject APIs; bind sources to agents; OWNER/ADMIN
  (`update_config`) for mutations; audit after commit (no nested txn audit).
- Prompt layers 2–4 as data-not-instructions; `search_approved_knowledge` tool;
  monetary claims require `search_inventory` provenance; inventory over docs.
- Deterministic safety router: payment / media / opt-out before model call.
- Spanish paste-and-approve wizard `/config/agentes/conocimiento`; agentes
  checklist cards show live status (no more Pendiente A2 stubs).
- Soft chrome HOLD; staff bot untouched. Flag `chat_agent_layer_v1` still off.
- Prove: `npm run test:soft-ai-agent` (new `soft-ai-agent-knowledge-a2.test.ts`).

## 2026-09-21 — A1.5 Soft Agent introductionNames + agentes UI

- Additive gated SQL `027b_chat_agent_introduction_names.sql` (NOT applied live).
- `ChatAgent.introductionNames` text[] (1–3 presentation names); PATCH + audit after commit.
- Prompt identity layer after immutable safety; Forge seed defaults to `['Forge']`.
- `/config/agentes` readable sections (Identidad / Voz / Herramientas / Modo / Probar / Pánico)
  + A2 knowledge checklist UI only (Precios = inventario en vivo).
- Soft chrome HOLD; staff bot untouched. Flag `chat_agent_layer_v1` still off.
- Prove: `npm run test:soft-ai-agent`.

## 2026-09-21 — HOTFIX: agentes create P2028 + empty UI polish

- Root cause: `createChatAgent` / `updateChatAgent` nested `logAuditEvent` (global
  prisma) inside interactive `$transaction` → held open past 5s under Supabase
  latency → Prisma P2028 on POST `/api/chat/agents`.
- Fix: single-write create/update; audit **after** commit. `mapChatAgentAdminError`
  surfaces SCHEMA_NOT_READY / P2028 / name P2002 in Spanish. `/config/agentes`
  empty state + disabled-while-saving + API `error` field. Soft chrome HOLD.
- Prove: `npm run test:soft-ai-agent` (new `soft-ai-agent-admin-txn.test.ts`).

## 2026-09-21 — HOTFIX: Prisma out of browser client bundle (post-A1)

- Root cause: `'use client'` `/config/agentes` imported `hasSessionPermission` from
  `auth-helpers` → `auth-options` / `billing-access` → `db` → `PrismaClient`.
  Secondary: Soft `@/lib/soft-ai` barrel re-exported `composeEffectiveBehavior`
  from `agent-resolver` (Prisma) into Soft client chunks via commons.
- Fix: client-safe `session-permissions.ts`; agentes/social use it; Soft clients
  import `agent-state` / projection directly; drop resolver from Soft barrel;
  `server-only` on auth-helpers / agent-admin / agent-resolver / agent-inbox-enrich.
- Prove: `npm run test:soft-ai-agent` + production build client-chunk grep
  (no `@prisma/client` in agentes/Soft page chunks). Soft chrome HOLD (Rail
  untouched). Staff bot untouched.

## 2026-09-21 — A1 Soft Agent Layer runtime (027 gated, flag off)

- Additive `027_chat_agents.sql` + Prisma mirror + manifest (NOT applied live).
- Soft-only `src/lib/soft-ai/llm/**`, `agent-resolver`, `agent-claim-gates`, `agent-turn`,
  wired into Phase 4 `automation-processor` (legacy path when flag off).
- Flag `chat_agent_layer_v1` default off; Forge WA allowlist only; `aiFullUnlock` empty.
- `/config/agentes` Spanish UI (Probar, panic, audit); trust labels in SoftThreadPane/list.
- Soft chrome + staff bot paths untouched. Tests: `test:soft-ai-agent`.

## 2026-09-21 — Phase 4 scale bench numbers + seed fix + render ≤100

- Fixed `scripts/chat-scale-seed.ts` message index double-count across batches
  (duplicate `ChatMessage` PK on 50k seed).
- Local Postgres seed+bench: 5 accounts / 2k conversations / 50k messages;
  list p95 ~0.7 ms; changes idle p95 ~0.12 ms; indexes used (see
  `docs/audits/chat-phase4-scale-report.md`).
- `CHAT_INBOX_V2_THREAD_RENDER_WINDOW` tightened to **100** (acceptance 4.3).
- Acceptance 4.1–4.7 marked PASS in scale report (4.3–4.7 via code/unit + seed).
- Soft chrome + bot paths still untouched; 026 remains gated (not applied live).

## 2026-09-21 — Phase 4 template cache / poll consolidate / media / windowing

- `chat-template-cache.ts`: 300s per-WABA APPROVED templates (Upstash + memory);
  wired into `/api/chat/templates` + send APPROVED gate (acceptance 4.6).
- Poll: `CHAT_INBOX_V2_POLL_MS=5000`; SoftCopilotInboxV2 single scheduler +
  `inFlight` + pause on `document.hidden`; changes piggybacks `threadTail`
  (`threadId`/`threadAfter`); revision advances via `nextRevision` +
  `hasMoreChanges` (no jump to tenant max); initial list = first page +
  “Cargar más”; reconcile tick = one list page only (≤1 req/5s idle — 4.4).
- Thread window: fetch ≤50; store cap 300; render window 200; SoftThreadPane
  `data-testid="soft-thread-message"` + media via `/api/chat/media/[id]`.
- `chat-media.ts` + GET media route: Graph resolve → 10MB-capped download →
  private Blob `chat-media/{tenant}/{messageId}`; never persist Meta CDN URLs;
  write `mediaBlobPath` columns when present (026) else metadata fallback.
- Meta parser promotes `providerMediaId` / mime / filename; dual-write stores them.
- `chat-webhook-observability.ts` structured Done logs (`socialAccountId`,
  `durationMs`, `result`). Soft chrome + bot paths untouched.

## 2026-09-21 — Phase 4 Soft AI durable ChatAutomationJob queue

- Additive gated `026_chat_automation_jobs.sql`: `ChatAutomationJob` +
  `ChatAutomationDelivery` + optional `ChatMessage` media cache columns.
- Soft-only lease queue (`FOR UPDATE SKIP LOCKED`, 45s, per-conversation order)
  copying BotInbox algorithms without importing bot modules/tables.
- Webhook enqueues job after dual-write **before** 200; `void processJobById`
  best-effort; cron `/api/cron/chat-automation` (`*/1`) is safety net.
- Manifest registers 026; kept out of `DEFAULT_APPLY_FILES` (gated like 025).
- Soft chrome + `/api/bot/**` + `src/lib/bot/**` untouched.

## 2026-09-21 — Phase 4 scale tooling (seed / bench / burst / idle assert)

- Local-only load-test scripts gated on `CHAT_SCALE_DATABASE_URL` (loopback;
  refuse supabase hosts + pooler 6543). Never use shared `DATABASE_URL`.
- `scripts/chat-scale-seed.ts`: 5 SocialAccounts / 2000 ChatConversations /
  50000 ChatMessages (one 3000-msg thread); batched inserts; `--dry-run`.
- `scripts/chat-scale-benchmark.ts`: list LIMIT 30 + changes idle p50/p95,
  EXPLAIN (ANALYZE, BUFFERS) index asserts → `docs/audits/chat-phase4-scale-report.md`.
- `scripts/chat-webhook-burst.ts` + `tests/fixtures/chat-webhook/`: 500 signed
  events / 5 accounts unit-style (HMAC + parse + in-memory store).
- `scripts/chat-idle-network-assert.ts`: ≤1 req/5s budget vs `CHAT_INBOX_V2_POLL_MS`.
- npm: `chat:scale:seed` · `chat:scale:bench` · `chat:webhook:burst` · `test:chat-scale`.
- Soft chrome SoftSlimNav / SoftInboxBuckets / SoftCopilotRail untouched; `src/lib/bot/**` untouched.
- Bench numbers left **pending local postgres** in this Cloud Agent (no Docker).

## 2026-09-21 — PR-3 channel identity (names / logos / Connect naming)

- Persist WA/IG provider identity at connect (`exchange`, IG complete/callback shared upsert).
- Lazy Graph identity refresh on `GET /api/chat/accounts` (≤1/h via `tokenLastCheckedAt`).
- `PATCH /api/chat/accounts/:id { displayName }` (`update_config`); empty → provider default.
- `ChannelLogo` + wire SoftConversationList / SoftThreadPane / account filter / `/config/social`.
- Soft AI `canalContext` line `Canal: WhatsApp · {displayName}`; fallback never blank; IG numeric-id `@handle` bug fixed.
- Soft chrome SoftSlimNav / SoftInboxBuckets / SoftCopilotRail untouched; bot paths untouched.
- One-off: `scripts/chat-account-identity-backfill.ts` (dry-run default).

## 2026-09-21 — PR-2 Bugbot follow-up (send/echo + Soft AI + OAuth)

- Verified 6/6 #44 Bugbot notes against `origin/dev` `ed598fdd`. All real.
- HIGH send/echo (live, ungated): first dual-write now stamps Meta `providerMessageId`;
  identified echo-first duplicates finalize as success. Residual: 025 unique still unapplied.
- HIGH Soft AI worker escalate writes `ChatConversation.aiMode` before flag `agentState`.
- HIGH direct OAuth: same-origin `wa_direct_oauth` listener + 36008 launcher; dialog URL
  uses Embedded Signup `config_id` + coexistence extras. Code is not exchanged without
  FINISH phone/WABA assets.
- MED aggregates: preview/`lastMessageAt` only advance on newer `(sentAt, id)`; inbound
  and outbound maxima are independent. Counts still increment.
- MED v2 list follows `nextCursor` (flag still off). MED v2 template CTA POSTs `/api/chat/send`.
- Soft chrome and `/api/bot/**` untouched. 024/025 not applied. `chat_inbox_v2` stays off.
- Prove: focused write/soft-ai/oauth/v2 tests + `npm run test:chat-harden` (132 pass).
  Lint existing warnings only. Local `npm run build` pass.

## 2026-09-21 — PR-2 Respond.io write+read v2

- Dual-write ChatConversation + ChatMessage on webhook/send/soft-ai outbound
- Meta receipts: WA statuses + IG echo/delivery/read (monotonic deliveryStatus)
- Webhook HMAC-first; invalid signatures get dedicated IP limiter
- Hardened WA direct-oauth (`update_config` + CSRF state cookie/callback)
- Conversation API + SoftCopilotInbox v2 behind `chat_inbox_v2` (default off)
- Shipped gated `025_chat_inbox_uniques.sql` (NOT applied; not in default apply)
- Soft chrome SoftSlimNav / SoftInboxBuckets / SoftCopilotRail untouched; bot paths untouched

## 2026-09-21 — Respond.io PR-1: chat inbox schema foundation (024)

- Additive SQL `supabase/migrations/024_chat_inbox_conversations.sql`:
  `ChatConversation` + `ChatConversationReadState`, SocialAccount/ChatMessage
  nullable columns, revision sequence/trigger, non-unique indexes, RLS.
  **025 uniques not shipped.** SQL **not applied** to shared Supabase.
- `schema.prisma` mirror; apply/verify scripts extended via
  `scripts/lib/betsy-v2-additive-manifest.mjs` (018–024).
- Backfill/verify scripts: `scripts/chat-inbox-backfill.ts` (dry-run default),
  `scripts/chat-inbox-verify.ts`. Pure helpers:
  `src/lib/chat-conversation-foundation.ts`.
- Offline tests in `test:chat-harden`. Ledger entry in
  `BETSY_V2_PROD_SQL_REVIEW.md` (proposed). Staff bot + Soft chrome untouched.
- Prove: `npx tsx --test src/lib/__tests__/chat-conversation-foundation.test.ts
  src/lib/__tests__/chat-inbox-schema.test.ts` + `npm run test:chat-harden` +
  `npm run test:soft-meta-wait-iron` path via chat-harden + `npm run lint` +
  `npm run build`.

## 2026-09-20 — WA ownership verify: coexistence nested-field #100 soft path

- Prod Forge coexistence `POST /api/auth/whatsapp/exchange` 403ed after token +
  claimed phone/WABA because Graph rejected nested
  `whatsapp_business_account{id}` on the phone node (`(#100) nonexisting field`).
- `verifyWhatsAppAssetsForToken` now GETs safe phone fields only, then proves
  claimed WABA via `listWhatsAppPhoneNumbersForWaba` membership. Missing nested
  WABA field is no longer an ownership hard-fail; no claimed WABA still accepts
  phone ownership when resolve returns null after #100.
- Tests: `ig-wa-connect-security.test.ts` (Forge claimed-WABA success, #100 path,
  waba_mismatch). Added file to `npm run test:security`. Staff bot `/api/bot/**`
  untouched.
- Prove: `npx tsx --test src/lib/__tests__/ig-wa-connect-security.test.ts` +
  `npm run test:security` + `npm run test:chat-harden` + `npm run build`.

## 2026-09-20 — WhatsApp coexistence Embedded Signup (Business App numbers)

- Launch extras: `featureType: whatsapp_business_app_onboarding` + `sessionInfoVersion: 3`
  via `src/lib/whatsapp-embedded-signup.ts` and `/config/social` FB.login.
- Correlate FB.login code with `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` session
  postMessage; exchange resolves phone from WABA when Meta returns waba_id only.
- `subscribed_apps` now includes `history`, `smb_app_state_sync`, `smb_message_echoes`,
  `account_update`; coexistence onboard kicks SMB contacts/history sync within 24h.
- Webhook digests SMB echoes (outbound) + history (no Soft AI); PARTNER_REMOVED
  deactivates WABA-linked SocialAccounts.
- Docs: `META_CHAT_SETUP.md` store playbook; UI hint on `/config/social`.
- Prove: `npx tsx --test src/lib/__tests__/whatsapp-coexistence.test.ts` +
  `npm run test:chat-harden` + `npm run build`.

## 2026-09-11 — F37-03 Soft human composer after Pausar / Tomar control

- SoftThreadPane: unlock input/Enviar whenever agent mode is `paused` or `human`
  (incl. Soft DEMO — removed blanket `isDemo` disable).
- SoftCopilotInbox: DEMO human send appends locally (never Meta) after pause/takeover.
- Helper `isSoftHumanComposerEnabled`. Does not regress F37-01/F37-02.
- Prove: `npm run test:soft-ai` + build. Same draft #37.

## 2026-09-11 — F37-02 Soft AI server-truth pause/takeover (blocks Meta)

- SoftCopilotInbox: await `/api/chat/soft-ai/control` success **before** committing
  UI mode (DEMO stays localStorage-only).
- Inbound hook: `resolvePersistedAgentMode` — missing agentState/key is **not**
  `ai_active`; re-read mode immediately before Meta send; fail-closed if
  paused/human/missing. Control API persists `staffControlled` on agentState.
- Prove: `npm run test:soft-ai` (+ soft-ai-server-truth) + build. Same draft #37.

## 2026-09-11 — F37-01 Soft AI config PATCH exact orch RBAC stamp

- PATCH `/api/chat/soft-ai/config`: outer `update_config` + `decideSoftAiConfigPatch`:
  - `enabled:true` requires `update_config` (SALES/MANAGER view_config-only denied)
  - `paymentAlwaysHuman:false` fail-closed OWNER/ADMIN only
- Soft AI WA outbound `appsecret_proof` uses `purpose:'whatsapp'` (tiny). TOCTOU parked.
- Prove: `npm run test:soft-ai` + build. Same draft #37.

## 2026-09-11 — F37-01 Soft AI config PATCH RBAC (SecureDog WARN)

- `PATCH /api/chat/soft-ai/config` now requires `update_config` (OWNER/ADMIN only).
  SALES/MANAGER keep `view_config` but cannot enable Soft AI or flip
  `paymentAlwaysHuman` off. Flag still defaults off. Same draft PR #37.
- Prove: `npm run test:soft-ai` (+ soft-ai-config-rbac) + build.

## 2026-09-11 — Soft Tenant AI full package (monitor + tools + DEMO)

- Tenant AI worker (`src/lib/soft-ai/`): inbound → KB/config → tools → full reply.
  Feature flag `soft_tenant_ai_v1` (default off). Soft DEMO forces on client-side.
- Tools: create/link order, order status, Correos guía (DB or honest stub), tag,
  escalate_to_human. Payment/SINPE always-human via config skeleton.
- Soft UI shift (chrome language): monitor queue “IA manejando”, tool log rail,
  Take over / Pause / Resume AI — not suggest-first.
- APIs: `/api/chat/soft-ai/{run,config,control}`; webhook hooks Soft AI when flagged
  (never staff bot / no dual-router). No prisma push.
- Soft DEMO e2e without Meta: `runSoftDemoAiPass` + localStorage agent state.
- Prove: `npm run test:soft-ai` / `test:chat-harden` + build.

## 2026-09-11 — Rafael GO Soft 9.5 + multi-connect + WA APPROVED gate

- Soft 9.5 polish inside Soft chrome: empty states, sticky Resumen IA stub,
  rail ask hint, keyboard (⌘K / Esc / ↑↓ / Enter / `/`).
- Soft demo chats: localStorage seed clearly marked DEMO + removable; never
  writes ChatMessage / tenant production chat data.
- `/config/social` multi-connect: “Agregar otra/otro” copy + confirm when
  accounts already exist; upsert vs new-id explained.
- `POST /api/chat/send` server-side APPROVED/ACTIVE re-check via Graph
  `message_templates` before WA template send (`wa-template-approval.ts`).
- Hard locks: Soft chrome language only; `/api/bot/**` + staff `WHATSAPP_*` +
  `lib/bot/whatsapp` untouched; no dual-router; no prisma push.
- Prove: `npm run test:chat-harden` (+ soft-meta-wait-iron) + build.

## 2026-09-10 — Soft Copilot Phase 1 HARDEN

- Encrypt `SocialAccount.accessToken` via `encryption.ts` on all write paths
  (link, WA exchange, IG callback/complete); decrypt on send/subscribe/templates.
  Legacy plaintext passthrough until next write.
- Webhook Meta account resolve tenant-safe (`resolveWebhookSocialAccount`):
  refuse ambiguous multi-tenant `findMany`; IG page match by encoded refreshToken only.
- RBAC: `/chats` + GET accounts/messages/templates use `update_sales` (same as send).
- Rate limit: `chatWebhookRateLimit` (IP) + `chatSendRateLimit` (tenant:user).
- Soft thread “Cargar anteriores” via `nextCursor`/`hasMore` + recipientId filter.
- WA approved-templates picker MVP behind existing Soft CTA (`/api/chat/templates`).
- No Soft restyle; `/api/bot/**` and staff `WHATSAPP_*` untouched; no prisma push.
- Prove: `npm run test:chat-harden` + build.

## 2026-09-10 — CRM WA dedicated Meta app env + Soft Copilot UI

- CRM WhatsApp connect (exchange / link / subscribe / appsecret_proof / FB SDK)
  prefers `META_WA_APP_ID`, `NEXT_PUBLIC_META_WA_APP_ID`, `META_WA_APP_SECRET`
  with fallback to `META_APP_*`. Instagram stays on `META_APP_*`.
- `/api/chat/webhook` HMAC tries META_APP_SECRET, META_WA_APP_SECRET, then
  INSTAGRAM_APP_SECRET (deduped). No dual-router; staff bot `/api/bot/**` untouched.
- Soft Copilot `/chats` + Connect Soft UI (LOCKED Figma) in same fat PR.
- Docs: staff app vs CRM Inbox WA app; Vercel env list.
- Prove: meta-wa-app-env, meta-chat-webhook HMAC, chat-soft-copilot, chat-inbox tests.

## 2026-09-10 — Soft Copilot `/chats` + Connect UI (LOCKED Figma)

- Soft Copilot shell for customer inbox `/chats`: slim nav, inbox buckets,
  WA/IG/Todos chips, cuenta filter, unread badges, sync cue, yellow Resumen IA
  stub, composer Sugerir/Usar/Descartar stubs, right rail Detalle|Copilot,
  mobile list/thread + WA 24h closed CTA + empty states.
- Connect Soft Copilot on `/config/social`: multi IG/WA cards, Conectado only
  when subscribed/`isActive`, subscribe-fail toast, staff bot explicitly out;
  `GET /api/chat/accounts?includeInactive=1` for inactive/error rows.
- AI hooks are visual/heuristic stubs only — no AI engine. Staff bot
  (`/api/bot/**`) untouched. No dual-router / shared Meta callback.
- Prove: chat-soft-copilot + chat-inbox unit tests; lint/build.

## 2026-09-10 — PR-A: WA customer inbox connect = subscribed

- Soft-fail `subscribed_apps` removed from WA OAuth exchange + manual link:
  failures return `422` with Spanish copy; `SocialAccount.isActive` only when
  subscribe succeeds (token still saved inactive for Re-suscribir).
- Manual `/api/social/link` WhatsApp path Graph-verifies via
  `verifyWhatsAppAssetsForToken` (same as exchange). Re-suscribir activates
  `isActive` on success.
- UI (`/config/social`) never claims "conectado" unless subscribe succeeded;
  Embedded Signup postMessage no longer swallows errors.
- `DOCUMENTATION.md`: staff `WHATSAPP_*` + `/api/bot/whatsapp/webhook` labeled
  staff-only; customer inbox → `/api/chat/webhook`.
- Spanish Meta 24h/CSW send errors in `humanizeChatSendError`; WA parse unit
  tests in `meta-chat-webhook.test.ts`.
- Hard lock: staff bot routes / `WHATSAPP_*` untouched.
- Prove: `npx tsx --test` ig-wa-connect-security, meta-chat-webhook,
  chat-inbox; `npm run lint`; `npm run build`.

## 2026-09-10 — /chats live poll + send JSON harden

- `/chats` short-polls `/api/chat/messages` every 4s while the tab is visible
  (`visibilityState`); pauses when hidden; merges without clearing selection;
  fingerprint skip avoids list flicker.
- Send path no longer `alert()`s raw `res.json()` failures: `parseApiJson`
  detects HTML/`<!DOCTYPE` and shows Spanish inline errors.
- `/api/chat/send` always returns JSON; safe Meta response parse; 15s Meta
  fetch timeout (avoids hanging → HTML gateway pages); IG prefers
  `{pageId}/messages` when `refreshToken` encodes `page:`; Spanish error copy.
- Prove: `npx tsx --test src/lib/__tests__/chat-inbox.test.ts`, lint/build.

## 2026-09-10 — Chat webhook: dual Meta/Instagram HMAC secrets

- `verifyMetaWebhookSignature` tries `META_APP_SECRET` then distinct
  `INSTAGRAM_APP_SECRET` with timing-safe compare; returns
  `triedMeta` / `triedInstagram` / `matchedSecret`.
- Production 401 diagnostics include which secrets were attempted (never
  secret values / raw body / full signatures). Info log when Instagram
  fallback matches.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-webhook.test.ts`,
  `npm run build`.

## 2026-09-10 — Chat webhook: page-object IG + safe signature diagnostics

- Production signature failures on `/api/chat/webhook` now log safe diagnostics
  only (`signaturePresent`, `signaturePrefix`, `bodyLen`, `contentType`, `host`);
  still return 401 (auth not weakened).
- `parseMetaChatPayload` accepts Meta `object: page` messaging (platform stays
  `instagram`); prefers IG-shaped `recipient.id`, else `entry.id`, with
  `webhookObject`/`pageId` metadata.
- Store path falls back to active Instagram `SocialAccount` whose
  `refreshToken` encodes `page:<id>` when accountId lookup misses.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-webhook.test.ts`
  `src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-10 — IG connect: pages_read_engagement + me/accounts IG fields

- Added `pages_read_engagement` to `INSTAGRAM_OAUTH_SCOPES` so Graph can return
  Page `instagram_business_account` (fixes production #100 on page GET).
- `listFacebookPages` requests
  `instagram_business_account{id,username},connected_instagram_account{id,username}`
  on `me/accounts` and BM owned/client pages; `findInstagramBusinessOnPages`
  prefers embedded IG and only falls back to per-page GET when missing.
- Docs: `META_CHAT_SETUP.md`, `DOCUMENTATION.md` permissions table.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-09 — SecureDog tip on IG+WA connect (#28)

- SD-01: `ig_connect_pending` cookie is opaque JWT (pendingId + page ids only);
  page access tokens live in encrypted Redis/memory server store.
- SD-02: WA `/exchange` Graph-verifies phone/WABA ownership before upsert/subscribe.
- SD-03/04: dropped `tokenPrefix` logs; IG `auth-url` requires session.
- Prove: `npx tsx --test src/lib/__tests__/ig-wa-connect-security.test.ts`
  `src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-09 — Respond.io-like IG + WA connect (CRM inbox)

- Instagram: Login for Business `config_id` via `NEXT_PUBLIC_IG_LOGIN_CONFIG_ID`;
  Business Manager page fallbacks when `me/accounts` is empty; multi-asset picker;
  Spanish empty-pages troubleshooting; safe page-count logs (no tokens).
- WhatsApp: single primary Embedded Signup CTA; manual link collapsed; store WABA
  on `SocialAccount.refreshToken` (`waba:`) and Page id for IG (`page:`).
- meta-status / readiness canonical origin defaults to the www production host
  and prefers `NEXTAUTH_URL`. Re-enabled `/chats` route so linked accounts appear.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-03 — Producción Contra entrega toggle and grid windowing

- Added a **Contra entrega** toggle next to Masivas/Guías/Facturas/Exportar.
  On: Envíos (EA) and Retiros (RA) show only `contraEntrega === true`, including
  collected COD. Off: full catalog again. Server-driven path filters in
  `/api/production/orders` (`contraEntrega=1`); legacy stream filters client-side.
- Producción no longer mounts every loaded card. `ProductionOrderWindow` paints
  40 cards first, expands on scroll/click, and remote "Cargar más" stays explicit.
  Cards are memoized; BackupPage is a dynamic chunk.
- Prove: `npm run test:pagination`, `npx tsc --noEmit`, `npm run lint`.

## 2026-08-31 — Production Meta env audit (www, not apex)

- Probed live Production (www host) without printing secrets.
  `META_APP_ID` and both verify tokens are present; Instagram OAuth `client_id`
  is 1514613536240301 (Graph name BetsyCRM). Apex `betsycrm.com` 307s to www.
- Runbook now tells Meta to use `NEXTAUTH_URL` (www), not the apex, so webhook
  GET verify does not fail on the 307. `dashboard.betsycrm.com` does not resolve.
- Production Instagram Login still requests only `instagram_manage_messages`
  until this branch is on Production.

## 2026-08-31 — Betsy Chat Meta readiness + dedicated Notion board

- Canonical Meta inbox config in `src/lib/meta-chat-config.ts` (IG OAuth scopes, public URLs, env presence checks).
- Instagram Login now requests Page scopes (`pages_show_list`, `pages_manage_metadata`, `pages_messaging`, …) so `/me/accounts` in the callback can actually find the IG Business account.
- Owner diagnostic: `GET /api/chat/meta-status` + **Estado de Meta** card on `/config/social`. No secrets returned.
- Runbook `META_CHAT_SETUP.md` uses production `betsycrm.com` URLs and the two-webhook split (CRM inbox vs staff bot).
- Implementation board lives in Notion under the Betsy project (not the general Tasks board).

## 2026-08-30 — Remove Grok enhance bar from Ventas form

- Removed "Mejorar con Grok" from Nuevo pedido. Local paste-to-fill stays.
- Preview no longer synthesizes `ai_customer_paste_v2`. The enhance API
  remains flag-gated and off. No order data rewritten.
- Follow-up: dropped leftover `setAiPasteReviewPending` in `resetForm` that
  failed the production Vercel `next build`.

## 2026-08-30 — Preview v2 for real tenants; website pickup on new orders

- Preview / local `next dev` unlocks v2 for **every tenant** so reviewers can
  see Ventas/Producción/Estadísticas on real stores. Production still never
  synthesizes flags. DB flags stay off (production remains v1 after merge).
- Website intake accepts optional `orderType: "RA"` on **new** orders only.
  Existing payloads without the field stay Envío. No historical totals rewritten.
- Prove: review-environment, website-order-map, tenant-ui, lint. Do not merge
  `origin/dev` from the agent.

## 2026-08-30 — Production candidate: tenant-scoped Preview, flags off

- Preview v2 product flags unlock only when `VERCEL_ENV` is non-production
  **and** `tenantId === BETSY_V2_TEST_TENANT_ID`. Production never unlocks.
  The shared-DB banner stays env-only (`shouldShowPreviewDataWarning`).
- Ordinary store owners on a Vercel Preview keep production flag state.
- Removed `db:push:unsafe`. Verify script `--production-release` requires
  zero enabled `TenantFeatureFlag` rows. Gated disable script sets
  `enabled=false` only (no deletes, no order rewrites).
- Fixed duplicate `date-fns` import in `MobileOrderCard` that failed Vercel
  `next build`. No Prisma schema / `lm_*` / historical order changes.
- Prove: `npx tsx --test src/lib/__tests__/review-environment.test.ts`,
  `npm run test:tenant-ui`, `npm run test:correos-credentials`,
  `npm run test:lifecycle`, `npm run lint`, `npm run build` (127 routes).
  `npm run betsyv2:verify-production`: 8 v2 tables + RLS, 0 enabled flags,
  3647 orders unchanged. Do not merge `origin/dev` from the agent.

## 2026-08-30 — Preview QA: orders form, stats cobrado, copy

- Ventas: cantón/distrito commit on blur/Enter, keep distrito when still
  valid, show all validation errors with asterisks, scroll to the first
  invalid field, mensajería is required and visible for envíos, pickup no
  longer asks for street address, product Add explains why it stays grey.
- Ventas detail reuses the Producción editor so status/fields can change
  without hunting the card. `/pedidos` redirects to `/ventas`.
- Estadísticas: Pendiente without paid evidence is not cobrado. Customer
  activity labels are Spanish. Footer is v2. Buttons say Envío/Retiro.
- Website ingest parses `₡3.000` as 3000 and rejects invalid money before
  creating an order. Pickup from websites is still not supported (CRM only).
- Feedback FAB no longer covers Ventas table actions; Comentarios lives in
  the shell/nav. Did not merge, did not touch ORDER-1788038329933.
- Prove: `npx tsx --test src/lib/__tests__/crc-money.test.ts
  src/lib/__tests__/order-payment-status.test.ts
  src/lib/__tests__/order-form-validation.test.ts`, `npm run test:tenant-ui`,
  `npm run test:bot-grok`, `npx tsc --noEmit`.

## 2026-08-29 — Preview unlock and Vercel build repair

- Preview (`VERCEL_ENV=preview`) and local `next dev` synthesize Betsy v2
  product flags in code. No TenantFeatureFlag rows are written. Production
  stays flag-gated. Billing remains observe-only on preview.
- Tenant guías claim one in-flight generate per order. 401/403 surfaces as
  “Correos rechazó las credenciales” instead of generic Fallida.
- Fixed `customFields-server.ts` Prisma `optionSet: null` typing that failed
  `next build`. Ventas hook dependency warnings addressed.
- Dual client APIs and “Sincronizar desde Ventas” remain quarantined; no knip
  mass-delete.
- Prove: `npx tsc --noEmit`, `npm run test:correos-credentials`,
  `npm run test:lifecycle`, `npm run test:bot-inbox`. Do not merge `origin/dev`.

## 2026-08-29 — Tenant Correos guías use logistics credentials

- Tenant `/api/shipping/generate-guia` authenticated with stale `CORREOS_WS_*`
  env vars (401) while logistics succeeded with `lm_carrier_configs`.
- Shared resolver prefers a complete logistics DB set and never mixes
  username/password across sources. Token cache is fingerprinted so rotations
  cannot reuse a token.
- DialogContent opts out of the missing-Description warning.
- Prove: `npm run test:correos-credentials`. Do not merge `origin/dev` yet.

## 2026-08-29 — Isolated-tenant local verification

- Tenant E2E now pins `BETSY_V2_TEST_TENANT_ID`, asserts `/api/auth/me` +
  `allTenantIds`, and creates an RA pickup, status change, and archive.
- Client backfill `--apply` writes `clientBackfillCompletedAt` and does not
  auto-enable the flag. UI Playwright covers `/auth/signin` → `/ventas` /
  `/produccion`.
- Read-only `scripts/verify-betsy-v2-additive-sql.mjs` re-checks 018–023
  catalog, RLS, and that no other tenant has v2 flags. Do not re-apply SQL.
- `/produccion` crashed in the browser because `OrderDetail` imported Prisma via
  `customFields.ts`. Server fetch moved to `customFields-server.ts`.
- Prove: `npm run test:lifecycle`, `npm run test:e2e:tenant`,
  `npm run test:bot-grok`, verify script. Stay off `origin/dev`.

## 2026-08-29 — Isolated Betsy v2 test tenant

- Did not use `peter@peter.com` (super-admin + logistics-admin, two tenants).
- Created isolated OWNER `betsyv2.isolated@betsycrm.test` /
  tenant `cmteijij70000jsoyedmtfnl1` (`betsyv2-isolated-test`).
- Not super-admin, not logistics-admin, not in `lm_tenant_links`, no Tilopay,
  no flags, 0 orders. Peter rows were not modified.

## 2026-08-29 — Betsy v2 additive SQL review (018–023)

- Pinned `codex/betsyv2-review` @ `9943fe5` (ancestor `5ea4377`). Read-only
  catalog on shared Supabase: ~3640 orders / ~7MB, no v2 objects present.
- Hardened 018–023 with the existing Prisma RLS pattern (`service_role` only)
  so new public tables are not Data-API readable via default `anon` grants.
- Gated apply script `scripts/apply-betsy-v2-additive-sql.mjs` (host confirm,
  no Prisma). Flags stay off. Isolated test tenant created separately.
- Prove: SQL static tests + apply postconditions. No `origin/dev` push.

## 2026-08-27 — Logistics archive shows terminated orders

- Tablero de Envíos Archivo listed 0 finished orders even though ~2.4k
  `lm_orders` rows have `archived_at`. `GET /api/logistics/orders?archived=true`
  flattened `{ in: managedIds }` incorrectly (`[{ in: [...] }]` instead of the
  id list), so the tenant `ANY()` prefilter failed closed and the UI treated
  errors as an empty archive. Archive now joins `lm_orders` to `"Order"`,
  unwraps managed tenant ids for SQL, sorts by `archived_at`, skips the
  live-board cutoff, and returns a real total. The panel shows
  phone/location/product/date, errors instead of a fake empty state, and
  scrolls at a usable height.
- Prove: `npm run test:logistics-archive`. No `lm_*` schema changes.

## 2026-08-24 — Payroll Sunday double-count (CR day bounds)

- Confirmed: consecutive Mon–Sun payroll weeks both included Sunday
  afternoon clock-ins (Lau + Marlenn 2026-08-16, 301 paid minutes / CRC 6 271)
  because `date AT TIME ZONE 'America/Costa_Rica'` on PG 17/UTC returns
  `timestamp without time zone` (week start at Sunday noon CR) while the
  exclusive end bound stayed at Monday 00:00 CR.
- Fix: filter with `timestamp AT TIME ZONE` (true CR midnight). Shared helper
  `src/lib/costa-rica-clock-range.ts` used by workforce payroll, time-entries,
  and finance payroll.
- Prove: `npm run test:payroll-bounds`. Consecutive weeks 10–16 and 17–23 Aug
  2026 now intersect to zero IDs. Same CR midnight bounds now used by
  finance costs, logistics reports, private delivery, and retiros KPIs so
  Sunday afternoon cannot leak into the next period anywhere we filter
  timestamptz by calendar day.

## 2026-08-19 — Site-wide load-time performance slice

- Stopped `ConfigProvider` from fetching 6 config APIs on every authenticated
  route; ventas/producción/config load only what they need, with a 5-minute
  memory cache. Tenant settings and billing banner share the same cache pattern.
- NextAuth `SessionProvider` no longer refetches on window focus.
- Logistics `/orders` GET: bounded limit, tenant-scoped lm prefilter, parallel
  enrichment, no `ALTER TABLE` on GET, dropped `productDetails`/`customFields`
  from the list payload. Dashboard search is debounced; carriers/accounting
  caps reduced; reports poll every 5 minutes when the tab is visible.
- Dashboard stats, estadísticas summary/type/status/top-customers run independent
  reads concurrently. Estadísticas no longer duplicate summary/type/status for
  the day report; order-details is paginated. Recharts is `next/dynamic`.
- Production lazy-loads Guia/Invoice/Kanban. Route `loading.tsx` files use
  skeletons. `optimizePackageImports` for lucide/date-fns/recharts/framer-motion.
  Logistics Inter via `next/font`. No schema or `lm_*` changes.

## 2026-08-18 — Finance API extra keys for DeepClean / Forge

- Bitácora (adsadder) reads `brand=all` via extra top-level keys
  (`deepclean`, `forge`) in addition to `brands[]`. Missing keys show
  "Pendiente de Betsy" instead of ₡0.
- `/costs` and `/facturacion` now emit those keys, plus `dateFrom`/`dateTo`.
- `/meta` now includes `brandSlugs`. Finance cost/facturación maxDuration 60s.

## 2026-08-18 — Finance API: DeepClean + Forge brands

- Extended `FINANCE_TENANTS` with `deepclean` (`cmln5u7k70000ld042qify2og`) and
  `forge` (`cmsrgct420000vipcp3xyqb0m`). `/meta`, `/costs`, `/facturacion`, and
  `/orders` now accept all four slugs; payroll stays global.
- Order classifier v1.1.0: DeepClean and Forge are 1:1 tenant=business (like Bloom).
  DeepSleep sub-business rules unchanged.


- 1 Dopa + 1 Stress was collapsing to one line and deducting 2 of the same SKU.
- Product strings/details now split into separate lines. Generic Parche ×2
  explodes into per-unit pickers. Allocations are stored per order/slot so
  each unit can point at a different Laura SKU.
- Unique named products can still seed a global alias. Generic labels like
  Parche never do, so mixed future orders stay independently mappable.
- Fuzzy match is unique-only (ambiguous “Pura S” stays unmapped). Confirm
  rejects Laura pickups whose mapped qty does not cover the order.

## 2026-08-14 — Laura inventory product mapping

- Retiros could warn “sin mapear · Laura” but had no way to assign a sales
  label (e.g. Parche) to a Laura SKU, so confirmation stayed blocked.
- Added `POST /api/logistics/retiros/aliases` (logistics-admin, RA-only, Laura
  namespace hardcoded). Identical maps are idempotent; remaps need `overwrite`.
- Inline SKU picker on the retiro detail and Laura confirmation wizard. Marlenn
  still confirms without mapping or stock deduction.

## 2026-08-13 — WhatsApp/Telegram bot → xAI Responses API + Grok 4.6

- Default model is `grok-4.6` (`XAI_MODEL` still overrides). Reasoning stays `low`
  so WhatsApp's 15s timeout is not blown by the 4.6 high default.
- Agent chat and order extraction now call `/v1/responses` instead of Chat
  Completions. Tools use the flat Responses function shape.
- Privacy: every request is `store:false`. Tool follow-ups replay in-memory
  `response.output` (with encrypted reasoning) plus per-`call_id`
  `function_call_output`. No `previous_response_id` (that requires 30-day
  xAI retention). `prompt_cache_key` is HMAC'd so the WhatsApp phone is not
  sent as a cache key.
- Helpers live in `src/lib/bot/xai-responses.ts`; covered by `test:bot-grok`.

## 2026-08-13 — removed-assistant account recovery

- `forgecostarica04@gmail.com` was still an active Bloom ADMIN after "delete".
  Sign-in/register reused that User row and OAuth/JWT silently reactivated the
  old tenant. Bloom orders were not modified (still 473). Bloom OWNER
  (`bloomparchescr@gmail.com`) left intact. Forge Bloom membership was
  deactivated; a new owned tenant was created and renamed to Forge.
- Auth no longer reactivates inactive memberships on Google login or JWT
  refresh. Detached Google users get a new owned tenant. Removing a user
  clears/repoints `defaultTenantId`. Re-invite reactivates the inactive row.
- Added tenant `cmsrgct420000vipcp3xyqb0m` (Forge) to the logistics
  managed-tenant allowlist and centralized leftover hardcoded copies onto
  `src/lib/logistics-managed-tenants.ts`. Finance DeepSleep/Bloom allowlist
  was not changed.

## 2026-08-11 — cybersecurity review + safe hardening

- Full evidence-led security audit (auth, tenant isolation, Tilopay/billing,
  logistics, secrets/deps). PR description is the authoritative report.
- **Fixed (safe hardening):** invoice + other tenant models added to
  `TENANT_MODELS`; Tilopay webhook fail-closed + HMAC-only (no presence-only
  accept); callback no longer mutates plans; `/api/tilopay/auth` disabled;
  subscription cron always requires `CRON_SECRET`; invoice PDF HTML escape +
  session tenant; export `no-store` + CSV formula neutralization; backup Blob
  fails closed on public store; integration test 404 in prod; integration log
  PII redaction; logistics managed-tenant allowlist enforcement; OAuth/JWT reject
  inactive users; invite password strength; registration omits IDs; dep bumps
  `next@15.5.23`, `next-auth@4.24.15`, `@auth/core@0.41.3`, `axios@1.19.0`.
- **Documented only (product/risk):** membership auto-reactivation, ADMIN→OWNER
  role assignment, export/API-key/bulk RBAC tightening, OAuth account linking,
  WhatsApp OAuth state, CSP unsafe-inline, Tilopay HMAC algorithm confirmation
  with provider if production used presence-only hashes.

## 2026-08-03 — workforce clock reliability hardening

- Read-only production forensic check: one Lau employee, one valid open entry, no
  duplicate open entries, and `lm_time_entries_one_open_per_employee` is installed.
  The final code regeneration was followed by a successful clock-in six seconds later.
- Root cause confirmed: the older blank-clock-out row was voided (twice), so it was not
  a live open entry; the UI incorrectly displayed the contradictory `Open` / `Voided`
  state. Five code rotations in four minutes also invalidated the prior codes in sequence.
- Centralized time-entry state precedence (`voided` > `completed` > `open`); added an
  explicit audited Restore operation, blocked edits of voided rows, prevented restoring
  an open-shaped void when another live open entry exists, and made repeat Void a no-op.
- Serialized punch/admin mutations by locking the employee row. Clock-out uses guarded
  predicates plus the expected entry id; retries replay the original state without
  changing timestamps or duplicating audits.
- Worker UI binds punch actions to the validated code, clears stale identity state when
  the input changes, consumes the punch response directly, and uses Costa Rica display
  time. Lookup now distinguishes invalid credentials from operational 503 failures.
- Code rotation and audit are atomic and optimistic-versioned; the UI is single-flight.
  Added a production warning and deployment documentation for a stable
  `EMPLOYEE_CODE_SECRET` compatibility rollout.
- Split shared-IP lookup/punch limits (60/120 per 15 minutes) and removed the third
  post-punch lookup. Unignored the workforce schema migration so the critical partial
  unique index can be source-controlled.
- Prove: focused ESLint pass; workforce state, code, and datetime tests pass. Next debug
  build compiles the workforce changes, then fails on the pre-existing
  `@vercel/blob` `get` / `BlobAccessType` imports in `src/lib/backups/blob-store.ts`.

## 2026-07-31 — personnel time-clock timezone corrections (branch `cursor/fix-personnel-time-clock-472f`)

- Root cause: Time Clock admin corrections sent bare `datetime-local` strings; UTC server
  interpreted them as UTC, shifting Costa Rica wall times by 6 hours on save/reload.
- Added browser-safe `src/lib/workforce-datetime.ts` (CR display, datetime-local ↔ ISO).
- API `parseClockTimestamp` now requires explicit timezone; empty clock-out clears/reopens.
- PATCH void/correct + audit are atomic; punch in/out + audit likewise.
- Workforce UI: CR-formatted inputs/display, ISO submit, save guard, stale week fetch ignore,
  Next week advances from selected week; coverage actuals use CR slot bounds.
- Prove: `npm run test:workforce-datetime`, lint, build.

## 2026-07-30 — orphan purge (human OK: delete all except explicitly used)

- Deleted orphan routes: `/landing`, `/deployment`.
- Deleted orphan libs/templates: `correosAutomation.ts`, `auth.ts`, `instagram-oauth.ts`, `dom-protection.ts`, `integration-snippet.ts`, `bot/index.ts`.
- Deleted 8 legacy setup-wizard steps; produccion orphan pair; UI leftovers listed in Phase 0.
- Removed `@types/bcryptjs`; kept `sharp` and `/home`.
- Cleaned `/landing` refs in middleware, SubscriptionBanner, FeedbackWidget, DOCUMENTATION.
- Prove: lint pass, test:backups 8/8, test:bot-grok pass, build pass, knip unused files 0.

## 2026-07-30 — logistics mobile layout (branch `cursor/logistics-mobile-layout-cb22`)

- Fixed logistics shell on ≤768px: column flex + `100dvh`, main content no longer clipped by horizontal overflow.
- Replaced crowded horizontal mobile nav with compact header + accessible drawer (`LogisticsMobileNav`).
- Made Tablero de Envíos stack “Sin Asignar” above Kanban boards; swipeable columns; archive/verify forms wrap on narrow screens.
- Dashboard stats use 2 columns on mobile; loading shell no longer forces full viewport height inside main.

## 2026-07-30 — kickoff (branch `cursor/codebase-slim-agent-os-1e77`)

- Upgraded `.cursor/skills/executor-advisor-loop/SKILL.md` to Sol-orchestrated multi-agent loop (`gpt-5.6-sol-high`); parent dispatches parallel read-only scouts; serial deletes; safety gates.
- Added `.cursor/commands/codebase-audit.md`.
- Created `docs/audits/` ledgers (Phase 0, Phase 1, safety gates, this changelog).
- Added `knip` + `npm run audit:dead` (non-blocking).
- Removed stale `package.json` scripts pointing at missing files.
- Deleted `src/app/test-phase2`, `src/app/sentry-example-page`, `src/app/api/sentry-example-api`.
- Seeded quarantine: home/landing dup, deployment, external APIs, Tilopay/invoice/billing TODOs.
- Prove: `npm run lint` (pass, pre-existing warnings), `npm run test:backups` (8/8),
  `npm run test:bot-grok` (pass), `npm run audit:dead` (inventory only),
  `npm run build` (pass with `OPENAI_API_KEY` placeholder — import-time OpenAI client in
  WhatsApp webhook is a pre-existing env requirement at build collect time).
# 2026-08-26 — Betsy v2 Slice 1: security and safety

- Replaced first-membership tenant selection across billing, Tilopay, audit, and
  shared API tenant resolution with the active tenant selected by the session.
- Added missing Ventas dashboard RBAC; removed legacy MASTER-only UI gates from
  regular-tenant Clients, Inventory, and Shipping while retaining OWNER→MASTER
  authentication compatibility.
- Disabled destructive frequent-data seeding in production; invoice email and
  storage usage now report honest unavailable/unmeasured states.
- Restricted integration CORS to exact allowlisted origins and redacted request
  bodies, customer identity, addresses, API keys, and free-form metadata from logs.
- Retired direct client-side paid activation. Hosted checkout prices are server
  selected, provider correlation is persisted before redirect, webhook matching is
  fail-closed, and only verified payment events activate paid entitlements. FREE
  downgrade and cancellation are OWNER-only; cancellation must be provider-confirmed.
- Added an audited super-admin Enterprise offline-contract activation endpoint.
- Added `lm_retiro_order_allocations` to required backup coverage and its round-trip
  fixture without changing Logistics behavior.
- Prove: `npm run test:security` 14/14; `npm run test:backups` 8/8;
  `npm run test:bot-grok` pass; lint pass with existing warnings; TypeScript pass;
  production build pass; compiled server smoke returns 200 for `/` and sign-in,
  401 for unauthenticated `/api/auth/me`, and redirects protected Ventas to sign-in.

# 2026-08-27 — Betsy v2 Slice 2: DB-backed billing access

- Added a fresh-database ACTIVE/GRACE/RESTRICTED evaluator with staged
  observe/warn/enforce controls, exact seven-day windows, explicit approval, and a
  database global kill switch. The additive feature-flag SQL is source-controlled but
  was not executed; missing schema fails safe to observe-only.
- Applied the write guard through shared API auth and audited custom adapters,
  including imports, CE confirmation, status changes, invoice/guía operations, bot
  tools, social/config changes, and tenant-scoped user mutations. Removed stale JWT
  billing redirects and added a static route coverage suite.
- Kept OWNER checkout/create-plan-repeat reachable while restricted. Direct paid plan
  writes remain retired; provider retries cannot extend a stored grace window; the
  expiry cron starts/preserves grace and never changes the plan to FREE.
- Made FREE and paid orders unlimited across Ventas, website, import, bot, usage API,
  and billing UI. Website intake remains open with unique order idempotency, layered
  rate limits, and restricted-backlog marking. Routine observe/integration logs do not
  include order or customer content.
- Prove: security/coverage 68/68; `tsc --noEmit`; lint pass with existing warnings;
  production build pass; compiled local server smoke pass. No remote push, SQL,
  shared-database mutation, provider message, or charge.

# 2026-08-27 — Betsy v2 Slice 3: canonical order lifecycle

- Added a single tenant-gated, serializable lifecycle for all non-bot write adapters:
  Ventas, website, Excel, order update, production status, CE confirmation, and tenant
  guía generation. Activation is all-on/all-off and requires an acknowledged client
  backfill marker; bots stay legacy until Slice 5.
- Added nullable Order→Client linkage, normalized phone/email identity, provisional
  clients, a no-auto-merge conflict queue, durable adapter idempotency, and exact
  inventory allocation deltas. All schema is additive SQL and was not executed.
- Added a tenant-scoped client-link dry-run/apply package. Apply is double-gated by an
  exact tenant environment value and remains subject to separate approval.
- Corrected invoices to treat `Order.total` as gross and IVA-inclusive, versioned new
  calculations while leaving old rows still, and replaced fake email success with
  provider-confirmed Resend state.
- Consolidated regular-tenant guía APIs into the shared bounded generator, persisted
  delivery type and manual guía numbers, and removed the duplicate UI `Enviado` write.
- Prove: lifecycle 8/8; security/write coverage 69/69; TypeScript and lint pass (only
  existing warnings); production build and compiled unauthenticated smoke pass. No
  remote push, SQL, shared-database mutation, provider message, SOAP call, or charge.

# 2026-08-27 — Betsy v2 Slice 4: server-driven Producción and Clients

- Added dedicated, tenant-gated Producción metadata/list/summary APIs with signed,
  filter-bound keyset cursors and server-side search/type/date/courier/priority/status
  filtering. The legacy Ventas stream remains unchanged.
- Replaced Kanban drag-and-drop and silent first-100/20 slicing with independent
  per-column pages, `Sin configurar`, explicit status moves, idempotency, and stale-write
  compare-and-set protection.
- Added tenant-specific terminal-status classification SQL and a dry-run-first mapping
  tool. Unknown/unclassified work stays visible; 30-day terminal retention requires a
  complete, explicitly approved tenant mapping.
- Upgraded Clients in place with server pagination, filtered KPIs/facets/export, lazy
  `clientId`-only history, and a hard backfill-readiness gate.
- Tenant-keyed the configuration cache and rejected late responses after tenant
  switches without reopening the already scoped config request fan-out.
- Added a local Playwright production-build harness and explicit opt-in tenant suite.
- Prove: pagination contracts 8/8; security 69/69; lifecycle 8/8; backups 8/8; bot Grok,
  TypeScript, lint (existing warnings), production build (125 pages), and Playwright
  smoke 3/3 pass. Additive SQL was not run; no database/provider writes or remote push.

# 2026-08-27 — Betsy v2 Slice 5: durable bot inbox

- Added a Postgres-backed, persist-before-200 inbox for enabled WhatsApp and Telegram
  tenants. Batched Meta messages persist atomically. Claims use provider-ID
  deduplication, leases, per-conversation ordering, bounded retries, hard time budgets,
  a protected recovery cron, and terminal payload cleanup; no permanent server process
  is assumed.
- Added durable per-chunk/document outbound claims. Confirmed provider deliveries skip
  on retry; unresolved provider acceptance becomes a terminal reconciliation case
  instead of sending duplicate text or PDFs. Redis history claim+append is atomic and
  both user and assistant turns are operation-keyed.
- Kept bot writes all-on/all-off with the canonical lifecycle. The bot is enabled only
  when inbox, bot-lifecycle, and Slice 3 readiness flags all agree, and billing is read
  from the database immediately before every write.
- Replaced unlinked-session `MANAGER` authority with `BOT_OPERATOR`. Existing sessions
  are grandfather-safe without a destructive backfill; new unlinked sessions consume
  seats, observe/warn reports actual overage, and enforce blocks only new over-limit
  connections. Bot and dashboard membership create/reactivation use the same tenant
  lock.
- Added an explicitly confirmed, provider-idempotent factura tool with versioned
  IVA-included calculations and honest Resend state. Removed message, transcription,
  chat-ID, media-URL, and extracted-customer-content logs from the bot path.
- Added a stable per-order Correos side-effect claim for queued bot guías. Ambiguous
  provider results stop for reconciliation rather than retrying into a duplicate;
  queued manual guías are directed to Producción instead of the legacy direct writer.
- Corrected tenant feature-flag reads to use the schema's tenant-ID scope rather than a
  stale literal `tenant`, which otherwise made Slice 2–5 tenant flags impossible to
  activate.
- Prove: inbox 8/8; lifecycle 8/8; security 69/69; pagination 8/8; backups 8/8; bot
  Grok, TypeScript, lint (existing warnings), production build (125 pages), and
  Playwright smoke 3/3 pass. Additive SQL was not run; no database/provider writes or
  remote push.

# 2026-08-28 — Betsy v2 Slice 6: soft-delete and restore

- Added nullable Order archive metadata and an off-by-default tenant flag. Direct and
  bulk regular-tenant deletes retain the original row when enabled, while top-level
  active-order reads and legacy mutations reject archived rows.
- Bound every archive version to its exact audit event in the same serializable
  transaction. Restore requires OWNER, current DB billing access, the matching audit
  event, an exact `deletedAt` compare-and-set, and the 30-day window.
- Restore only unsets `deletedAt` on the retained Order and writes an atomic audit row.
  It never reconstructs from audit JSON and never replays invoice, guía, payment, or
  inventory side effects. Historical hard-deletes remain non-restorable.
- Added OWNER restore controls to Auditoría, fail-closed API coverage, the additive SQL
  package, and active-row filtering for the regular finance-cost raw query. Logistics
  behavior remains outside this slice.
- Prove: archive 6/6; security 70/70; lifecycle 8/8; pagination 8/8; inbox 8/8; backups
  8/8; bot Grok, TypeScript, lint (existing warnings), production build (125 pages),
  and Playwright smoke 3/3 pass. Additive SQL was not run; no database/provider writes
  or remote push.

# 2026-08-29 — Betsy v2 Slice 7: tenant setup, AI paste, and revenue observation

- Kept the existing customer paste heuristic as the immediate local parser and added an
  explicit, off-by-default Grok suggestion layer. Only customer fields leave the app;
  output is strict, non-writing, bounded, rate-limited, stale-text protected, and must be
  reviewed before Ventas can submit.
- Added additive tenant-persisted setup progress with optimistic revisions, optional
  skips, dismissal, restart-without-delete, safe regular-tenant return links, and legacy
  fallback when the flag/table is absent. Fixed Config's stale deep-link tab allowlist.
- Added one consolidated, bounded v2 statistics overview and observation UI separating
  booked gross, collected revenue, confirmed COD, and pending COD while leaving existing
  numbers and endpoints unchanged off-flag.
- Scoped visual cleanup to regular-tenant setup, Ventas AI review, and statistics cards;
  no Logistics file was changed.
- Prove: tenant UI 7/7; security 71/71; lifecycle 8/8; pagination 8/8; inbox 8/8;
  archive 6/6; backups 8/8; bot Grok; TypeScript; lint (existing warnings); production
  build (126 pages); Playwright smoke 3/3. No SQL, shared-data/provider write, remote push,
  or deployment.

# 2026-08-29 — Betsy v2 integrated release verification

- Fetched and locally merged `origin/dev` at `610f77c` after all seven slice commits.
  Preserved upstream performance, finance, payroll, and Logistics archive fixes while
  retaining v2 DB-backed billing display, tenant-keyed configuration, bounded statistics,
  and server Producción contracts.
- Fixed the Producción lazy-dialog merge import and enabled Next's isolated webpack
  build worker after the Windows in-process compiler terminated natively without a JS
  error. The clean production build then completed all 126 routes.
- Updated Playwright to serve the actual standalone artifact, including its static and
  public assets and local env, rather than relying on `next start` compatibility.
- Prove: TypeScript; lint (existing warnings); production build (126 routes); standalone
  Playwright 3/3; security 71/71; lifecycle 8/8; pagination 8/8; inbox 8/8; archive 6/6;
  tenant UI 7/7; backups 8/8; bot Grok; upstream payroll/finance; read-only Logistics
  archive regression. No SQL, shared-data/provider write, remote push, or deployment.

# 2026-09-21 — Betsy Agent Layer plan (A0, docs only)

- Added `docs/plans/betsy-agent-layer-fable-2026-09-21.md`: Fable 5.1 phased plan (A0–A5)
  to make Soft `/chats` agent-driven (Respond.io-style AI Agents) per Rafael GO 2026-09-21 CR
  — SocialAccount → ChatAgent binding with tenant default fallback (conversation override
  later), Forge WhatsApp sales agent pilot (`cmhsibjue0004js04gie724nx`), Grok 4.6 default
  model only (Rafael reconfirmed: no dual-model router in v1; cheap/hybrid is a one-line
  later-cost-control footnote, not a phase or acceptance requirement). Sol
  (`gpt-5.6-sol-high`) plan-mode review folded in (§9).
- Verified in code and recorded as gaps: `runSoftAiTurn` is a regex heuristic (no LLM);
  Soft direct Graph sender skips the WA 24 h window check; `ChatAutomationJob.payload` is
  nulled on completion (usage needs its own `ChatAgentTurn` table); history is filtered by
  metadata peer, not `conversationId`.
- Refreshed `docs/status/betsy-chats-respondio-2026-09-20.md` to tip `bd70517` (Phases 1–5
  LIVE; P4/P5 DONE) with a NEXT pointer to the Agent Layer plan; added a follow-on pointer
  in the Respond.io parity plan header.
- Prove: docs only — no product TypeScript, SQL, UI, flag, or Supabase change. Soft chrome,
  `src/lib/bot/**`, `src/app/api/bot/**` untouched (`git diff --stat` = `docs/**`).

# 2026-09-21 — Betsy Agent Layer plan amendment (Rafael GO; PR #53 ready)

- Rafael GO 2026-09-21 CR: folded ALL CoS + Advisor suggestions into
  `docs/plans/betsy-agent-layer-fable-2026-09-21.md`; §8 is now "decided" (18 items),
  no longer open. Locked defaults written in: Probar + panic pause + IA trust badges as
  A1 musts; `ChatAgentTurn.outputText` retention 90 days (metrics may stay longer);
  new agents default `operationMode=ai_suggest` until explicit upgrade; Forge WA
  allowlist id `cmuahn5y90001l504y6kksiek`; Grok 4.6 only; Soft HOLD; staff HARD LOCK.
- Advisor musts 1–8 written as A1 blockers: §2.5 pre-send gate table (human already
  replied → skip; per-conversation single-flight via partial unique index on
  `ChatAutomationJob(conversationId) WHERE status='processing'`; token health; 24 h
  window; `aiFullUnlock` hard gate), §2.7 operator surfaces (`/config/agentes` Spanish
  config + Probar + panic controls + Historial audit; inbox trust labels in data
  components only), §2.8 PII redaction + 90-day purge cron, §2.9 Forge fixture set and
  dark-run unlock; A1 acceptance tests 1.11–1.22.
- Should-adds written into A2–A5 (knowledge as data-not-instructions, media/comprobante
  → escalate, paste-and-approve wizard, plain-Spanish pending-action row, usage panel
  outcome mix, per-account subcap, extra injection fixtures, quiet hours, typing
  indicator, prompt Restaurar, stop-words, eval pack); same-person WA+IG identity parked
  in §7 roadmap. Added §3.5 fallback (fixes a dangling reference) and §9.1 traceability
  table. Status board NEXT updated. PR #53 marked ready for squash-merge; A1 next.
- Prove: docs only — `git diff --stat` = `docs/**`; no SQL, Prisma, or app code. Sol
  verification not run (Rafael: not required); Executor self-check of § refs and links.
