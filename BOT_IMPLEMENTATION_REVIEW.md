# Betsy WhatsApp / Telegram Bot — Implementation Review

> Scope: full technical walk-through of the WhatsApp (and Telegram-shared) AI bot
> stack, the order-submission pipeline, the issues we are seeing, and a focused
> refactor plan. **No code changes are made in this document — it is a planning
> artifact.**

---

## 1. High-level architecture

The bot lives entirely under `@/lib/bot` and is invoked by two webhook routes:

- **WhatsApp webhook** — `@/src/app/api/bot/whatsapp/webhook/route.ts`
- **Telegram webhook** — `@/src/app/api/bot/telegram/webhook/route.ts`

Both webhooks share the same downstream pipeline:

```
Meta / Telegram ──► webhook route
                     │  (rate limit, dedup, signature check, voice transcription,
                     │   /start /help /clear /new /status command handling,
                     │   session lookup, awaiting-name / awaiting-code state)
                     ▼
              processMessage()                     ◄─── Redis (Upstash)
              @/src/lib/bot/ai-agent.ts                 conversation history
                     │                                  pending confirmations
                     │                                  ephemeral state
                     ▼
            ┌───── tool calls ─────┐
            ▼                      ▼
    @/src/lib/bot/ai-tools.ts   xAI Grok (OpenAI-compatible)
            │
            ▼
    Tenant Prisma client (@/src/lib/prisma-tenant.ts)
    Custom fields service (@/src/lib/customFields.ts)
    Location validator (@/src/lib/locationValidator.ts)
    Correos guía service (@/src/lib/bot/guia-service.ts)
```

### 1.1 Files and responsibilities

| File | Responsibility |
|------|----------------|
| `@/src/lib/bot/index.ts` | Barrel exports for the module. |
| `@/src/lib/bot/whatsapp.ts` | Meta Cloud API client: `sendWhatsAppMessage`, `sendWhatsAppDocument`, `parseWhatsAppWebhook`, voice transcription via Whisper, button/list helpers, plus `formatOrderForWhatsApp / formatInventoryForWhatsApp / formatStatsForWhatsApp`. |
| `@/src/lib/bot/telegram.ts` | Same surface but for Telegram (HTML formatting, deep-link generation). |
| `@/src/lib/bot/bot-session.ts` | `BotSession` upsert/lookup. Wipes conversation history on tenant switch. JWT generation for connection magic links. |
| `@/src/lib/bot/access-code.ts` | 12-char alphanumeric tenant access code generation/validation. |
| `@/src/lib/bot/conversation-memory.ts` | Upstash Redis (with in-memory fallback) for: conversation history (25 messages, 7d TTL), `pendingConfirmation` (2 min TTL), `conversationState` (10 min TTL, used for awaiting-name / awaiting-code). |
| `@/src/lib/bot/ai-agent.ts` | The brain. Contains `processMessage`, the long Spanish system prompt, the structured fast-path parser, the create-order final-review state machine, and the tool result formatters. **2,351 lines. This is the main source of the problems.** |
| `@/src/lib/bot/ai-tools.ts` | Tool schemas (Zod) + executors. `createOrder` is here, including inventory matching, location validation, custom-fields validation, duplicate-window check, transactional persistence, and the stock decrement. **2,306 lines.** |
| `@/src/lib/bot/guia-service.ts` | Correos de Costa Rica guía generation, PDF persistence, `lm_orders` upsert. |
| `@/src/lib/customFields.ts` | Tenant custom fields service: fetch product + business-info fields, build dynamic Zod schema, extract/validate/format values for display. |
| `@/src/app/api/bot/whatsapp/webhook/route.ts` | HMAC verification, dedup, per-chat lock, command handling, `processMessage` dispatch, response splitting, attachment delivery. |

### 1.2 Model and runtime configuration

```ts
// ai-agent.ts:51-82
const MODEL = process.env.XAI_MODEL || 'grok-4.3';
const MAX_TOKENS = Number(process.env.XAI_MAX_TOKENS || 2000);
const TEMPERATURE = 0.1; // intentional — deterministic tool calls
const REASONING_EFFORT = 'medium';
```

Conversation history is capped at the **last 20 messages** sent to the LLM
(`messages.slice(-20)` at `ai-agent.ts:1719`), out of 25 stored.

---

## 2. Per-message lifecycle

This is what happens for **every** inbound WhatsApp text:

1. **Webhook (`POST /api/bot/whatsapp/webhook`)**
   - Verify Meta HMAC signature with `META_APP_SECRET`.
   - Parse payload via `parseWhatsAppWebhook`.
   - Skip duplicates (message-ID set, 5 min window).
   - Per-phone lock so concurrent messages from the same user are serialized.
   - Mark message as read.
   - Rate limit: 30 msg/min per phone.
   - Voice → Whisper transcription if `type === 'voice' | 'audio'`.
   - Length cap: 4,000 chars.
   - `/start`, `/help`, `/clear`, `/new`, `/status` short-circuit before AI.
   - Read `conversationState`: if `awaitingName` or `awaitingCode`, run setup branch.
   - `findBotSession` → if none, send unauthorized prompt and `awaitingCode = true`.
   - Otherwise → `processMessage('whatsapp', phoneNumber, text, ctx)`.

2. **`processMessage` (`ai-agent.ts:1522`)**
   - **Peek pending confirmation.** Three pending types:
     - `order_repair` — user is fixing missing fields from a previous attempt.
     - `order_final_confirm` — final review awaiting yes/no/correction.
     - `inventory_confirm` — product not in inventory or zero stock; user must confirm.
   - Pending handlers branch on `isConfirmation` / `isDenial` / `isExplicitRejection`,
     and on whether the new message looks like a *brand-new order* via
     `buildStructuredOrderArgs` + `hasOrderCreationIntent`.
   - **No pending + bare yes/no** → safe stop, tells the user the review expired.
   - **Structured fast-path** (`buildStructuredOrderArgs`) — if the message
     matches the templated order signal (`Producto:`, `Total:`, `nombre completo`,
     etc.), the bot skips the LLM entirely and goes straight to the final review.
     This branch was added to prevent the LLM from leaking data across orders.
   - **Otherwise** → push user message to history, build system prompt with
     date/time/tenant/custom-fields, call xAI with `tool_choice: 'required'`
     when `isActionRequest(userMessage)` matches a hard-coded keyword list.
   - Handle tool calls: merge multiple `create_order` calls for the same identity
     (`mergeCreateOrderCalls`), evict the user message from history, and request
     the final review.
   - Run the second LLM call (no tools) to produce the natural-language reply
     when no mutating tools were used.

3. **Response delivery**
   - `sendLongWhatsAppMessage` splits on `\n\n` if the text is over 4,000 chars.
   - Each `ToolAttachment` (PDF) is uploaded to Meta Media API and sent as a
     document message (`sendWhatsAppDocument`).

---

## 3. The order-submission flow (the most important one)

This is the flow the user explicitly asked about. There are **four entry paths**
into `create_order` and they all converge on the same final-review gate.

### 3.1 Entry paths

**Path A — Structured fast-path (preferred).**
The user pastes a templated message such as:

```
Deseo crear una nueva orden
Nombre: Juan Pérez
Teléfono: 8888-8888
Producto: ENERGY PATCH X1
Cantidad: 2
Total: 25000
Tipo de orden: EA
Provincia: San José
Cantón: Desamparados
Distrito: San Antonio
Dirección: 200m sur del parque
Método de pago: SINPE Móvil
```

`buildStructuredOrderArgs` (`ai-agent.ts:1063`) regex-extracts the fields,
including custom fields via `extractCustomFieldsFromMessage`. The agent
**bypasses the LLM** and calls `requestCreateOrderFinalConfirmation` directly.

**Path B — Free-form LLM path.**
The user writes naturally ("hazme una orden para Juan, 2 patches, 25k, envío
a San José"). The LLM is invoked with `tool_choice: 'required'` (because
`isActionRequest` triggered) and emits a `create_order` tool call. Before
execution, the call is intercepted at `ai-agent.ts:1797-1846` and routed to the
**same** final-review gate.

**Path C — Repair after missing fields.**
A previous `create_order` returned an error like `Producto es requerido` or
`Campos personalizados faltantes:`. The agent stored a `pending` of type
`order_repair` and merges the new message into the previous args via
`inferCreateOrderArgsFromMessage`.

**Path D — Inventory confirmation.**
`createOrder` returned `needsConfirmation` with `confirmationType` of
`no_match` / `zero_stock` / `multiple_matches`. The agent stored a `pending`
of type `inventory_confirm` carrying `_forceWithoutInventory: true` and
`_finalReviewConfirmed: true` so the next turn skips both gates.

### 3.2 The final-review gate (`requestCreateOrderFinalConfirmation`)

`ai-agent.ts:629-710`. This function:

1. Loads tenant custom fields.
2. If the merged tool call had **divergent totals** (`_totalsMismatch`), asks
   the user which is correct and stores `order_repair`.
3. Computes missing required fields via `getCreateOrderReviewMissingFields`
   plus `validateCustomFields` and lists them. Stores `order_repair`.
4. Otherwise stores `order_final_confirm` with the full args and renders the
   text from `buildCreateOrderFinalReview`.

**Current review output** (`buildCreateOrderFinalReview`, `ai-agent.ts:562-627`):

```
Revision final antes de crear la orden.

Estos son los datos que se enviaran a Betsy:
Cliente: Juan Pérez
Telefono: 88888888
Producto(s):
- ENERGY PATCH X1 x2
Cantidad total: 2
Total: CRC 25,000
Tipo de orden: EA
Metodo de pago: SINPE Móvil
Metodo de envio: -
Provincia: San José
Canton: Desamparados
Distrito: San Antonio
Direccion: 200m sur del parque

Campos adicionales:
Negocio: WAS
Usuario: Marlenn

Responde SI para crear la orden, NO para cancelarla, o envia la correccion exacta.
```

**Why this looks robotic:**
- All accents intentionally stripped.
- All bold/markdown asterisks intentionally stripped.
- No emojis, no section dividers, no spacing rhythm.
- The `formatCustomFieldsForTelegram` lines are stripped of asterisks for the
  "plain" review even though the chat target supports formatting.
- The closing line is a literal command string with no warmth.

### 3.3 What `create_order` actually does (`ai-tools.ts:827-1289`)

Once the user replies "sí", `executePendingAction` calls `executeTool('create_order', ...)`.
Inside `createOrder`:

1. `checkOrderLimit` — plan enforcement.
2. `validateBaseOrderFields` — customerName, products, total, orderType,
   address fields for EA, phone format, email format.
3. `validateLocation` — Costa Rica province/cantón/distrito hierarchy
   (with fuzzy correction). Corrections recorded in `locationCorrections`.
4. `getTenantCustomFields` + `extractCustomFields` + `validateCustomFields` —
   required custom fields are enforced here.
5. **Inventory matching** — `findInventoryMatchesForRequestedProduct` per
   product line. Returns one of:
   - `no_match` → `needsConfirmation` (`Deseas registrar de todas maneras?`).
   - `multiple_matches` → `needsConfirmation` with up to top-3 options.
   - `zero_stock` / insufficient stock → `needsConfirmation`.
   - exact unique match → continue.
6. **Comments composition** — payment method + free comments + every
   custom field whose key/label looks like *comentario* / *observación* /
   *nota* (`COMMENT_FIELD_KEYWORDS`) is concatenated into `comments`. This is
   how the order gets a payment method, since the schema has no
   `paymentMethod` column.
7. **`productDetails` JSON** — built per line: `{ type, cantidad, color, tamano, inventoryItemId?, inventoryItemSku? }`.
8. **Known-field hoisting** — `packaging`, `customization`, `shippingCost`,
   `courier` are pulled out of `customFields` and promoted to the order's
   top-level columns (then deleted from `customFields`).
9. **Duplicate window check** — `findRecentDuplicateBotOrder` (5 min, same
   phone/orderType/total/address/product fingerprint). If duplicate, the bot
   returns success silently with the existing order id.
10. **Prisma transaction**:
    - `tx.order.create`.
    - Persistence verification re-read.
    - `syncClientFromOrder` — upserts the client row, increments `totalOrders`
      and `totalSpent`.
    - `tx.inventoryItem.updateMany` per matched product, with optimistic
      stock check (`currentStock: { gte: matchedQuantity }`). Throws
      `INVENTORY_STOCK_CHANGED:<name>` if the count is not 1.
11. Build the success message with location corrections, custom-field lines,
    and inventory deltas. The message lives in `result.message`.
12. The agent calls `addAssistantMessage` with a **sanitized** version
    (`sanitizeOrderSuccessForHistory`) — only the order id and a generic
    success line — to prevent the LLM from copying customer data into a
    later "new order" turn.

### 3.4 State machine summary

```
            ┌──────────────────────────┐
            │  no pending, fresh msg   │
            └──────────────┬───────────┘
                           │ has order template?
                  yes      │      no
            ┌──────────────┘──────────────┐
            ▼                             ▼
buildStructuredOrderArgs            xAI tool_choice=required
     │                                    │
     │   ┌───── tool emits create_order ──┘
     ▼   ▼
 requestCreateOrderFinalConfirmation
            │
   missing fields?       totals mismatch?       ok?
       │                      │                  │
       ▼                      ▼                  ▼
  pending=order_repair  pending=order_repair  pending=order_final_confirm
       │                      │                  │
       └──── repair msg ──────┘                  │
                                                 ▼
                              user yes ──► executeTool(create_order)
                                                 │
                              inventory issue ──► pending=inventory_confirm
                                                 │
                              user yes ──► executeTool with _forceWithoutInventory
                                                 ▼
                                       order persisted, history sanitized
```

---

## 4. Custom-fields handling

Three layers:

1. **Schema injection (`updateToolSchemasWithCustomFields`)** — On every
   message, `ai-agent.ts:1705` calls this to fetch tenant fields and rebuild
   the `create_order` and `update_order` Zod schemas. Each custom field
   becomes a top-level optional parameter on `create_order`.
2. **System-prompt injection (`getCustomFieldsSection`)** — `ai-agent.ts:1375`
   appends a Spanish list of every field, its key, required/optional, type,
   and (for `select`/`multiselect`) the allowed option values. Required
   fields are prefixed with `(REQUERIDO)`.
3. **Free-form extraction (`extractCustomFieldsFromMessage`)** — Used **only
   in the structured fast-path**. For every configured field it tries an
   exact label/key match first, then a forgiving `includes` match.
   `customFields` are stored under `args.customFields[key]` (not at top level)
   so the validator can find them.

`extractCustomFields` (in `customFields.ts`) is the canonical extractor used
by `createOrder`. It looks in this order:
1. `data.customFields[fieldKey]`
2. `data[fieldKey]` (top level)
3. `data.productDetails.customFields[fieldKey]` (legacy)

`validateCustomFields` enforces required fields and produces Spanish error
messages such as `El campo "Negocio" es requerido`.

`formatCustomFieldsForTelegram` produces lines like `Negocio: ACME` (no
markdown). The bot strips asterisks again for the final-review screen.

---

## 5. Conversation memory and security

- **History (`MAX_MESSAGES = 25`)** — Redis list, keyed by
  `betsy:conversation:<platform>:<platformId>`. 7-day TTL. The LLM only sees
  the last 20.
- **Pending confirmation** — `betsy:pending:<platform>:<platformId>`, 2-minute
  TTL, used for `order_repair`, `order_final_confirm`, `inventory_confirm`,
  and any other `setPendingConfirmation` callers.
- **Conversation state** — `betsy:state:<platform>:<platformId>`, 10-minute
  TTL, used for `awaitingName` / `awaitingCode` setup flow.
- **Tenant isolation** — `BotSession.tenantId` is the only thing that scopes
  data. `createBotSession` clears history + pending if the tenant changes.
- **HMAC** — `META_APP_SECRET` SHA-256 verified on every webhook in production.
- **JWT magic links** — `BOT_JWT_SECRET` (or `NEXTAUTH_SECRET`) signs
  15-minute connection tokens.

The "evict the user message after structured fast-path" trick
(`removeLastUserMessage`, `ai-agent.ts:1806`) is critical: it prevents a stale
order template from leaking into the next LLM turn if the 2-minute pending
review expires.

`sanitizeOrderSuccessForHistory` is the second half of that defense — only the
order id survives in the LLM-visible transcript.

---

## 6. Issues found (concrete bugs and design problems)

### 6.1 Tone / "soul"

- The system prompt explicitly enforces a clinical tone:
  `"Sé concisa"`, `"Evita jerga o bromas"`, `"tono cordial pero no
  excesivamente casual"`, `"Usa emojis con moderación"`. Combined with
  ASCII-only fixed strings (`Revision final antes de crear la orden.`),
  the bot reads as a script.
- There is no separate persona / voice file. Every prompt change requires
  editing `ai-agent.ts:1248-1370`.
- Many guardrails are written as **NEVER/PROHIBIDO** rules
  (`PROHIBIDO REUTILIZAR DATOS`, `REGLA ABSOLUTA`, `CRÍTICO`). This is a
  symptom of patching prior bugs in the prompt rather than the code.
  The result is a prompt that the model reads as "a list of don'ts", which
  also dampens warmth.

### 6.2 Final-review formatting

- `buildCreateOrderFinalReview` strips accents and markdown
  (`ai-agent.ts:562-627`). The output is plain ASCII:
  `Revision final antes de crear la orden.` — no `é`, no bold, no emojis.
- The custom-fields section is rendered through
  `formatCustomFieldsForTelegram` then has `*` regex-stripped, even when
  the platform is WhatsApp (which **uses** `*bold*`). Formatting capability
  is wasted.
- Layout is a single flat list with no rhythm: no header, no money block,
  no "destination" block. It does not feel like a confirmation card.
- The closing instruction is a robotic command:
  `Responde SI para crear la orden, NO para cancelarla, o envia la correccion exacta.`
- It does not display:
  - Pre-flight inventory match preview (the user finds out about
    `multiple_matches` only after confirming).
  - Sub-total math (price per line × quantity vs declared total).
  - Whether `contraEntrega` is on (only added if true).

### 6.3 No "give me a template" feature

- There is **no tool, no command, and no system-prompt rule** that tells the
  bot to produce a fillable template when the user asks `dame el formato` /
  `plantilla` / `qué necesitas para una orden`.
- The model sometimes improvises a template, but it is not deterministic and
  it does not include the tenant's custom fields by default.
- There is also no `/template` or `/plantilla` slash command on the webhook.

### 6.4 Custom fields scaling problems

- For tenants with many fields, the **system prompt grows linearly**
  (`getCustomFieldsSection`). Each field contributes a line. With 20+ fields,
  the prompt is dominated by them and the model loses focus.
- The same fields are also added as **top-level params on `create_order`**
  via `createOrderSchemaWithCustomFields`. The Zod schema becomes huge and
  Grok fills wrong slots (e.g. it sometimes places a value under a wrong
  field key when labels are similar).
- `extractCustomFieldsFromMessage` only runs in the **structured fast-path**.
  In the free-form LLM path, custom fields rely entirely on the model
  filling the schema correctly. There is no second-pass extractor that
  reads the user's last message and back-fills missing custom fields the
  model dropped.
- `extractCustomFields` (in `customFields.ts`) checks `data[fieldKey]` at
  the top level **after** `data.customFields[fieldKey]`. When the model
  put a field at the top level (it often does, because the schema exposes
  it that way), it works. When the model nested it under `customFields`,
  it also works. But when the model used a slightly different key (e.g.
  `negocio` vs `Negocio`), nothing matches and the order is rejected as
  *Campos personalizados faltantes*.
- Required-custom-fields validation produces a **dead-end error** with no
  template to fill. The user has to remember every field name from a Spanish
  bullet list embedded in a previous error message.
- `getCustomFieldsSchema` always treats `select` options as `z.enum(...)`.
  When the value typed by the user doesn't exactly match a configured
  option (case, accents, hyphens), Zod rejects the whole call and the user
  sees `Parametros invalidos: <field>: Invalid enum value`.
- Tenant custom fields are loaded **twice per turn** today
  (`getTenantCustomFields` runs once for the structured fast-path and once
  again inside `processMessage` for the schema build, plus a third time
  inside `createOrder` itself).

### 6.5 Architectural / robustness

- `ai-agent.ts` is 2,351 lines. It mixes prompt, parsing, regexes, state
  machine, and formatters. Testing in isolation is hard.
- The **structured fast-path regexes** are fragile. Examples:
  - Phone parser only accepts the Costa Rica 8-digit pattern; it rejects
    `+506 8888 8888` because of the extra space.
  - `extractTotalFromMessage` accepts `total: 25.000,00` but not
    `total ¢25 000` (the space inside the number trips both branches).
  - `splitMultiLabelLines` works for known labels only — typos like
    `direcion` (one `c`) silently drop the address.
- `ACTION_KEYWORDS` is keyword bag-of-words. `tool_choice: 'required'` is
  forced when **any** keyword appears, even inside an unrelated question
  (`"crear" un cliente nuevo` would force a tool call when no order is
  intended).
- Pending-confirmation TTL = **120 seconds**. Real users on phones routinely
  take longer than that. They retype the order and get the "review expired"
  message — frustrating UX.
- `mergeCreateOrderCalls` merges by an "identity" string composed of name
  + phone + address + orderType. If the model emits the same order twice
  with one slightly different field, both are kept and the bot then runs
  the "Detecté N pedidos diferentes" branch.
- The system prompt instructs the model to use `**bold**` for important data,
  but `formatToolResult` calls `formatOrderForWhatsApp` which already uses
  WhatsApp `*single*` asterisks. The model output and the formatter outputs
  collide (`****Cliente****` rendered).
- `formatToolError` re-formats Zod errors but loses the original user
  message context, so a Zod failure on `updates.total` reads as
  `Faltan o son inválidos algunos datos: - updates.total: Expected number`
  even though the user's message clearly contained a number.
- There is no per-tenant configuration of the bot persona, emoji style,
  greeting, or sign-off.

### 6.6 Real-world failure: slash-separated location + unlabeled comma-address

User sent this message (and the bot rejected it as missing fields, even
though all fields are present):

```
Deseo crear una nueva orden de EA
Raquel Alfaro Roldán
7102-8588
Heredia / San Pablo / San Pablo
raqe0703@hotmail.com
Residencial Santa Isabel 2, Del Super San Pablo, 100m Norte. Casa esquinera a mano derecha, con portones y muros café.

Producto(s):
Energy Patch x1
GLP Patch  x1
Focus Patch x1
Dopamine Patch x1
Stress Patch x1

Cantidad total:           5 (o por ítem)
TOTAL en colones: ₡47900
- Tipo de orden: EA
- Método de pago: SINPE Móvil
- Método envío: correos-de-costa-rica
COMENTARIO: SINPE CONFIRMADO
```

Bot response:

```
No creare la orden todavia. Faltan campos requeridos:
- Direccion
- Provincia
- Canton
- Distrito

Enviame esos datos y preparo la revision final antes de crearla.
```

**Trace:**
1. `hasOrderCreationIntent` → true (`"Deseo crear una nueva orden"`).
2. `buildStructuredOrderArgs` runs and successfully extracts:
   - `customerName = "Raquel Alfaro Roldán"` (via `inferCustomerNameFromMessage`, first unlabeled line after the intent line).
   - `phone = "71028588"` (8-digit regex).
   - `product = "Energy Patch x1\nGLP Patch x1\n..."` (via `extractProductTextFromMessage`, `Producto(s):` block).
   - `quantity = 5` (from `Cantidad total: 5`).
   - `total = 47900` (from `TOTAL en colones: ₡47900`).
   - `orderType = "EA"` (from `Tipo de orden: EA`).
   - `paymentMethod = "SINPE Móvil"`.
   - `courier = "correos-de-costa-rica"`.
   - `comments = "SINPE CONFIRMADO"`.
3. `extractLocationFromMessage` returns **empty** because:
   - **Labeled extractor** (`getLabelValue(message, ['provincia'])`, etc.) finds nothing — the user did not write `Provincia: Heredia`.
   - **Colonless extractor** (`extractColonlessLocationFromMessage`,
     `@/d:/Coder/CRM-v2/src/lib/bot/ai-agent.ts:819-871`) looks for
     `^\s*provincia\s+(.+)$`, `^\s*canton\s+(.+)$`, `^\s*distrito\s+(.+)$`
     line prefixes. The user wrote `Heredia / San Pablo / San Pablo` with
     **no keyword and slash separators**. No match.
   - **Comma-based fallback** (`@/d:/Coder/CRM-v2/src/lib/bot/ai-agent.ts:929-955`)
     iterates lines containing `,`. It hits the address line
     `Residencial Santa Isabel 2, Del Super San Pablo, 100m Norte. ...`,
     splits on commas, tries to validate `Residencial Santa Isabel 2`
     as a province via `validateLocation`, fails, and **skips the line**.
     The line is never captured as `address` either, because that branch
     is gated behind a successful province validation. The
     `Heredia / San Pablo / San Pablo` line has **no commas**, so the
     fallback never even looks at it.
4. With `args.address` / `args.province` / `args.canton` / `args.district`
   all undefined, `getCreateOrderReviewMissingFields` flags them as missing
   for an `EA` order and routes to `order_repair` instead of final review.

**Two parser gaps confirmed by this case:**

- **(G1) Slash-separated location triplet** — `Heredia / San Pablo / San Pablo`
  is not parsed by any extractor. Variants users actually send:
  - `Heredia / San Pablo / San Pablo`
  - `Heredia/San Pablo/San Pablo`
  - `Heredia - San Pablo - San Pablo`
  - `Heredia, San Pablo, San Pablo` (this one **is** parsed, by the comma
    fallback)
- **(G2) Unlabeled multi-comma address** — When the address has internal
  commas and is on its own line without a `Dirección:` prefix, the
  comma-based fallback misinterprets it as a province/canton/district
  triplet, validation fails, and the line is dropped instead of being
  promoted to `address`.

Additional minor observations from this same message:
- **Email** (`raqe0703@hotmail.com`) on its own line is never extracted —
  there is no `extractEmailFromMessage` in the structured fast-path at
  all. The bot would then never set `args.email`, so emails sent on a
  separate line are silently lost (the schema does not require email, so
  the bot does not complain, but the data is dropped).
- **Quantity line** (`Cantidad total: 5 (o por ítem)`) parses to `5` only
  because the regex is `\d+` after the colon and stops at whitespace.
  This worked here, but `Cantidad total: 5 unidades` would also parse to
  `5`, while `Cantidad: cinco` would silently fall back to summing the
  product line `xN` counts (correct behavior, but undocumented).
- **Courier value** (`correos-de-costa-rica`) is stored as-is and later
  written to the order's `courier` column without canonicalization,
  meaning `correos-de-costa-rica`, `Correos de Costa Rica`, and
  `correos_cr` will coexist for the same shipping provider.

### 6.7 Misc

- `addAssistantMessage` after `executePendingAction` is sometimes called
  **twice** for inventory confirmations (once in the inner success path,
  once outside); the duplicate is harmless but pollutes history.
- `processedMessages` (dedup map) is in-process only. Behind a serverless
  fan-out (Vercel) two function instances can both think a message is new.
  Should move to Redis.
- `chatProcessingLocks` is also in-process and has the same problem.
- The audit trail records `seller = ctx.userName`, which for code-based
  team members is the name they typed during onboarding. There is no
  link back to a real `User.id` for those accounts (`getBotSessionWithContext`
  returns a virtual `bot-<phone>@whatsapp.local`).

---

## 7. What we want next — implementation plan

> Goal: keep all current accuracy guarantees, **add warmth and useful
> behaviour**, fix custom-field scaling, and enable a self-service template.

### 7.1 Introduce a `bot-soul.md` persona file

Create `@/src/lib/bot/bot-soul.md` (loaded at module init, exported as a
constant). It will own everything that is **personality**, separate from
**rules**.

Suggested sections:
- **Identidad** — "Soy Betsy, asistente de ventas. Acompaño al equipo del
  negocio, no soy un formulario."
- **Tono** — cálido, breve, profesional. Usa primera persona singular.
  Permitido: una pequeña empatía o frase humana al inicio (`"¡Listo!"`,
  `"Con gusto."`), cero jerga, cero bromas pesadas.
- **Emojis** — uno por bloque máximo, siempre con un propósito (📦 producto,
  💰 dinero, 📍 ubicación, ✅ éxito, ⚠️ advertencia). Nunca en frases
  conversacionales.
- **Manejo de errores con cortesía** — siempre explica qué falta y propone
  el siguiente paso, en una sola frase.
- **Confirmaciones** — `"¿Confirmás que procedo? Respondé sí o no."` en lugar
  de `"Responde SI para crear la orden..."`.
- **Despedida tras éxito** — un cierre humano (`"Quedó registrada. Avisame si
  necesitás otra cosa."`).
- **Lo que NUNCA hago** (sección breve, tipo bullets, máx 5 puntos):
  inventar datos, reutilizar datos de otra orden, cambiar estado sin pedido,
  saltar la revisión final, listar inventario completo.

The agent will load this file **alongside** the existing `SYSTEM_PROMPT`,
splitting concerns:
- `SYSTEM_PROMPT` keeps **operational rules** (EA vs RA, statuses, dates,
  contra entrega, location validation, inventory).
- `bot-soul.md` owns **voice and warmth**.

This makes it possible for tenants to override the soul file later without
touching the rules.

### 7.2 Rewrite `buildCreateOrderFinalReview`

New design (final WhatsApp output):

```
🧾 *Revisión final — Orden nueva*

👤 *Cliente:* Juan Pérez
📱 *Teléfono:* 8888-8888

📦 *Productos*
• ENERGY PATCH X1 — 2 unidades

💰 *Total:* ₡25.000
💳 *Pago:* SINPE Móvil
🚚 *Tipo:* Envío a domicilio (EA)
🛵 *Mensajería:* Correos de Costa Rica

📍 *Entrega*
San José, Desamparados, San Antonio
200m sur del parque

📋 *Datos del negocio*
• Negocio: WAS
• Usuario: Marlenn

¿Procedo con la creación?
Respondé *sí* para confirmar, *no* para cancelar, o enviame la corrección.
```

Concrete changes inside `buildCreateOrderFinalReview`:
- Stop stripping accents and asterisks. Keep both for WhatsApp; use HTML
  variant for Telegram.
- Group lines into named sections: *Cliente*, *Productos*, *Pago y envío*,
  *Entrega* (only for EA), *Datos del negocio* (custom fields).
- Format money via `formatCrcAmount` and use `₡` instead of `CRC`.
- Render `contraEntrega: true` as a dedicated line in the *Pago* section,
  not as an afterthought.
- Optional: show inventory pre-flight (a `findInventoryMatches` lookup
  before prompting for confirmation) so multi-match warnings happen
  *inside* the review, not after the user types "sí".
- Allow tenant to override the closing line via `bot-soul.md`.

### 7.3 Add `/plantilla` (template) command + tool

Two parts:

**(a) Webhook-level command.** In
`@/src/app/api/bot/whatsapp/webhook/route.ts` and the Telegram counterpart,
short-circuit before AI on `lowerText === '/plantilla' || lowerText === '/template' || lowerText === 'plantilla'`. Send the rendered template
directly.

**(b) AI tool `get_order_template`.** Lets the LLM also serve the template
when the user asks naturally (`"qué datos necesitás para una orden"`,
`"dame el formato"`).

Template generator (pseudocode):

```ts
export async function buildOrderTemplate(tenantId: string, orderType?: 'EA'|'RA') {
  const cf = await getTenantCustomFields(tenantId);
  const lines = [
    '📋 *Plantilla de orden*',
    '',
    'Copiá este mensaje, completá cada línea y enviámelo:',
    '',
    'Tipo de orden: EA   (EA = envío, RA = retiro en local)',
    'Nombre: ',
    'Teléfono: ',
    'Producto: ',
    'Cantidad: ',
    'Total: ',
    'Método de pago: ',
  ];
  if (orderType !== 'RA') {
    lines.push(
      '',
      '— Para envío (EA) —',
      'Provincia: ',
      'Cantón: ',
      'Distrito: ',
      'Dirección: ',
      'Mensajería: ',
    );
  }
  if (cf.productFields.length || cf.businessInfoFields.length) {
    lines.push('', '— Datos del negocio —');
    [...cf.productFields, ...cf.businessInfoFields].forEach(f => {
      const req = f.required ? ' (obligatorio)' : '';
      lines.push(`${f.label}${req}: `);
    });
  }
  return lines.join('\n');
}
```

Notes:
- Honors required vs optional custom fields.
- Includes the tenant-specific labels exactly as they will be expected.
- Same generator powers the webhook command and the AI tool.

### 7.4 Custom-field handling overhaul

Multiple coordinated changes:

**(a) Stop polluting `create_order` top-level params.**
Replace the dynamic top-level fields with a single nested object:

```ts
parameters: z.object({
  ...baseOrderSchema,
  customFields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
}),
```

Then describe valid keys + types **only in the system prompt**, generated
once per tenant. This drastically shrinks the JSON schema the model sees.

**(b) Split prompt for many-field tenants.**
If a tenant has > 6 custom fields, render the section as a compact table
instead of one bullet per field, and move the option lists into a tool
result the LLM can call (`get_custom_field_options(fieldKey)`) instead of
embedding all options inline in the system prompt.

**(c) Second-pass back-fill from the user message.**
Run `extractCustomFieldsFromMessage` (already used by the structured
fast-path) **also** on free-form LLM-path messages, after the model
returns. If the model dropped a required custom field but the user's
message clearly contains it (label match), inject it before validation.

**(d) Forgiving `select` validation.**
For `select`/`multiselect` fields, replace `z.enum(...)` with a custom
Zod refinement that:
- normalizes (lowercase, strip accents, strip hyphens);
- matches the user's value against any `option.value` or `option.label`;
- on success, **rewrites** the value to the canonical option value;
- on failure, returns the list of valid options so the agent can echo them.

**(e) Cache `getTenantCustomFields` per request.**
A simple in-memory `Map<tenantId, Promise<CustomFieldsData>>` keyed off the
request invocation (e.g. attached to the `ToolContext`) avoids the three
DB hits per turn we have today.

**(f) Friendlier "missing custom fields" message.**
When `validateCustomFields` fails, the bot should respond with the
template (section 7.3) pre-filled with whatever fields **were** captured,
plus blanks for the missing ones — instead of a flat "el campo X es
requerido" list.

### 7.5 Persona-aware error and success messages

- Move all hard-coded Spanish strings out of `ai-agent.ts` into a
  `@/src/lib/bot/messages.ts` (or directly into `bot-soul.md` template
  blocks) so we can tune voice without touching logic.
- Replace "Ocurrió un error al procesar tu mensaje. Por favor, intenta de
  nuevo." with one of three context-aware fallbacks (network, validation,
  unknown).
- Replace the formal "Entendido, acción cancelada." with the soul-defined
  cancellation line.

### 7.6 Structured fast-path parser hardening (the Raquel Alfaro case)

Driven by **section 6.6**. Concrete changes inside
`@/src/lib/bot/ai-agent.ts`:

**(a) Slash- and dash-separated location triplets.**
Add a third pass to `extractLocationFromMessage` (before the comma-based
fallback) that walks each line and tries to split on `/`, ` / `, ` - `,
`|`, and ` · ` as separators. For each candidate triplet, run
`validateLocation`; on success, fill missing province/canton/district
fields (and apply fuzzy corrections). Pseudocode:

```ts
const TRIPLET_SEPARATORS = /\s*[\/|·\-—–]\s*/;
for (const line of lines) {
  if (looksLikeNonAddressOrderLine(line)) continue;
  if (line.includes(':')) continue;          // already handled
  const parts = line.split(TRIPLET_SEPARATORS).map(s => s.trim()).filter(Boolean);
  if (parts.length !== 3) continue;
  const v = validateLocation(parts[0], parts[1], parts[2]);
  if (!v.province.valid || !v.canton.valid) continue;
  result.province ||= v.correctedProvince || v.province.match || parts[0];
  result.canton   ||= v.correctedCanton   || v.canton.match   || parts[1];
  result.district ||= v.correctedDistrict || v.district.match || parts[2];
  break;
}
```

**(b) Multi-comma address rescue.**
The comma-based fallback at `@/src/lib/bot/ai-agent.ts:929-955` currently
drops any line whose first part fails province validation. Change the
logic to: if the first comma-separated token does not validate as a
province AND `province/canton/district` were already filled by an earlier
pass OR by (a), treat the entire line as `address` (when `result.address`
is still empty). This rescues the
`Residencial Santa Isabel 2, Del Super San Pablo, 100m Norte. ...` case.

**(c) Detect "free-form address candidate" lines.**
Add a heuristic `looksLikeAddressLine(line)`:
- Contains at least one of the address signals: `casa`, `apto`,
  `apartamento`, `residencial`, `del`, `frente a`, `100m`, `mts`,
  `condominio`, `urbanizacion`, `barrio`, `kilometro`, `km`, `entrada`,
  `costado`, house number patterns (`\d+\s*[a-z]?`).
- Does not look like a known label line (`isOrderSectionLabel`).
- Does not look like a customer-name line (capitalized 2–4 word pattern).

If `result.address` is still empty after passes (1)–(b), pick the
first line that matches this heuristic and is not the customer name.

**(d) Email extraction.**
Add `extractEmailFromMessage(message)` using
`/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i` and wire it into
`buildStructuredOrderArgs` as `args.email`.

**(e) Courier canonicalization.**
In `getCourierFromParams` (or a new `canonicalizeCourier`):
- Normalize: lowercase, strip accents, replace separators with single space.
- Map known variants to canonical IDs:
  - `correos`, `correos cr`, `correos de costa rica`, `correos-de-costa-rica`,
    `correos_cr` → `correos_cr`.
  - `uber`, `uber eats` → `uber`.
  - `glovo`, `glovapp` → `glovo`.
  - `pedidos ya`, `pedidosya`, `pyya` → `pedidosya`.
- Anything unknown is stored as-is but logged with
  `[BotParser] Unknown courier value` so we can grow the map over time.

**(f) Snapshot tests.**
Add `@/src/lib/bot/__tests__/structuredOrder.test.ts` with one snapshot
per real-world message shape we have seen, including the Raquel Alfaro
case verbatim. Each test asserts that
`buildStructuredOrderArgs(message, customFieldsConfig)` returns an
args object that:
- Has all required `EA` fields populated.
- Has the expected `customerName`, `phone`, `email`, `total`, `quantity`,
  `orderType`, `paymentMethod`, `courier`, `comments`.
- Has the expected `province`/`canton`/`district`/`address`.

These tests are what guarantee we never regress on shapes users have
actually sent.

**(g) When parsing **still** drops a field, fall back smarter.**
Right now `requestCreateOrderFinalConfirmation` emits the bare
"Faltan campos requeridos" list. Even after the parser fixes above, some
edge cases will slip through. Change the repair message to:
1. Echo back the args the parser **did** capture (so the user can see we
   already have most of the data).
2. Render only the missing fields as fillable lines using the
   `buildOrderTemplate` generator from **7.3**, so the user can paste back
   only what's missing.

### 7.7 Robustness fixes (tracked but not tone-related)

- Move `processedMessages` and `chatProcessingLocks` into Redis so they
  survive serverless cold starts.
- Bump pending-confirmation TTL from 120s to 600s (10 min) for review and
  inventory; keep 120s for bare yes/no in legacy paths.
- Tighten `ACTION_KEYWORDS` so keywords like `crear` only force tools when
  combined with order/inventory intent (regex with context, not bag of
  words).
- Add unit tests for: structured fast-path parser, final-review renderer,
  template generator, custom-field back-fill.
- Replace asterisk stripping in custom fields formatter with platform-aware
  output (`formatCustomFields(target: 'whatsapp' | 'telegram')`).

### 7.8 Suggested rollout order

1. **Parser hardening (7.6).** Unblocks the Raquel Alfaro case immediately
   and ships with snapshot tests so future shapes don't regress.
2. **`bot-soul.md` + persona split (7.1).** Lowest risk, biggest perceived
   change.
3. **Final-review redesign + `/plantilla` command + `get_order_template`
   tool (7.2 + 7.3).** Self-contained; depends on parser hardening for the
   "echo back captured fields" message in 7.6(g).
4. **Custom-fields overhaul 7.4 (a)–(f).** Touches schema generation; ship
   behind a feature flag (`BOT_CUSTOM_FIELDS_V2=true`) and roll per tenant.
5. **Persona-aware messages (7.5).**
6. **Robustness fixes (7.7)** — Redis dedup/locks, TTL, keyword regexes,
   broader unit tests.

Each step is independently shippable and reversible.

---

## 8. Files to touch (when we start the refactor)

| Step | Files |
|------|-------|
| 7.1 | `@/src/lib/bot/bot-soul.md` (new), `@/src/lib/bot/ai-agent.ts` (load + replace persona portion of `SYSTEM_PROMPT`). |
| 7.2 | `@/src/lib/bot/ai-agent.ts` (`buildCreateOrderFinalReview`, `requestCreateOrderFinalConfirmation`), `@/src/lib/bot/whatsapp.ts` (optional `formatCustomFieldsForWhatsApp`). |
| 7.3 | `@/src/lib/bot/ai-agent.ts` (new helper), `@/src/lib/bot/ai-tools.ts` (`get_order_template` tool + executor), `@/src/app/api/bot/whatsapp/webhook/route.ts` (slash command), `@/src/app/api/bot/telegram/webhook/route.ts` (slash command). |
| 7.4 | `@/src/lib/customFields.ts` (forgiving select, schema shape), `@/src/lib/bot/ai-tools.ts` (`createOrder` consumes nested `customFields`), `@/src/lib/bot/ai-agent.ts` (back-fill pass, prompt compactor, get_custom_field_options tool). |
| 7.5 | `@/src/lib/bot/messages.ts` (new), `@/src/lib/bot/ai-agent.ts` (replace literals). |
| 7.6 | `@/src/lib/bot/ai-agent.ts` (`extractLocationFromMessage`, `extractColonlessLocationFromMessage`, comma fallback, new `extractEmailFromMessage`, new `looksLikeAddressLine`, `canonicalizeCourier`, smarter `order_repair` message), `@/src/lib/bot/__tests__/structuredOrder.test.ts` (new). |
| 7.7 | `@/src/lib/bot/conversation-memory.ts` (Redis dedup + lock), `@/src/lib/bot/ai-agent.ts` (TTL constants, regexes). |

---

## 9. Open questions for product

- Do we want the soul / tone to be **per-tenant configurable** (a textarea in
  Configuración > AI Assistant) or a single global default in `bot-soul.md`?
- Should `/plantilla` show **only required** fields by default, with an
  optional `/plantilla completa` for everything? Or always render everything?
- For the final review, do we want an inline **inventory preview** (slower
  by ~1 DB hit) or keep it post-confirmation (faster, surprises the user
  on multi-match)?
- For tenants with > 20 custom fields, should the bot *paginate* the order
  template (`/plantilla 1`, `/plantilla 2`) or push them through a guided
  multi-step conversation?
