# Forge WA — Probar ↔ live fidelity + Soft agent model Grok 4.7

> **Status (2026-09-22 CR):** plan only. Rafael García GO'd (2026-09-21) the ops enable, this
> plan, and a later Cursor implementation. No product code in this PR. Do not implement from
> this document until Rafael says implement; do not merge to `dev` until Rafael says merge.
>
> **Author:** Fable 5.1 (Cursor cloud, planner only; Sol `gpt-5.6-sol-high` reviewed the gap
> list as Advisor) · **Base:** `dev` @ `63be5e7` (AL2-A1 #64–#66 + sales SoT #67; SQL 029 live)
> · **Parent plans:** [`betsy-agent-layer-arc2-fable-2026-09-21.md`](./betsy-agent-layer-arc2-fable-2026-09-21.md),
> [`betsy-al2-a1-ux-redo-fable-2026-09-21.md`](./betsy-al2-a1-ux-redo-fable-2026-09-21.md),
> [`betsy-sales-agent-pipeline-2026-09-21.md`](./betsy-sales-agent-pipeline-2026-09-21.md)
>
> **Model lock for implementers:** Cursor Executor = **grok-4.7 high fast** (`grok-4.7-high-fast`)
> only. Never grok-4.5 or any 4.5 alias for coding, planning, or verification.

## Pilot constants (reference only — never hardcode in `src/`)

| Item | Value |
|---|---|
| Tenant Forge | `cmhsibjue0004js04gie724nx` |
| Forge WA `SocialAccount` | `cmuahn5y90001l504y6kksiek` (+506 6104 3737) |
| Flags (both ON for live Meta sends) | `chat_agent_layer_v1` + `soft_tenant_ai_v1` |
| Allowlist | Forge WA only (already) |
| `fixtureSetHash` | `forge-wa-v2-al2-a1-2026-09-21` |
| `aiFullUnlock` | empty until a Probar pass records it |

Ops (not this plan): enable both flags, resume AI (`ai_active`) on the test thread. Account and
tenant ids live only in `src/lib/soft-ai/__fixtures__/forge-wa-v2/index.ts` and tests.

## 1. Same page

**What I understood.** The Forge WhatsApp pilot runs the Soft Agent Layer
(`src/lib/soft-ai/agent-turn.ts` → `executeAgentLayerTurn`) behind two tenant flags, an account
allowlist, and an `aiFullUnlock` gate keyed by `fixtureSetHash`. `/config/agentes` has a
WhatsApp-styled Probar sandbox (`runAgentTestTurn`) that never touches Meta. Rafael wants
(A) Probar to be a faithful dry run of the live turn so a Probar pass can be trusted to unlock
real sends, and (B) the Soft agent model allowlist moved from `grok-4.6` to `grok-4.7` without
breaking stored agents. Staff bot is a separate system (`src/lib/bot/**`, `src/app/api/bot/**`)
that never writes `ChatMessage`; it must not be touched.

**What we will do (code, later, Cursor grok-4.7).**

- Extract one shared runtime-input assembly used by both live and Probar (prompt, tools, canal
  context, knowledge, shortcuts, history window, customer name), and one shared outcome decision
  (`send` / `suggest` / `skip`) so Probar's "enviaría" equals live `finishDeliveryOrSuggest`.
- Make Probar channel-bound: only channels this agent attends are selectable; the server refuses
  a channel the live resolver would route to another agent.
- Add an audited unlock write path (`POST /api/chat/agents/[id]/test/unlock`) that re-runs the
  qualification server-side and writes `aiFullUnlock[socialAccountId]` with
  `fixtureSetHash`, `passRate`, `approvedBy`, `passedAt` (+ `agentId`, `model`, `agentVersion`).
- Keep stale unlocks fail-closed (hash mismatch already; add agent/model identity).
- Label agent-layer bubbles in `/chats` with the agent name (snapshot in message metadata), not
  a generic "IA envió".
- Allow `grok-4.7` and `grok-4.6`; default new agents to `grok-4.7`; migrate the Forge pilot
  agent by audited PATCH (SQL only as a gated fallback).

**What we will not do.**

- Soft chrome redesign (`SoftSlimNav`, `SoftInboxBuckets`, `SoftCopilotRail`) — HOLD.
- Any change under `src/lib/bot/**` or `src/app/api/bot/**` — HARD LOCK, empty diff.
- Instagram Meta App Review / any Meta Submit.
- SINPE queue, orders, inventory UI, outbound images (`ChatAgentAsset`, Arc 2 A2), buttons /
  interactive WA messages.
- Schema changes, `prisma db push`, `prisma migrate`; production SQL only as a gated note (§8).
- Changing classifier / safety-router / output-validator wording rules.

**Done looks like.** AT-WA-1…4 and AT-P-1…4 (§4) each have a passing test or a Preview
screenshot in the implementation PR(s); `npm run test:soft-ai-agent`, `npm run test:chat-harden`,
`npm run lint`, `npm run build` green; `git diff --exit-code` empty for the locked paths; a
Forge Probar pass writes `aiFullUnlock` visible in the flag config and in the Canales row; flag
off returns the pilot to today's behavior with no data to undo.

## 2. Current state — live turn vs Probar (as of `63be5e7`)

| Step | Live (`executeAgentLayerTurn`, `agent-turn.ts:239–677`) | Probar (`runAgentTestTurn`, `agent-turn.ts:914–1122`) |
|---|---|---|
| Entry | `chat/webhook` → `enqueueSoftAiAfterInbound` → `processJobById` → `automation-processor.ts:dispatch` → agent layer when flag on | `POST /api/chat/agents/[id]/test` → `probeAgent` → `runAgentTestTurn` |
| Agent selection | `resolveChatAgent` via `ChatAgentBinding` (exact `social_account`, else `tenant_default`), live status, model allowlist | `chatAgent.findFirst({ id })` — **no binding check** |
| Conversation mode | `resolveSoftAiAgentMode(conversation.aiMode, flag agentState)` | assumed `ai_active` |
| Gates | claim (superseded / human_replied), pre-model (flags, allowlist, daily cap), pre-send (10 gates in `agent-claim-gates.ts:172–284`) | `collectDryRunBlockers` (7 static checks) + test cap |
| History | last 24 `ChatMessage` incl. the trigger inbound (duplicated as `inboundText`) | client-supplied ≤ 40, windowed to 24 in prompt |
| Canal context | `accountId` (phone_number_id) + `displayName` | `accountId: ''`, no name |
| Customer name | `conversation.peerName` | `null` |
| Tools | `agent.enabledTools ∪ {search_approved_knowledge}` | `agent.enabledTools ∪ {search_approved_knowledge, use_shortcut}` |
| Model | `agent.model` via `resolveSoftAiModel` (allowlist) | same |
| Output policy | `applyFinalOutputPolicy`, `needsHuman` / `fallbackUsed` force suggest | same policy, but `wouldSend` computed **before** the model |
| Send | `sendMetaText` text-only, `deliverOnce`, `dualWriteChatMessage` metadata `{ softAi, agentId, turnId }` | none (`mode: 'test'`, `conversationId: null`) |
| Unlock | `hasAiFullUnlock(config, accountId)` = record exists and `fixtureSetHash === config.fixtureSetHash` | shown as `ai_full_not_unlocked` blocker; **no write path anywhere** |

## 3. Gap list (file pointers)

Themes from the field reports: **channel attend binding**, **unlock gate**, **model**, **media**,
plus **prompt assembly**, **gates / outcome**, **monitor label** found while reading.

### Channel attend binding

- **G1** Probar does not verify the chosen channel is attended by this agent. Live routes by
  `ChatAgentBinding`. `agent-turn.ts:941–946` (account lookup only) vs `agent-resolver.ts:221–333`.
- **G2** `selectWhatsappTestChannel` prefers bound channels but falls back to any WhatsApp
  channel when none is bound. `test-channel.ts:31–33`. An owner can "pass" Probar on a channel
  another agent serves live.
- **G3** Replay takes no `socialAccountId` and validates no binding; its report is agent-wide.
  `src/app/api/chat/agents/[id]/test/replay/route.ts:27–40`.
- **G4** Rebinding an account to another agent (`setAgentBinding`, `agent-admin.ts:~466–532`;
  `bindings/route.ts`) preserves `aiFullUnlock[accountId]`, so an unlock earned by agent A
  applies to agent B. Only `panicRemoveAllowlist` and `aiAllowed=false` delete it
  (`agent-admin.ts:604–609, 877–878`).

### Unlock gate

- **G5** No code writes `aiFullUnlock`. Arc 2 §2.8 assumed "CoS records it" — that means SQL by
  hand today. `agent-admin.ts` only deletes entries; replay returns a report.
- **G6** `AiFullUnlockRecord` has no `agentId`, `agentVersion`, or `model`; `hasAiFullUnlock`
  checks only the hash. `agent-types.ts:83–88`, `agent-config.ts:94–101`. A stale unlock survives
  agent edits, model changes, and rebinding.
- **G7** Fixture hash is duplicated: `FIXTURE_SET_HASH_V2` (`agent-types.ts:91`) and
  `FORGE_WA_V2_FIXTURE_SET_HASH` (`__fixtures__/forge-wa-v2/index.ts:7`). Same string today;
  drift would silently lock or unlock.
- **G8** Replay is deterministic only (classifier + shortcuts, `agent-replay.ts:49–73`); a pass
  never exercises the model. Acceptable as gate 1 of 2, not as the only gate.
- **G9** Flag-config writes are read-modify-write JSON with no lock (`agent-admin.ts:595–628,
  866–899`); a concurrent allowlist edit and unlock write can lose one of them.
- **G10** Shortcut create / update / delete do not bump `ChatAgent.version`
  (`shortcut-admin.ts:87, 147, 192` bump only the shortcut row); `import/apply` does
  (`shortcut-import-server.ts:204–210`). If unlock is version-aware, atajo edits will not
  invalidate it unless this is fixed.

### Model

- **G11** `CHAT_AGENT_MODEL_ALLOWLIST = ['grok-4.6']` (`agent-types.ts:9`). `agent-resolver.ts:291,
  324` skips `model_not_allowed` when a stored model is not allowlisted — removing `grok-4.6`
  from the list would silence every existing agent.
- **G12** Default `'grok-4.6'` hardcoded in `agent-admin.ts:272, 708, 753`,
  `shortcut-import-server.ts:116`, `llm/client.ts:18`; Prisma `@default("grok-4.6")`
  (`schema.prisma:1021`) and SQL 027 `DEFAULT 'grok-4.6'` (app always sets `model`, so DB default
  is inert). `SOFT_AI_XAI_MODEL` env is effectively dead because `agent.model` always overrides.
- **G13** Prompt cache key is `tenant:agent:version:account` without model
  (`llm/runtime.ts:111–116`). Pricing in `llm/usage.ts` is a single 4.6 rate.
- **G14** Test asserts the 4.6-only allowlist: `src/lib/__tests__/soft-ai-agent-layer.test.ts:122–127`.

### Media

- **G15** Inbound media: both paths use `decideInbound(messageType)` → `sys_handoff_media`; Probar
  simulates via the message-type select (`AgentInternalTests.tsx:46–57`). Parity OK.
  Outbound: text only in both (`sendMetaText` `type: 'text'`, `agent-turn.ts:142–146`); no
  buttons / interactive / images anywhere. The Probar bubble has no `kind` — it renders strings
  only (`AgentTestSandbox.tsx:143–157`). "WA bubble schema" needs to be defined as text-v1 so A2
  images slot in later without a rewrite.

### Prompt assembly / runtime

- **G16** Tools differ: live force-enables `search_approved_knowledge` only
  (`agent-turn.ts:513–518`); Probar also forces `use_shortcut` (`agent-turn.ts:1000–1005`).
  Agents created before AL2 lack `use_shortcut` in `enabledTools` → Probar uses shortcuts, live
  does not.
- **G17** Canal context differs (`agent-turn.ts:397–409` vs `1016–1020`); customer name differs
  (`conversation.peerName` vs `null`).
- **G18** Live history includes the trigger message and then appends it again as `inboundText`
  (`loadHistory` has no `sentAt < trigger.sentAt` / id exclusion, `agent-turn.ts:82–103, 411`);
  Probar history holds only prior turns. Prompts differ by one duplicated line.
- **G19** Probar `decisionTrace.historyCount` reports up to 40 while the prompt windows to 24
  (`agent-turn.ts:950, 981`; `llm/prompt.ts:161–166`).

### Gates / outcome

- **G20** `wouldSend` is computed before the model (`agent-turn.ts:972`) and ignores
  `needsHuman`, `fallbackUsed`, `escalate`, and `policy.needsHuman`; live forces suggest on all of
  them (`agent-turn.ts:667–671`). Probar can show "enviaría sí" where live would suggest.
- **G21** Sandbox turn row always persists `fallbackUsed: false` (`agent-turn.ts:1104`) and the
  response has no `needsHuman` / `escalate` / `fallbackUsed` fields, so the UI cannot show them.
- **G22** Probar skips pre-send gates that depend on live data (token health, `stale_version`,
  `human_replied`, 24 h from `lastInboundAt`, daily live cap). Acceptable if the UI names them as
  "no simulado" instead of implying they passed.

### Monitor label (`/chats`)

- **G23** `SoftThreadPane.tsx:338–383` labels any `metadata.softAi === true` as "IA envió"; the
  agent layer already writes `agentId` / `turnId` (`agent-turn.ts:872–879`) but no name snapshot.
  Legacy Soft AI and the agent are indistinguishable in the thread. The staff bot never writes
  `ChatMessage`, so it cannot appear here — the issue is attribution, not leakage.

## 4. Acceptance tests (Done-when)

Run on a Vercel Preview with the Forge tenant per `.cursor/skills/verify-betsy/SKILL.md`. Meta
sends need both flags ON and `ai_active` on the test thread (ops). Each box needs a screenshot,
a log line, or a passing test in the PR body.

- [ ] **AT-WA-1 live send.** Inbound on Forge WA (allowlisted), both flags ON, conversation
      `ai_active`, `aiFullUnlock[cmuahn5y90001l504y6kksiek].fixtureSetHash === config.fixtureSetHash`,
      agent `live` + `ai_full` → `ChatAgentTurn.status = 'delivered'`, `ChatMessage` outbound with
      `metadata.softAi = true`, `metadata.agentId`, `providerMessageId` from Graph. Staff bot
      (`src/app/api/bot/whatsapp/webhook`) logs nothing for this message.
      Done-when: one delivered turn row + the reply visible on the phone.
- [ ] **AT-WA-2 fail closed.** Same inbound with conversation `human` (take over) or `paused` →
      `ChatAgentTurn.status = 'skipped'`, `skipReason ∈ {human_before_send, paused_before_send}`,
      no Graph call (`deliverOnce` not invoked). Flip mode between generation and send → same
      result via the pre-send re-read (`agent-turn.ts:733–753`). Done-when: unit test on
      `decideTurnOutcome` + one Preview skipped row.
- [ ] **AT-WA-3 monitor shows the agent.** `/chats` thread for that conversation renders the
      agent turn as an outbound bubble labeled `<emoji> <agent name> envió` (snapshot from
      metadata), header `Agente: <emoji> <name> · Responder`, state dot `IA`. Legacy Soft AI (no
      `agentId`) still says "IA envió". No staff-bot wording anywhere. Done-when: unit test on the
      label helper + Preview screenshot.
- [ ] **AT-WA-4 staff bot HARD LOCK.** `git diff --exit-code dev -- src/lib/bot src/app/api/bot`
      is empty on every implementation PR; `chat-agent-locked-paths.test.ts` extended to the new
      modules (shared assembly, unlock route) asserting no `@/lib/bot` import and no
      `process.env.WHATSAPP_`. Done-when: CI step + test green.
- [ ] **AT-P-1 same assembly.** Given identical agent row, account row, shortcuts, knowledge,
      history and inbound text, live and Probar produce byte-identical `instructions`, user prompt,
      tool list, and canal context. Done-when: `assembleAgentRuntimeInputs` unit test
      deep-equals both call shapes; a grep lock asserts `runSoftAiLlmRuntime` is called only via
      the shared builder in `agent-turn.ts`.
- [ ] **AT-P-2 bubble schema.** Probar renders `WaBubble = { kind: 'text', from: 'customer' |
      'agent', text, at, label? }` with an exhaustive `switch (bubble.kind)`; `kind` is the
      discriminant reserved for `image` (A2). Live outbound is `type: 'text'` and Probar never
      shows a bubble kind live cannot send. Done-when: type test + Preview screenshot of a
      two-turn thread (`precio con envío?` → reply → `y a Heredia?`).
- [ ] **AT-P-3 unlock write.** In Pruebas internas, after a green replay for the bound Forge WA
      channel, **Aprobar envío real** → confirm → `POST /test/unlock` re-runs qualification and
      writes `aiFullUnlock[socialAccountId] = { passedAt, approvedBy: <userId>, fixtureSetHash:
      'forge-wa-v2-al2-a1-2026-09-21', passRate: 1, agentId, agentVersion, model }` plus one
      `AuditLog` (`reason: 'chat_agent_ai_full_unlock'`). Canales row shows "Envío real:
      desbloqueado". Done-when: route test (happy + each refusal) + Preview screenshot + flag
      config JSON pasted in the PR.
- [ ] **AT-P-4 stale unlock stays closed.** With `aiFullUnlock[...].fixtureSetHash =
      'forge-wa-v1-a1-2026-09-21'` (or any string ≠ config), `hasAiFullUnlock` is false,
      `composeEffectiveBehavior` returns `suggest`, pre-send gate 10 returns `ai_full_not_unlocked`,
      Probar shows blocker `ai_full_not_unlocked`, and the Canales row shows "Aprobación vencida".
      Same when `agentId` mismatches the resolved agent or `model` ≠ `agent.model`. Done-when:
      unit tests on `hasAiFullUnlock` (hash, agent, model) + one Preview suggested row.

## 5. Ordered implementation packs (Cursor, grok-4.7 high fast)

One PR per pack, draft, base `dev`, no merge without Rafael. Each PR body links this file, checks
its AT boxes, updates `docs/audits/CHANGELOG_AGENTS.md`, and passes the locks in AT-WA-4.
Packs P1–P3 are independent of ops flag state; P4/P5 need the flags ON for Preview proof.

### P0 — Guardrails first (tiny, same PR as P1 or standalone)

- `src/lib/soft-ai/agent-types.ts`: export `DEFAULT_CHAT_AGENT_MODEL`; re-export
  `FORGE_WA_V2_FIXTURE_SET_HASH` as the single source and make `FIXTURE_SET_HASH_V2` an alias
  (or delete one — G7).
- `src/lib/__tests__/chat-agent-locked-paths.test.ts`: add the file list for the new modules
  created in P2/P3 (grep lock on `@/lib/bot`, `@/app/api/bot`, `process.env.WHATSAPP_`); add a
  literal-lock test that `src/lib/soft-ai/**` contains no `'grok-4.6'` string outside
  `agent-types.ts` and tests.
- Acceptance: tests green; no behavior change.

### P1 — Model allowlist 4.6 → 4.7 (Mission B)

Files: `agent-types.ts`, `agent-admin.ts` (272, 708, 753), `shortcut-import-server.ts:116`,
`llm/client.ts:18`, `llm/model-policy.ts` (header comment), `llm/runtime.ts` (cache key),
`llm/usage.ts`, `src/lib/__tests__/soft-ai-agent-layer.test.ts`.

1. `CHAT_AGENT_MODEL_ALLOWLIST = ['grok-4.7', 'grok-4.6'] as const`;
   `DEFAULT_CHAT_AGENT_MODEL: ChatAgentModel = 'grok-4.7'`. Keep 4.6 so stored rows keep
   resolving (G11) and rollback is a one-line default flip.
2. Replace every literal default with `DEFAULT_CHAT_AGENT_MODEL` (G12). Leave Prisma / SQL 027
   defaults alone (inert; changing `schema.prisma` invites a forbidden `db push`).
3. `promptCacheKey` adds `model` (G13) — one cold cache per agent, no other effect.
4. `llm/usage.ts`: pricing table keyed by model; 4.6 keeps `$2 / $6`; 4.7 entry **must be
   verified against xAI's published price before merge** — until then reuse 4.6 numbers and keep
   `pricingVersion = 'xai-2026-09'`; if the price differs, bump to `xai-2026-09b` and record it in
   the changelog.
5. Tests: rename `rejects non-grok-4.6` → `allows grok-4.7 and grok-4.6, rejects others`;
   assert `DEFAULT_CHAT_AGENT_MODEL === 'grok-4.7'`; assert `resolveSoftAiModel()` (no override,
   no env) returns 4.7; assert `assertAllowedModel('grok-4.5')` throws (guards the 4.5 ban).
6. **Forge pilot row migration — no SQL by default.** `PATCH /api/chat/agents/[id]` already
   accepts `model`, validates the allowlist, bumps `version`, and audits
   (`agent-admin.ts:376–382`, `route.ts:95`). Add a read-only "Modelo" line + a **Cambiar a
   grok-4.7** button under Avanzado on `/config/agentes` (owner-visible, `update_config`).
   Rafael (or ops) clicks it for the Forge agent once P1 is deployed. The version bump makes
   in-flight turns fail `stale_version` (intended) and cold-starts the prompt cache.
   Do **not** run a tenant-wide UPDATE; SQL fallback only per §8.
7. Staff bot `src/lib/bot/ai-agent.ts` and `src/lib/customer-paste-grok.ts` stay on their own
   defaults — not shared clients, not touched.

Acceptance: AT-WA-4; existing 4.6 agents resolve (`resolveChatAgent` test with a 4.6 row);
new agents are 4.7; `npm run test:soft-ai-agent` green.

### P2 — Live / Probar runtime parity (Mission A, AT-P-1, AT-P-2, G1–G2, G16–G22)

Files: new `src/lib/soft-ai/agent-turn-inputs.ts`, new `src/lib/soft-ai/agent-turn-outcome.ts`,
`agent-turn.ts`, `agent-test-schema.ts`, `test-channel.ts`, `agent-claim-gates.ts`
(`collectDryRunBlockers` only), `src/app/api/chat/agents/[id]/test/route.ts`,
`src/app/config/agentes/AgentTestSandbox.tsx`, `AgentInternalTests.tsx`, `page.tsx`,
`src/lib/__tests__/soft-ai-probar-sandbox.test.ts`, new `soft-ai-agent-turn-parity.test.ts`.

1. `agent-turn-inputs.ts`: `effectiveEnabledTools(agent.enabledTools)` (force
   `search_approved_knowledge` only — live semantics win; G16), `loadCanalContextForAccount`
   (one Prisma select shared by both; G17), `assembleAgentRuntimeInputs({ agent, account,
   history, inboundText, clientName, shortcuts, knowledge, decision, toolCtxBase })` returning the
   full `SoftAiLlmRuntimeInput`. Both callers in `agent-turn.ts` use it; nothing else calls
   `runSoftAiLlmRuntime` directly.
2. `loadHistory` excludes the trigger row (`id !== triggerMessageId`) so the current inbound
   appears once (G18). This is a live prompt change — call it out in the PR and add a test.
3. `agent-turn-outcome.ts`: pure `decideTurnOutcome({ effectiveBehavior, unlockedForSend,
   needsHuman, fallbackUsed, escalate, conversationAiMode, gateBlockers })` → `{ outcome:
   'send' | 'suggest' | 'skip', reason }`. `finishDeliveryOrSuggest` and `runAgentTestTurn` both
   use it; Probar computes `wouldSend` **after** the model (G20) and returns `outcome`,
   `needsHuman`, `fallbackUsed`, `escalate`; the sandbox turn row persists real `fallbackUsed`
   (G21). `historyCount` = windowed length (G19).
4. Channel binding: `runAgentTestTurn` calls `resolveChatAgent({ conversationAiMode: 'ai_active' })`
   for the chosen account; if the resolved agent id ≠ `input.agentId` → `blockedBy` gains
   `not_bound_to_channel` and no model call is made (G1). `selectWhatsappTestChannel` drops the
   "any WA channel" fallback; unbound → `mode: 'empty'` with copy "Este agente no atiende ningún
   canal de WhatsApp. Activalo en Canales." (G2). Existing test `channel never ninguno` updated.
5. Optional Probar inputs under Pruebas internas: `customerName` (maps to `clientName`) and
   `conversationAiMode` (`ai_active` | `human` | `paused`) so AT-WA-2 can be rehearsed offline.
   Gates that need live data (token health, `stale_version`, `human_replied`, live daily cap) are
   listed as "no simulado en Probar" in the trace panel (G22) — never as passed.
6. `WaBubble` type + exhaustive switch in `AgentTestSandbox.tsx` (G15 / AT-P-2). Text only.
7. Tests: parity deep-equal (AT-P-1); outcome table (AT-WA-2 offline); not-bound blocker;
   history excludes trigger; `historyCount === 24` for 40 inputs.

Acceptance: AT-P-1, AT-P-2, offline half of AT-WA-2; `test:soft-ai-agent` + `test:chat-harden`
green; Preview screenshot of the two-turn thread with trace collapsed.

### P3 — Audited unlock gate (AT-P-3, AT-P-4, G3–G10)

Files: `agent-types.ts`, `agent-config.ts`, `agent-admin.ts`, `agent-replay.ts`,
`agent-resolver.ts`, `agent-claim-gates.ts`, `shortcut-admin.ts`, new
`src/lib/soft-ai/agent-layer-config-mutate.ts`, new
`src/app/api/chat/agents/[id]/test/unlock/route.ts`, `test/replay/route.ts`,
`ChannelsEditor.tsx`, `AgentInternalTests.tsx`, new `src/lib/__tests__/soft-ai-unlock.test.ts`.

1. `AiFullUnlockRecord` gains optional `agentId`, `agentVersion`, `model`, `canaryCount`
   (parse tolerates old records; none exist in prod). `hasAiFullUnlock(config, accountId,
   ctx?: { agentId, model, agentVersion })`: false when hash ≠ config, when `agentId` present and
   ≠ ctx, when `model` present and ≠ ctx. `agentVersion` is recorded and shown; strict
   version matching sits behind `config.strictUnlockVersion` (default `false` for the pilot —
   **Decision D1 for Rafael**, see §7). Resolver and pre-send gate 10 pass the ctx (G6).
2. `agent-layer-config-mutate.ts`: `mutateChatAgentLayerConfig(tenantId, fn)` — transaction
   with `SELECT … FOR UPDATE` on the `TenantFeatureFlag` row, apply `fn(before) → after`, write,
   return `{ before, after }`; audit **after** commit (P2028 rule). Move `setAgentChannelConfiguration`,
   `panicRemoveAllowlist`, and the new unlock through it (G9).
3. `setAgentBinding` (and the bindings route) delete `aiFullUnlock[accountId]` whenever the
   bound agent for that account changes or the binding is deactivated (G4). Shortcut
   create / update / delete bump `ChatAgent.version` (G10) — check the two `expectedVersion`
   consumers (`shortcut-import-server.ts:202`, `agent-claim-gates.ts:213`) still behave.
4. `replayFixtures` unchanged; the replay **route** accepts optional `socialAccountId` and
   returns `boundAgentId` so the UI can grey out **Aprobar** when unbound (G3). "Replay todo"
   stays read-only.
5. `POST /api/chat/agents/[id]/test/unlock` body `{ socialAccountId }`, permission
   `update_config` (same as every agent config write). Server-side, in order, each refusal is a
   400 with a stable code:
   `ACCOUNT_NOT_TENANT` · `ACCOUNT_NOT_ALLOWLISTED` · `ACCOUNT_NOT_WHATSAPP` ·
   `AGENT_NOT_BOUND` (live resolver picks another agent) · `AGENT_NOT_LIVE` ·
   `REPLAY_FAILED` (`passRate < 1 || policyViolations > 0 || capped || examined === 0`) ·
   `HASH_MISMATCH` (report hash ≠ `config.fixtureSetHash`) · `CANARY_FAILED` ·
   `TEST_BUDGET_BLOCKED` · `XAI_NOT_CONFIGURED`.
   Canaries (**Decision D2**, recommended ON): the 5 fixtures tagged `canary` in
   `forge-wa-v2/index.ts` (add the tag; e.g. v02 price, v04 shipping, v08 payment_info, v13
   payment_proof, one off-topic) run through `runAgentTestTurn` with the shared assembly; all
   must return `outcome !== 'skip'`, `fallbackUsed === false`, no confirmation wording, and the
   expected handoff. Tokens go to `testDailyTokenCap`. Then re-read agent version + binding and
   write the record via `mutateChatAgentLayerConfig`. Audit `reason: 'chat_agent_ai_full_unlock'`
   with `{ socialAccountId, agentId, agentVersion, model, bindingScope, passRate, canaryCount,
   fixtureSetHash }`.
6. UI: Pruebas internas gains **Aprobar envío real** (enabled only when the last replay for the
   bound channel is green) with a confirm dialog naming the channel and agent; result line
   "Desbloqueado · hash … · passRate 1 · por <name> · <fecha>". `ChannelsEditor.tsx` row shows
   "Envío real: desbloqueado / bloqueado / aprobación vencida (hash|agente|modelo)". No new
   engineer strings on the main flow (UX redo rule).
7. Tests: `hasAiFullUnlock` matrix (hash / agent / model / version-strict); route refusals; happy
   path writes record + audit; rebind deletes unlock; concurrent mutate keeps both writes;
   `panicRemoveAllowlist` still clears it.

Acceptance: AT-P-3, AT-P-4; `test:soft-ai-agent` green; Preview: replay green → Aprobar →
Canales shows desbloqueado; flag config JSON in PR body.

### P4 — Monitor attribution in `/chats` (AT-WA-3, G23)

Files: `agent-turn.ts` (metadata snapshot `agentName`, `agentEmoji` at delivery),
`src/lib/soft-ai/agent-inbox-projection.ts` (`softAiOutboundLabel(metadata)`),
`src/components/chats/SoftThreadPane.tsx` (bubble footer only; chrome files untouched),
`src/lib/__tests__/soft-ai-agent-layer.test.ts`.

- Label: agent layer → `<emoji> <name> envió`; legacy Soft AI (no `agentId`) → `IA envió`;
  never derive the historical label from the *current* binding (names change).
- Acceptance: AT-WA-3; `test:chat-harden` green; `git diff --exit-code` empty for
  `SoftSlimNav.tsx`, `SoftInboxBuckets.tsx`, `SoftCopilotRail.tsx`.

### P5 — Live proof on Forge (no code; runbook step)

After P1–P4 are deployed and ops has both flags ON + `ai_active` on the test thread:
Probar → replay green → **Aprobar envío real** → send one inbound from the test phone →
AT-WA-1 delivered row + phone screenshot → take over from `/chats` → second inbound → AT-WA-2
skipped row. Record both in `docs/runbooks/chat-inbox-v2-forge-pilot.md` and the changelog.

## 6. Risk + rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| **Dropping 4.6 silences existing agents** (`model_not_allowed`). | Allowlist keeps 4.6; only the default moves. | n/a — never dropped. |
| **Grok 4.7 behaves differently on CR Spanish / tool calls.** | Migrate only the Forge agent, by audited PATCH, after P2 parity; canaries in P3 re-qualify on the new model; unlock is model-bound so a model change forces re-approval. | PATCH the agent back to `grok-4.6` (version bump, same audit path). |
| **Pricing for 4.7 unknown.** | Verify before P1 merge; `usage.ts` keyed by model. | Keep `xai-2026-09` numbers. |
| **Live prompt change (G18 trigger dedupe) alters replies.** | Called out in PR; parity test; fixtures replay unchanged (deterministic path). | Revert the one-line filter. |
| **Unlock too strict (version-bound) → pilot friction: every atajo edit re-locks.** | `strictUnlockVersion` default off (D1); UI shows "aprobado en vN" warning instead. | Flip config knob. |
| **Unlock too loose (account-only) → stale approval reused by another agent / model.** | Hash + `agentId` + `model` hard-bound; rebind deletes unlock. | Delete the entry (`panicRemoveAllowlist` or `aiAllowed=false`). |
| **Canary cost / flakiness blocks approval.** | 5 fixtures, `reasoning low`, charged to `testDailyTokenCap`; refusal codes are explicit; D2 lets Rafael turn canaries off. | `config.unlockCanaries = false`. |
| **Lost update on flag JSON.** | `mutateChatAgentLayerConfig` with row lock; audit after commit. | Re-run the admin action. |
| **Version bump on shortcut edits trips `stale_version` mid-turn.** | Intended fail-closed; turn is persisted `skipped`, next inbound regenerates. | None needed. |
| **Any regression in live sends.** | `chat_agent_layer_v1` OFF → `automation-processor.ts:125` falls back to legacy Soft AI; `soft_tenant_ai_v1` OFF → no Soft AI at all. No schema, no data to undo. | Flag off. |

## 7. Explicit decisions for Rafael (defaults if silent)

- **D1 strict version unlock:** default **off** (hash + agent + model bound; version recorded and
  warned). Turn on for post-pilot.
- **D2 model canaries in unlock:** default **on** (5 fixtures through the real runtime on the
  bound channel). Off = deterministic replay only (today's Arc 2 §2.8 meaning).
- **D3 Forge model migration path:** default **PATCH from Avanzado** (audited, version bump).
  SQL only per §8.

## 8. Gated production SQL note (NOT to run without Rafael's explicit GO)

Only if D3's UI path is unavailable. Scope to the resolved Forge agent, never tenant-wide:

```sql
-- gated: Forge pilot only; find the agent bound to the Forge WA account first
SELECT b."agentId", a.model, a.version
FROM "ChatAgentBinding" b JOIN "ChatAgent" a ON a.id = b."agentId"
WHERE b."tenantId" = 'cmhsibjue0004js04gie724nx'
  AND b.scope = 'social_account'
  AND b."socialAccountId" = 'cmuahn5y90001l504y6kksiek'
  AND b."isActive" = true;

-- then, with that id:
UPDATE "ChatAgent"
SET model = 'grok-4.7', version = version + 1, "updatedAt" = now()
WHERE id = '<agentId from above>'
  AND "tenantId" = 'cmhsibjue0004js04gie724nx'
  AND model = 'grok-4.6';
```

No `ALTER TABLE` on `ChatAgent.model` default (inert), no `prisma db push`, no `lm_*` contact.

## 9. Locks restated

- **Soft redesign HOLD** — `SoftSlimNav.tsx`, `SoftInboxBuckets.tsx`, `SoftCopilotRail.tsx`
  unchanged; only `SoftThreadPane.tsx` bubble footer in P4.
- **Staff bot HARD LOCK** — `src/lib/bot/**`, `src/app/api/bot/**` empty diff on every PR;
  `src/lib/bot/ai-agent.ts` keeps its own model default.
- **No Meta Submit** — no Instagram App Review, no new permissions.
- **No schema / SQL in PRs** — `prisma/schema.prisma`, `supabase/migrations/**` unchanged.
- **Model lock** — implementers run grok-4.7 high fast; never grok-4.5.
- **Merge lock** — every PR draft until Rafael says merge.

## Test plan (this PR)

n/a — docs only. `git diff --stat` shows `docs/**` only.
