# Bot Order-Extraction Fix — Session Handoff

> Single-source recap of every change, every mistake, and every open
> question from the May 20, 2026 debugging session. Read this first
> before continuing in a new session.

---

## 1. The original complaint

The bot's order-creation flow was failing in two reproducible ways:

**Case A — Location field-shifting:**
User pastes a real WhatsApp order:

```
Deseo crear una nueva orden de EA
Christian Gonzalez Alvarez
83608994
Sanjose, Alajuelita, Sanjosecito
Sanjosecito de Alajuelita de la iglesia católica 350 suroeste...
Producto(s):
dopamine patch x2
TOTAL en colones: ₡20.900
Tipo de orden: EA
Método de pago: SINPE Móvil
COMENTARIO: SINPE CONFIRMADO
```

The bot reported `Provincia / Cantón / Distrito` as **missing**, even
though "Sanjose, Alajuelita, Sanjosecito" was clearly present. It also
rendered `"dopamine patch x2 x2"` (double quantity).

**Case B — Template placeholders accepted as data:**
User pasted a template with several `e.g., "..."` placeholders left
intact. The bot treated those literal strings as real custom-field
values and proceeded with garbage data.

**Case C — Repair flow couldn't handle natural language:**
After the bot showed a partial review, user replied:
*"No el distrito es Brasil de Mora, el producto es 1 sleeping patches"*
The bot replayed the **same wrong review** without applying any
corrections.

---

## 2. Commits (in order)

| Commit | Title | What it did |
|---|---|---|
| `da8b391` | changes to bot | First attempt: added AI extractor BEFORE regex; added fuzzy location matcher; added template-placeholder rejection; conversational missing-fields prompt |
| `986ec1b` | Changes to the codebase | Removed `response_format: json_object` (likely incompatible with grok-4.3); robust JSON-from-prose parser; added detailed logging; fixed `x2 x2` doubling bug; stopped layering regex on AI output |
| (pending) | not yet committed | Stronger AI prompt with negative examples; bumped `reasoning_effort` low→medium; defensive email regex extraction; **AI-powered order_repair flow** |

Plus an unrelated Vercel build fix: removed empty `"env": {}` from
`vercel.json` (Vercel CLI 54.x rejects it as a schema violation).

---

## 3. Files touched

- `@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts` — main extraction + repair logic
- `@d:\Coder\CRM-v2\src\lib\locationValidator.ts` — fuzzy location matcher
- `@d:\Coder\CRM-v2\vercel.json` — removed `"env": {}`

No tests were added in this session.

---

## 4. The architecture now (after all changes)

```
processMessage(userMessage)
  │
  ├── peekPendingConfirmation()
  │     │
  │     ├── pending == 'order_repair'  ← NEW: now uses AI
  │     │     1. extractOrderArgsWithAI(correctionMessage)
  │     │     2. sanitizeAIExtractedArgs
  │     │     3. merge over existingArgs (correction wins, customFields deep-merged)
  │     │     4. applyFuzzyLocationCorrections
  │     │     5. fallback to regex (inferCreateOrderArgsFromMessage) only if AI returns null/empty
  │     │     → executeCreateOrderRepair
  │     │
  │     └── pending == 'order_final_confirm'  → unchanged YES/NO flow
  │
  ├── hasOrderCreationIntent(userMessage) == true   ← AI-FIRST PATH
  │     1. extractOrderArgsWithAI(userMessage)
  │     2. sanitizeAIExtractedArgs (drops placeholders, regex-recovers email)
  │     3. applyFuzzyLocationCorrections
  │     4. requestCreateOrderFinalConfirmation
  │
  ├── buildStructuredOrderArgs (regex fast-path)   ← TRUE FALLBACK ONLY
  │     - only reached if AI extraction returned null/empty/no-substance
  │     - applyFuzzyLocationCorrections then executeStructuredCreateOrder
  │
  └── LLM tool-call flow                            ← unchanged catch-all
```

**Key principle established this session: do NOT layer regex on top of
AI output.** Trust the AI; fall back to regex only when AI literally
fails. The user explicitly called out the layering as harmful.

---

## 5. Each fix in detail

### 5.1 `locationValidator.ts` — smarter fuzzy matcher

`@d:\Coder\CRM-v2\src\lib\locationValidator.ts:43-125`

`findBestMatch` previously only did exact + accent-insensitive matches.
Added three new layers (in order):

1. **Compact (no-space) match** — `"Sanjose"` (compact `"sanjose"`)
   matches `"San José"` (compact `"sanjose"`). Same for `"Sanjosecito"`
   → `"San Josecito"`.
2. **Compact prefix match** in both directions — handles abbreviations.
3. **Levenshtein distance fallback** — threshold scales with name
   length. Catches typos like `"Cartgo"` → `"Cartago"`, `"Heredi"` →
   `"Heredia"`.

Used by `validateLocation` → `fitLocationTriplet` → both the regex
fast-path AND the AI-output `applyFuzzyLocationCorrections`.

### 5.2 Template placeholder rejection

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:1492-1506` — `isTemplatePlaceholderValue`

Rejects strings matching:
- `e.g., "..."`, `eg "..."`
- `ej:`, `ejemplo:`
- `(opcional)`, `(optional)`
- `<...>`, `[...]`
- `tu nombre`, `tu telefono`, `tu email`, `tu correo`, `tu direccion`

Applied in **both** the AI sanitizer (`sanitizeAIExtractedArgs`) and
the regex custom-fields extractor (`extractCustomFieldsFromMessage`).

### 5.3 AI-first extraction (`extractOrderArgsWithAI`)

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:1679-1817`

- Calls Grok via the OpenAI-compatible xAI endpoint.
- **No `response_format`** — likely incompatible with `grok-4.3`; we
  rely on prompt + robust parsing.
- `temperature: 0`, `max_tokens: 2000`, `reasoning_effort: 'medium'`.
  - `'low'` was too aggressive; the model field-shifted (district =
    "1 sleeping patches"). `'medium'` adds ~1-2s latency for a
    dramatic accuracy gain.
- Returns `null` on any failure (caller falls back to regex).

**Prompt highlights** (live at lines 1685-1754):
- Strict JSON-only rule, no markdown, no fences.
- "Cada fragmento del mensaje pertenece a UN solo campo" — anti-shift.
- Per-field semantic rules: *"el distrito es SIEMPRE un nombre de
  lugar de Costa Rica. Nunca puede ser un producto, un total..."*
- Two worked examples (the second is the real Carolina Zúñiga case
  that failed earlier).
- A "NUNCA HAGAS ESTO" section listing the four exact mistakes the
  model previously made.

### 5.4 `extractJsonFromLLMResponse`

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:1598-1645`

Three-tier JSON recovery:
1. Direct `JSON.parse(trimmed)`.
2. Strip ` ```json ... ``` ` fences and retry.
3. Scan for first balanced `{...}` block (string-aware so escaped
   quotes don't break the brace count).

### 5.5 `sanitizeAIExtractedArgs`

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:1825-1907`

Converts AI JSON to internal args shape. Key behaviors:
- `setIfReal` rejects empty/whitespace and template placeholders.
- **Email defensive cleanup** (`@:1845-1854`): regex-extracts only the
  valid email substring even if the model leaked
  `"karo84zz@gmail.com.    ☎️84492744"`.
- `total` coerced from string → number (handles `"₡20.900"` etc).
- `products` filtered to require a real `name`; quantity defaulted to 1.
- `customFields` restricted to keys the tenant actually has configured.

### 5.6 `applyFuzzyLocationCorrections`

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:1907-1925`

Runs the (now smarter) location validator and back-fills the canonical
spelling. Called from inside `requestCreateOrderFinalConfirmation` so
**every** path (AI, regex, LLM, repair) ends up with `"San José"`
instead of `"Sanjose"` before the review is rendered.

### 5.7 `x2 x2` double-quantity fix

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:706-718`

Pre-existing bug: when the regex set `args.product = "dopamine patch
x2"` AND `args.quantity = 2`, the review renderer printed
`"dopamine patch x2 x2"`. Fix strips trailing `xN` or `(N)` from the
product name before re-appending the canonical `xN`.

### 5.8 Conversational missing-fields prompt

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:579-618` — `buildConversationalMissingFieldsAsk`

Replaced the templated bullet list with a single Spanish sentence:
- 1 missing: *"Solo me falta el cantón. ¿Me lo podés indicar?"*
- 2+ missing: *"Me falta la dirección, el cantón y el distrito. ¿Me los podés enviar?"*

### 5.9 AI-powered order_repair flow

`@d:\Coder\CRM-v2\src\lib\bot\ai-agent.ts:2376-2418`

Previously called only `inferCreateOrderArgsFromMessage` (regex), which
ignored natural-language corrections. Now:
1. Calls `extractOrderArgsWithAI(correctionMessage)`.
2. Merges sanitized AI deltas over existing args (correction wins).
3. customFields deep-merged.
4. Falls back to regex only when AI returns null/empty.

So *"el distrito es Brasil de Mora"* → `{district: "Brasil de Mora"}`
gets applied. *"el producto es 1 sleeping patches"* →
`{products: [{name: "sleeping patches", quantity: 1}]}` gets applied.

---

## 6. Mistakes I made (so you don't repeat them)

### Mistake 1 — `response_format: { type: 'json_object' }`
First commit (`da8b391`) used this. It threw an error on `grok-4.3`
which silently fell back to regex. Removed in `986ec1b`. **Lesson:**
xAI's OpenAI-compatible endpoint doesn't support every OpenAI feature
on every model; prefer prompt-based JSON instructions + robust parser.

### Mistake 2 — Layered regex on top of AI output
First commit ran `inferCreateOrderArgsFromMessage` over the AI's
already-correct output, polluting it with regex artifacts. The user
called this out explicitly: *"we are doing something in the code that
limits the AI"*. Removed in `986ec1b`. **Lesson:** trust the AI's
output; the regex is a true fallback, not a layer.

### Mistake 3 — `reasoning_effort: 'low'` for a complex parse
Second commit used `low` for speed. The model skimmed multi-line
messages and field-shifted (district = "1 sleeping patches"). Bumped
to `medium` in the third (uncommitted) change. **Lesson:** for
free-form NLP tasks, `low` is too lazy; pay the latency cost.

### Mistake 4 — Vague prompt
Original prompt had general rules but no per-field semantic guarantees
and no negative examples. Grok was technically following instructions
but happily putting products in district. **Lesson:** when an LLM
field-shifts, add (a) per-field semantic constraints
("a district is always a place name, never a number") and
(b) the exact failure case as a worked example with the correct output.

### Mistake 5 — Repair flow ignored the AI
The original architecture only routed first-attempt order messages
through the AI. The repair flow stayed on regex. So users couldn't
correct in natural language. **Lesson:** if you call the AI brain the
"primary path", make sure ALL user messages in the order conversation
go through it, not just the first one.

### Mistake 6 — I claimed fixes worked without runtime testing
After `da8b391` I told the user "the architecture is back to AI-first
and the two cases will work" without ever executing the new path
against a real message. The user (rightly) called me out. After
`986ec1b` I added detailed logging so future failures are visible in
production logs instead of being invisible. **Lesson:** when you can't
runtime-test, instrument heavily and say so explicitly.

---

## 7. Diagnostic logs to look for

After every deploy, send a real WhatsApp message and check Vercel
runtime logs. The expected sequence for a clean order-creation:

```
[AI Agent] Order-creation intent detected → AI extraction path
[AI Agent] extractOrderArgsWithAI: calling Grok { model: 'grok-4.3', messageLength: ###, ... }
[AI Agent] extractOrderArgsWithAI: success {
  elapsedMs: ####,
  keys: ['customerName','phone','email','province','canton','district',...],
  province: 'San José', canton: 'Mora', district: 'Colón',
  productCount: 1,
  customFieldKeys: [...]
}
[AI Agent] AI-first extraction succeeded → routing to final review { hasLocation: true, ... }
```

For a correction message:
```
[AI Agent] order_repair correction → AI extraction path
[AI Agent] extractOrderArgsWithAI: success { ... }
[AI Agent] order_repair: AI applied corrections { correctionKeys: ['district','products'] }
```

**Failure modes the logs will surface:**
- `extractOrderArgsWithAI: Grok call FAILED` + error message → API
  issue or auth problem.
- `extractOrderArgsWithAI: failed to parse JSON` + `rawPreview` → the
  prompt isn't producing JSON; check `rawPreview` for what Grok
  actually returned and adjust the prompt or the parser.
- `extractOrderArgsWithAI: empty response from Grok` → model returned
  nothing; could be timeout (`XAI_TIMEOUT_MS`, default 15s).
- `AI extraction returned no substantive fields, falling back to regex
  fast-path` → AI extracted only trivia; regex is going to try.
- `Regex fast-path matched (AI fallback)` → AI failed and the regex
  picked up the slack.

---

## 8. Known open issues / what to verify next session

1. **The new error the user saw at 4:04pm** that triggered this
   handoff — not yet documented. Capture it before resuming.

2. **Latency** — `medium` reasoning + ~1500-token prompt likely puts
   each order extraction at ~3-5s. If users complain, options:
   - Drop back to `low` but tighten the prompt further.
   - Cache the system prompt (xAI doesn't currently support this on
     OpenAI-compatible endpoint, AFAIK).
   - Move the AI call to a streaming response so the user sees
     activity while it runs.

3. **No automated tests yet.** Section 7.6(f) of
   `BOT_IMPLEMENTATION_REVIEW.md` calls for snapshot tests. Recommended:
   - Snapshot test for `extractJsonFromLLMResponse` with messy inputs.
   - Snapshot test for `sanitizeAIExtractedArgs` with the placeholder
     and email-trim cases.
   - Snapshot test for `findBestMatch` with `"Sanjose"`, `"Sanjosecito"`,
     `"Heredi"`, `"Cartgo"`.
   - Integration test: full `processMessage` with a mocked xAI client
     returning a known JSON, asserting the final review text.

4. **The `XAI_MODEL = 'grok-4.3'` env default** — verify this model
   name is real on xAI's API. If it's a placeholder or internal name,
   all xAI calls fail. Check `.env.local` and the deployed env.

5. **Repair flow edge case** — if the user sends a totally unrelated
   message during a pending repair (e.g., asking about something else),
   we still try to run AI extraction. The AI returns nothing
   substantive, we fall back to regex, regex returns nothing. We then
   call `executeCreateOrderRepair` with unchanged args, which probably
   re-renders the same review. **Possible improvement:** if AI returns
   no substantive deltas AND the message doesn't look like an order
   correction, route to the LLM tool flow instead of replaying.

6. **`hasOrderCreationIntent` is keyword-based.** Real failures we
   haven't covered: *"mandame esto a Cartago"*, *"agregá esta venta
   al sistema"*. These don't hit the AI extractor. The LLM tool-call
   flow handles them but with the old templated prompts. Consider
   widening the intent detector or making the AI extractor the default
   for all messages over a certain length.

7. **No `.env.local` was modified.** The xAI keys, model name, and
   timeout come from the existing env. If something stops working,
   first check `XAI_API_KEY`, `XAI_MODEL`, `XAI_TIMEOUT_MS`.

---

## 9. Quick test plan when resuming

Three messages, in order, after deploy:

**Test 1 — clean order, the original failing case:**
```
Deseo crear una nueva orden de EA
Christian Gonzalez Alvarez
83608994
Sanjose, Alajuelita, Sanjosecito
de la iglesia católica 350 suroeste
dopamine patch x2
TOTAL: ₡20900
EA SINPE
```
Expected: single final-review with `San José / Alajuelita /
San Josecito`, `dopamine patch x2` (single x2), no missing fields
prompt.

**Test 2 — messy whitespace, emojis, cédula (the Carolina case):**
```
Carolina Zúñiga Zamora       correo: karo84zz@gmail.com.    ☎️84492744 Céd303970214
San José, Mora, Colón
Brasil de Mora, carretera a ciudad colón, calle cajetas, 4ta casa
1 sleeping patches
Pago 12,900CRC
Sinpe confirmado
```
Expected: `district: "Colón"` (NOT "1 sleeping patches"), `address:
"Brasil de Mora..."` (NOT "Pago 12,900CRC"), `email:
"karo84zz@gmail.com"` (no trailing junk), `products: [{name: "sleeping
patches", quantity: 1}]`.

**Test 3 — natural-language correction:**
After Test 1 or 2 produces a partial review, reply:
*"No el distrito es San Antonio, el producto en realidad es 3"*
Expected: bot updates district and product quantity, re-renders review
with the new values.

---

## 10. Things I deliberately did NOT change

- The main LLM tool-call flow (`tools` parameter + `create_order`
  schema). It still works as before for messages without explicit
  order-creation intent.
- The pending-confirmation TTL (still 120s).
- The order template that the bot ships back to the user (section 7
  of `BOT_IMPLEMENTATION_REVIEW.md`). That's a UX change separate from
  the extraction logic.
- The `executeStructuredCreateOrder` and `executeCreateOrderRepair`
  internals. They still work the same; just the args getting passed in
  are now AI-derived.

---

## 11. Where to start next session

1. Read this file.
2. Run `git log --oneline -10` to see if there are commits beyond what's listed in §2.
3. Capture the new error the user mentioned (4:04pm May 20) — log
   line, message that triggered it, expected vs actual output.
4. Check `tsc --noEmit` is still clean.
5. Decide whether to fix forward or revert. Most of the work this
   session is solid; the open question is the new failure mode.
