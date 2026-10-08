# Betsy — Agent Studio, full AI sales flow and AI usage dashboard

Status: **PLAN v4 (2026-10-08)**. This version adds Rafael's corrections and answers, plus independent Advisor and
Verifier reviews (8 end-to-end sale scenarios walked against live code). It is the source of truth for the
implementing session. Nothing is implemented yet.

Live line: `claudio/chat-link-orders` (worktree `D:\Coder\CRM-v2-linkorders`). All paths below are relative to `src/`
in that worktree.

## 0. Ground rules (decided by Rafael — do not re-open)

1. **Generic.**
   - One agent per channel inside a tenant. All business data is entered in Betsy per agent; nothing
     business-specific goes in code. Never ask Rafael for business values.
   - Test setup is tenant **DeepSleep**:
     - channel *Forge Costa Rica* (WA +506 6104 3737): agent "Forge ventas"
     - channel *Prototipo Costa Rica* (WA +506 7113 3720): new agent
2. **No suggestion mode.** Activar = the agent's own generated tests pass, then one click. After that it answers
   directly.
3. **The order needs exactly what the tenant's /ventas form requires.** Nothing is assumed.
4. **The AI never does money math and never confirms a payment.**
   - A human confirms every payment and every contra-entrega order.
   - Fixed money and status messages (holding, confirmation) are built in code, not written by the LLM.
5. **A payment proof never turns the AI off.** The sequence:
   1. the agent sends a holding message ("Estamos verificando el pago, un momento 🙌", editable per agent)
   2. a human clicks **Pago verificado**
   3. the agent sends the confirmation with the order number
   4. then the guía
6. **Website orders are linked, never duplicated.**
   - When the match is certain, the order is auto-linked.
   - Otherwise a human chooses.
7. **Human approval wins.** A different amount or missing stock only shows a warning.
   - **No stock → the stock goes negative.**
   - The order is flagged "ingresado sin stock".
8. **Automatic guía after approval.**
   - Uses the *production* Correos code, copied out of `lib/bot`.
   - Only for Correos, non-COD orders with a resolved postal code.
   - Per-agent switch.
9. **Contra entrega.** No payment needed. Zone coverage is checked in code. A human confirms the order.
10. **Smart WhatsApp templates** for anything sent after 24h.
    - Instagram has no automatic sends after 24h: Meta allows the HUMAN_AGENT tag for humans only.
11. **Audio is transcribed** and answered normally.
12. **One inventory item per variant** (confirmed in DeepSleep). Product photos go per item or per group (category).
13. **Sharp and fast.** Every turn is timed. Target p50 under 6s.
14. **Staff bot.** Never edit or import it, with ONE approved exception: usage recording.
    - A recording call at its AI and Whisper calls.
    - A small tenant-context wrap at its 2 message entry points (Telegram, WhatsApp).
    - No behavior change.
15. **Tilopay is not involved.**
16. **Owner-only AI usage dashboard** in normal Betsy.
    - Covers every AI use, including the staff bot per business.
    - No reference to copy: design the best.

## 1. Facts from the code (file:line)

**Agents**
- Bindings are per channel (`soft-ai/agent-admin.ts:539`).
- The resolver tries the exact channel first, then `tenant_default` (`agent-resolver.ts:90-115`).
- The unlock is checked against ONE tenant-wide `config.fixtureSetHash` (`agent-config.ts:179`).
- A model change revokes the unlock (:185).
- Gate 10 downgrades to `suggested` (`agent-claim-gates.ts:300-309`).
- Activar also depends on the soft flag (`inbound-hook.ts:388`) and AI terms (`agent-claim-gates.ts:178`).

**Leaks and bugs**
- **Live bug:** `get_shipping_status` queries `ShippingGuia.orderId = order.id`, but every writer stores the order
  number (`llm/tool-runner.ts:341,377` vs `lib/bot/guia-service.ts:313`). "¿Dónde viene mi pedido?" never works.
- `findOwnedOrder` only finds orders by clientId or by an order number the customer typed (`tool-runner.ts:195-233`).
- Lookup by guiaNumber has no ownership check (`:~312-345`), so guía numbers can be enumerated.
- No `deletedAt` filter is applied.
- `server-deps.ts:14-62` (v1 / `api/chat/soft-ai/run`) has no ownership check at all.
- An empty inventory map exposes the whole catalog (`tool-runner.ts:99-101`).
- A `tenant_default` binding serves unbound channels.
- The daily budget is shared per tenant.
- IG ownership only matches the IG user id digits; `peerPhoneHints` is never filled (`tool-runner.ts:71`).
- The window gate returns true for non-WA channels (`chat-conversation-api.ts:162`), so IG sends after 24h fail at Meta.

**Forge hardcodes**
- `soft-ai/__fixtures__/forge-wa-v1|v2`
- `agent-types.ts:157,189`
- `types.ts:93-102`
- `shortcuts.ts:77`, `worker.ts:62`
- `probar-scenarios.ts`, `probar-test-cases.ts`, `shortcut-import.ts`

**Turn pipeline**
- Safety router: any media, payment proof or opt-out leads to a handoff plus `aiMode='human'`
  (`llm/safety-router.ts:53-89`, `agent-turn.ts:490,639`).
- The payment classifier over-matches. "¿cuánto hay que pagar?", "¿me confirma la talla?" and "¿ya les llegó?" all
  become `payment_proof_or_risk` (`payment-classifier.ts:9-44`).
- Audio content is stored as `'[audio]'` (`meta-chat.ts:96-98`). History reads `content` (`agent-turn.ts:104-123`).
- Limits: 2 model calls and 4 tools (`llm/model-policy.ts:11-12`). Timeouts 9s / 7s (`llm/client.ts:19-20`).
- No vision, no `json_schema`.
- `softAiResponsesCreate` has no tenant or feature context (`client.ts:71-82`).
- Agent send is WA only (`agent-turn.ts:149-179`). The unlock is WA only (`agent-unlock.ts:288`).
- There is no send path without an inbound trigger. Gates 7 (window) and 8 (budget) drop such messages silently
  (`agent-claim-gates.ts:284-293`).

**Orders**
- The only required-fields check is the client-side `validateOrderForm` (`app/ventas/components/orderFormValidation.ts:12-70`).
  - Always: name, phone.
  - EA: province, canton, district, address, courier.
  - Every line: type, qty>0, price>0, **seller**.
  - BusinessInfo `required`.
- ProductField `required` is not enforced anywhere.
- Totals are computed in `ProductList.tsx:84-97`.
- The shipping price is the flat `basePrice` of the chosen method (`ShippingMethodSelector.tsx:44`). No zone → method mapping exists.
- `createLifecycleOrder` (`lib/order-lifecycle.ts:359`):
  - Runs only when the lifecycle-v2 flag is on (`api/orders/route.ts:293`).
  - Items resolve by exact SKU/name (:197-213).
  - `syncInventory` throws INSUFFICIENT_STOCK (:228-234).
  - It is shared by /ventas, the website and the bot adapter.
- Website orders (`lib/integration-orders.ts:7-55`):
  - `customFields.paymentStatus` holds a raw string.
  - Status is "Pendiente". The phone is raw.
  - There is no channel field, only `salesChannel`.
  - `derivePaymentState` treats any Pendiente order with no payment status as pending (`order-payment-status.ts:75-102`).
- Phone matching: `chat-order-attach-server.ts:12` (last 8 digits). Works for "+506 8888-1111" vs 88881111.
- Linking is inline in `api/chat/conversations/[id]/orders/route.ts` (GET :61-199, POST :208-306).
- Marking paid: `api/orders/update/route.ts:86` + `paymentChoiceToOrderFields`.
- There is no paid/guía event.

**Contra entrega**
- `Order.contraEntrega`, `cePaymentConfirmed`, `lm_orders.is_contra_entrega`.
- No coverage-zone config exists.

**Guía**
- Production: `generateGuiasForOrders` (`lib/bot/guia-service.ts:91`; imports nothing from bot). It is EA-only and keyed by order number.
- It claims `correos-guia:${order.id}` (:250-262).
- It falls back to zip `10101` when the lookup fails (:232-238).
- It overwrites `lm_orders` with the correos carrier (:354-361). Calls take up to ~20s.
- Guía → chat: inline in `api/chat/send-guia/route.ts:96`, WA only.

**Templates**
- List: `api/chat/templates`.
- Send: `api/chat/send` `messageType:'template'`, **without components/variables** (:332-342).

**Notifications**
- `notifyUsers` (`workspace-notifications.ts:56`) filters recipients to tenant members (:47-55).
- It swallows errors (:89-93).
- **The kind is blocked by a DB CHECK (SQL 036:100).**

**Media**
- Inbound media is cached lazily (`chat-media.ts:265,344`).
- Sending images: WA only (`chat-send-media-core.ts:65`).
- `ChatAgentAsset` (029) has no writer.
- `InventoryItem` has no image. `category` is the group.

**AI call sites (exactly 5)**
- `soft-ai/llm/client.ts:133`
- `customer-paste-grok.ts:66`
- `lib/bot/ai-agent.ts:130` (`createXaiResponse`; no tenantId in scope)
- `lib/bot/whatsapp.ts:510` (Whisper; no duration in the reply)
- `app/api/bot/telegram/webhook/route.ts:294`

**Usage tracking and keys**
- Recorded today: `ChatAgentTurn` only.
- Owner gate: `isSuperAdmin`.
- Keys: the bot and the inbox Grok share `XAI_API_KEY`; Whisper uses `OPENAI_API_KEY`; inbox gpt uses `SOFT_AI_OPENAI_API_KEY`.

**SQL hygiene**
- Next free migration number: **048** (038/042 are skipped on purpose).
- New public tables:
  - `ENABLE ROW LEVEL SECURITY`, no policies (033 pattern)
  - a matching `schema.prisma` model (never pushed)
  - an `isTableReady` guard, because Rafael applies SQL separately from the deploy

## 2. Channel support

| Capability | WhatsApp | Instagram |
|---|---|---|
| Agent answers directly | F1 | F1 (new IG send in the agent pipeline, channel-agnostic Activar, real IG window gate) |
| Order ownership | phone tails + linked orders | **linked orders only**; a phone typed on IG never auto-links |
| Product photos | F5 | F5 (new IG image send) |
| Audio | F5 | F5 |
| Payment / COD / order | F6 | F6 |
| Guía to customer | F7 PDF | F7 PDF if IG accepts the file, else guía number + tracking link |
| After 24h | F7 approved templates with variables | **no automatic send**; alert staff, a human may reply with HUMAN_AGENT (7 days) |

## 3. Phases (order fixed: base → dashboard → creation → testing → selling → payment → guía)

### F1 — Clean base, AI meter, test engine
1. **Fix the live bugs.**
   - `get_shipping_status` uses `order.orderId`.
   - Order tools also see orders linked to this chat (`ChatMessage.orderId`).
   - Add `trackShipment` to the tool.
   - Ownership check on guía lookups.
   - `deletedAt` filtered everywhere.
   - Fix `server-deps.findOrder`.
2. **Isolation, fail closed.**
   - An empty map = no products.
   - **Per-agent order ownership:** stamp each order with values the agent owns (salesChannel/source/business label, configured per agent). Order tools and auto-link only see owned orders. In practice this keeps a Prototipo chat from ever touching a Forge order.
   - **`tenant_default`:** an explicit enable switch (column). Before deploy, run a read-only query listing the tenants that use it today. Rafael decides.
   - Per-agent daily budget.
3. **Test engine (minimal; F4 extends it).**
   - `json_schema` support in `llm/client.ts`.
   - **Generator:** builds a suite from the agent's data.
   - **Runner:** a background job with a cost cap.
   - **Grading:**
     - Money and safety cases by **fixed rules**: total = code total; never "pago confirmado"; no foreign products; handoff when required.
     - The rest by an **LLM judge with tolerance**. A failed judged case is re-run once.
     - Pass: 100% on fixed rules, ≥90% judged, 0 violations.
   - In F1 the "ya pagué" case expects a *handoff* (current behavior). F6 changes it to "holding message".
4. **Activar.**
   - Checks: the run is green, the soft flag is on, AI terms are accepted.
   - Writes, audited: agent live, channel enabled, unlock record.
   - **The gate checks agentId + model only.** The suite hash is kept for audit.
   - When data changes (e.g. the SINPE number): the agent keeps answering, and the UI shows "re-probar".
   - **When a gate fails (no suggest mode anymore):**
     - stay silent
     - mark the chat "IA no respondió: <reason in plain words>"
     - alert the assigned human
   - Existing `ai_suggest` agents and conversations are mapped in code, with no data rewrite.
   - WA + IG: IG send in the agent pipeline, and the IG window enforced correctly.
   - Remove suggest from the UI. Keep the kill switch and the per-chat "Pausar IA".
5. **Production guía, shared.**
   - Copy `lib/bot/guia-service.ts` → `lib/shipping/guia-service.ts`, **keeping the claim key `correos-guia:${order.id}` and the adapter constant identical**, so the bot copy and the new copy never register two guías.
   - Point `api/shipping/generate-guia` + `api/integration/guia/generate` at the copy.
   - Add an option `requireResolvedPostalCode` (no 10101 fallback) for automatic use.
   - Extract `lib/shipping/send-guia-to-chat.ts`.
6. **Order requirements.**
   - `lib/orders/order-requirements.ts`:
     - `validateOrderForm`, now also enforcing ProductField `required`
     - `loadOrderRequirements(tenantId)`
     - `missingOrderFields`
   - Shared `computeOrderTotals`, extracted from `ProductList.tsx`.
   - **Per-agent order defaults:** seller name, default shipping method, owned salesChannel/source stamp.
   - Check that DeepSleep has lifecycle-v2 on (read-only). F6 refuses to run without it.
7. **AI meter.**
   - `ai_usage_event`, with these fields:
     - tenantId (nullable), feature, provider, model, keyLabel
     - agentId, conversationId, userId
     - tokens in/cached/out/reasoning, audioSeconds
     - costMicros, pricingVersion, latencyMs, status/errorCode
     - **sourceKey (unique)**
   - **Required usage context** (`{tenantId, feature, agentId?, conversationId?}`) on `softAiResponsesCreate`. Failed calls are recorded too.
   - `customer-paste-grok.ts` records its usage.
   - **Staff bot (approved):**
     - an AsyncLocalStorage tenant context at its 2 entry points (Telegram webhook, WA bot handler)
     - one `recordAiUsage` call in `createXaiResponse`
     - one after each Whisper call, with audio seconds estimated from file size
   - `recordAiUsage` is fire-and-forget and never throws.
   - Versioned rate card for every model, plus Whisper per minute and template sends.
   - Boundary test: only these lines and the one `lib/ai-usage` import may differ in `lib/bot/**` and `api/bot/**`.
8. **Quarantine the v1 write stubs.** Hard-refuse them; don't delete.
9. **SQL:**
   - 048 `ai_usage_event`
   - 049 per-agent daily cap + order defaults/ownership + tenant_default switch
   - 050 the agent test run table

**Done when:**
- Prototipo's channel has its own agent, passes its suite, is activated with one click, and answers WA directly.
- It cannot see Forge's products or orders.
- "¿Dónde viene mi pedido?" works.
- Every AI call is recorded.

### F2 — AI usage dashboard (owner only)
- **Access:** `/super-admin/ia` behind `isSuperAdmin` (404 otherwise), linked from the super-admin nav and from `/logistics/admin`. Replaces the inbox-only part of `/super-admin/agentes`.
- **Header:** spend today / 7d / 30d / month-to-date, projected month end, calls, error %, p50/p95 latency.
- **Over time:** cost and calls per day, stacked by feature or by model.
- **By tenant:** cost, calls, conversations, sales closed by AI, cost per conversation, cost per sale.
- **By model:** tokens in/out/cached, cost, latency, errors.
- **By feature:** inbox agent, Probar/tests, creation/import, vision, transcription, customer paste, staff bot text, staff bot voice, templates.
- **By agent/channel** inside each tenant.
- **Top expensive conversations:** ids only, masked.
- **Errors/timeouts list.**
- **Budgets and alerts:**
  - Monthly budget per tenant and a global one.
  - Alerts at 80% and 100% are **platform-level** (Rafael's bell and email, not filtered to tenant membership).
  - Optional auto-pause at 100%: the tenant's chats go to human, and both the tenant and Rafael are alerted. Customers are never left without notice.
- **Reconciliation:** provider totals vs recorded totals, via the OpenAI usage API (needs an admin key, Rafael's call) and xAI if available.
- **Backfill:** from `ChatAgentTurn`, **only up to the meter cutover**, using a unique `sourceKey`. Idempotent script; Rafael runs it.
- **Filters:** date, tenant, model, feature. **CSV export.**
- **SQL:** 051 budgets + alert dedupe.

### F3 — Create an agent from sources (Agent Studio)
- **Flow:** `Fuentes → Revisar → Probar → Activar`. The old tabs become "Ajustes avanzados".
- **Sources:**
  - text
  - website URL (same host, ≤20 pages)
  - PDF/DOCX/TXT (≤10MB, magic bytes, page cap, **parser time and size limits for zip bombs**)
  - images (product photos, price lists)
  - Instagram of the bound channel (bio + captions; `instagram_basic` is already in the OAuth scopes)
  - WhatsApp chat export, later
  - **Storage:** private Supabase Storage, `agent-sources/<tenant>/<agent>/…`.
- **First task: verify vision.** Make a live test call to grok-4.7. If it fails, use an allowlisted vision model for extraction only.
- **Extraction:** produces an **Agent Profile draft**. Each fact keeps its source.
  - brand facts, including **structured payment accounts** (SINPE number/holder, IBAN/holder) per agent
  - policies, FAQ, voice
  - **"Cómo vendo"**: closing, upsells, objections, when to hand off
  - must-say / never-say lines
  - quick replies
  - products matched to items (variant = item, group = category)
  - photos per item or group
  - **contra-entrega coverage per shipping method**
- **Revisar:**
  - A green/red readiness checklist.
  - Approve all, or edit.
  - Only missing items are asked.
  - Approved items write to the existing stores.
- **This phase also creates:**
  - `ChatAgentAsset.inventoryCategory`
  - **shipping-method coverage zones**: per shipping method (tenant config), provincia/cantón/distrito, with a "todo el GAM" preset. Each agent picks which methods it offers.
- **Security:**
  - The SSRF-safe fetcher handles **IPv4 and IPv6 private ranges** and **pins the resolved IP** (DNS rebinding).
  - Redirects ≤3, re-checked each hop.
  - 10s timeout, 2MB cap, HTML/text only, no cookies.
  - Imported text is data; prices only come from inventory; injection cases go into the suite.
  - SecureDog review.
- **New dependencies** (PDF, DOCX, HTML-to-text parsers) are allowed; list them in the PR.
- **SQL:**
  - 052 `agent_source` + profile draft with fact provenance
  - 053 `ChatAgentAsset.inventoryCategory` + coverage zones + structured payment accounts

### F4 — Probar 2.0 (test harness)
- **Virtual test channel:**
  - No WA/IG line needed.
  - Never sends to Meta.
  - `ChatConversation.isTest`, with an index.
  - Excluded from stats; counted in the dashboard as `probar`.
  - The purge only deletes `isTest` rows on the virtual channel.
- **Simulator:** text, photo, document, multi-turn, reset, "continue as customer". **F5 and F6 each add their own simulators** (voice note, receipt, "simulate: human verifies payment") as part of their done-when.
- **Trace panel:** stage, cart, data collected/missing, tools, knowledge used, time per step, cost per turn. Plain words.
- **Fix in one click:** fact / quick reply / rule / "cómo vendo" line → re-run that turn → saved as a test case.
- **Suite runner UI:** on top of the F1 engine. Scorecard. Feeds Activar.
- **Dry runs only:** no orders, stock, guías or templates.
- **SQL:** 054 `isTest` + index.

### F5 — Selling: memory, quote, variants, photos, audio, speed
- **Sales session per conversation:**
  - **`version` column with optimistic updates**, because two messages can arrive at once.
  - Holds: stage, cart lines (item = variant, **SKU always passed**, qty, options), customer fields keyed by the tenant's requirement keys, delivery EA/RA/COD, address + resolved postal code, quote + provenance, linked order id, payment state.
- **Tools** (pure code, scoped to tenant, agent and owned orders):
  - `get_order_requirements`
  - `update_order_draft` (returns the missing fields)
  - `build_quote` — `computeOrderTotals`, and **the shipping method is chosen in code from coverage zones, or the customer is asked. The LLM never picks the price.**
  - `validate_address` (Correos geo + postal code)
  - `check_cod_coverage`
  - `send_product_photo`
  - `find_customer_orders`
- **Variants:** "talla XL" → the right item in the group. Stock is checked per item. Out of stock → offer the variants in stock.
- **Photos:** upload in `InventoryManagement.tsx` per item or group. The agent sends them on WA and IG (new IG image send).
- **Audio:**
  - **Transcribed in the job before routing.**
  - The transcript is saved on the message, and history and the session use it.
  - Inbox key, metered.
  - Capped by size and duration.
  - The transcript is shown under the audio in /chats.
- **Customer images:**
  - Treated as a receipt when the session is waiting for payment or the caption has a proof cue.
  - Otherwise vision describes it ("¿tienen este?").
  - Without vision: a polite handoff.
  - Any image after a quote is treated as a possible receipt.
- **Speed:**
  - The catalog stays out of the prompt (tools).
  - The static prompt goes first, so the prompt cache applies.
  - Parallel tool calls in one model call.
  - Sales turns allow ≤3 model calls, ≤8 tools, and a ~15s total budget.
  - Target p50 under 6s. Every step is timed and shown in the trace and the dashboard.
- **Validation and PII:**
  - The output validator only accepts amounts from `build_quote`.
  - PII is retained via `agent-retention.ts`.
  - No PII in traces.
- **SecureDog review.**
- **SQL:** 055 `chat_sales_session` (unique conversationId, version) + message transcript field.

### F6 — Payment, contra entrega and website orders → human → order
1. **Payment classifier split into three:**
   - **proof** → the review flow
   - **risk** → a human
   - **ambiguous** → the model answers under the no-confirm rule
   - "¿cuánto hay que pagar?" etc. no longer trigger reviews.
2. **Proof detected:**
   - The holding message is built in code.
   - The chat stays `ai_active`, with `paymentState='verifying'`.
   - **One open `payment_review` per conversation** (partial unique index). Later cues attach to the open review instead of creating new ones.
   - The review lives 7 days. Pago verificado still works after expiry, after a re-check.
   - The agent keeps answering, but never says the payment is confirmed.
3. **Website order matching (`find_customer_orders`):**
   - **Auto-link only when ALL hold:**
     - same tenant
     - an order **owned by this agent**
     - phone tail match on ≥8 digits (WA only)
     - payment **explicitly** pending
     - ≤14 days old
     - not deleted
     - not linked to another chat
     - no active cart in the session
   - The link is audited.
   - **Otherwise** the card asks the human to choose, link or ignore. A receipt with no session and no match → "link or ignore".
   - Never creates a duplicate.
4. **Alert:**
   - SQL extends the notification-kind CHECK (036) with `payment_review` and `order_review`.
   - Bell icon + chime.
   - Recipients: the assignee, or members with chat permission.
   - Resend email: **a link + the order number only** (no receipt, no address).
   - "Pagos por confirmar" filter in /chats.
5. **Review card:**
   - Shows: receipt image, expected total, the agent's payment account, order summary.
   - Warnings (never blocking): different amount, no stock, missing fields.
   - **Pago verificado:**
     - **Atomic claim:** `updateMany where status='pending'` → `executing`. If count = 0, stop.
     - Idempotency keys: `payment_review:<actionId>` for the order creation or the mark-paid, for the link, and for the customer message.
     - Re-check at click time that the order is still unpaid and the phone still matches.
     - If the hash changed, refresh the card instead of failing.
     - **Existing order** → `paymentChoiceToOrderFields('pagado')`.
     - **New order** → `createLifecycleOrder` as paid, with a **new opt-in `allowNegativeStock` parameter (default off; only this path uses it)**. Stock goes negative, and the order is flagged "ingresado sin stock" + audited.
     - Then the link and the audit log.
     - Requires lifecycle-v2 to be on.
   - **Rechazar / Pedir otra foto:** a polite code-built message; the session stays open.
6. **Customer confirmation:**
   - Built in code.
   - Goes through a **system send** keyed `payment_confirmed:<actionId>`, which skips the budget gate.
   - If the WA window is closed, it uses the F7 template. Before F7 exists, it is queued and staff are alerted.
   - Instagram after 24h: staff are alerted.
7. **Contra entrega:**
   - Offered only if `check_cod_coverage` passes for the chosen method.
   - Collects the required fields → **`order_review`** pending action → a human clicks **Confirmar pedido** → order with `contraEntrega=true` → logistics as today → confirmation by system send.
8. **RA (pickup):** same flow as payment or COD, depending on the payment choice. Pickup instructions come from the agent's data.
9. **Housekeeping:**
   - Pending actions expire, and their arguments are purged after execution.
   - Marking a website order paid does NOT notify the external store (noted; out of scope).
10. **SecureDog review.**
11. **SQL:** 056 the `ChatAgentPendingAction` index (tenantId, kind, status) + partial unique on open + `paymentState` + the notification CHECK extension.

**Done when:** the payment flow works end to end, with a manual guía still allowed. The automatic guía is in F7.

### F7 — Guía, templates, follow-ups, learning, per-agent numbers
- **Automatic guía:**
  - Conditions: after verification/confirmation, **Correos method, not COD, resolved postal code**, agent switch on.
  - **Runs as a background job** (calls take ~20s): `lib/shipping/guia-service.ts` → `send-guia-to-chat` (WA PDF; IG file or number + link).
  - Missing postal code or failure → alert staff + retry card.
- **Smart templates:**
  - Template **variables** in the inbox send. Values are cleaned (no newlines or tabs, length capped).
  - Per-agent mapping: event → approved template + variables (order number, name, guía, tracking link, total).
  - Events: payment confirmed, COD order confirmed, guía sent, payment reminder, "¿te llegó?".
  - Used automatically when the WA window is closed.
  - A "check templates" screen flags the missing ones. Rafael submits them in Meta.
  - Template sends count in the dashboard.
- **Follow-ups** (timed job kinds, extending the 026 CHECK):
  - quote not paid
  - payment confirmed
  - guía sent
  - "¿te llegó?" after the ETA
  - optional review request
  - Each has a per-agent switch and delay. Opt-out respected.
- **Teach the agent from real chats:**
  - "Enseñar al agente" on any message in /chats → proposes a fact / quick reply / rule / "cómo vendo" line → approve → added + saved as a test case.
  - When the AI resumes after a human, it sees what the human said.
- **Per-agent numbers card** (in the agent screen): chats handled, quotes, orders, conversion %, % handed to humans, median response time, median payment-confirmation time, AI cost per chat and per sale.
- **SecureDog review** (templates).
- **SQL:** 057 event→template mapping + follow-up job kinds.

## 4. Process per phase
- **Branches:** one per phase, each off the previous one, starting from `claudio/chat-link-orders`:
  `claudio/agent-f1-base`, `-f2-ai-usage`, `-f3-studio`, `-f4-probar`, `-f5-selling`, `-f6-payment`, `-f7-guia`.
- **Draft PRs only.** Never merge to `dev`.
- **Loop per phase:**
  1. advisor
  2. implement
  3. `npx tsc --noEmit`, `npm run lint`
  4. the relevant `test:*` suites (soft-ai, soft-ai-agent, chat-automation, agentes-ui, config-ui, lifecycle, security, chat-harden) plus new tests per feature
  5. verifier
  6. securedog on F1, F3, F5, F6, F7
  7. `docker build -f Dockerfile .`
  8. browser proof (verify-betsy scripts) + screenshots
  9. update `docs/audits/CHANGELOG_AGENTS.md` and the Notion Security Register
- **SQL:** additive only, numbered from 048, RLS on, `isTableReady` guards. Rafael applies SQL and deploys. Never `prisma db push`.
- **Preview writes to the prod DB:** auto-link, orders and alerts tested there are real. Use the virtual channel and dry runs.
- **Testing and reports:** Rafael tests each phase on the DeepSleep channels. Reports are short and visual.
