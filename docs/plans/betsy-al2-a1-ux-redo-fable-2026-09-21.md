# Betsy `/config/agentes` AL2-A1 UX redo — paste-import, plain atajos, WhatsApp Probar

> **Status (2026-09-21 CR):** plan only. Rafael García GO'd the direction after rejecting the
> shipped AL2-A1 (#64) Atajos / Datos de la marca / Probar screens as engineer-facing. No product
> code in this PR.
>
> **Author:** Fable 5.1 (Cursor cloud, planner only) · **Base:** `dev` @ `2fb0c69` (AL2-A1 #64 +
> SQL 029 live) · **Parent plan:** [`betsy-agent-layer-fable-2026-09-21.md`](./betsy-agent-layer-fable-2026-09-21.md)
>
> **Model lock for implementers:** Cursor Executor = **grok-4.7 high fast** (`grok-4.7-high-fast`)
> only. Never grok-4.5 or any 4.5 alias for coding, planning, or verification. Do not merge to
> `dev` unless Rafael explicitly says merge.

## Goal

A Costa Rican store owner configures the agent by pasting their existing WhatsApp shortcut pack,
reviews a checklist, and sees the bot answer "precio con envío?" as a WhatsApp bubble — without
ever reading a key, a `{{placeholder}}`, or a fixture table.

## User pain (from the three screenshots)

- **Atajos:** cards expose `como_comprar`, `precio_envio_pago`, `{{brand.payment.summary}}`,
  `{{brand.shipping.summary}}`; the body is a template, not the text a customer would read.
  Starter chips insert more template vars. `sys_*` "reservados" and "Imágenes — disponible en A2"
  are engineering notes on a customer-facing form.
- **Probar conversación:** "Canal: ninguno · sesión f22da1fe", a `Texto` message-type select, a
  "Ventana de 24 h abierta" checkbox, **Replay todo**, a fixture table `v01…sigue/sigue/sí`, and a
  `passRate 1 · violaciones 0 · hash forge-wa-v2-… · tokens 20274 / 100000` line. It is a test
  harness, not a chat. The **Enviar turno** button is disabled until the owner scrolls up to
  Canales and finds "Probar aquí". Pánico and Historial sit on the same screen with no context.
- **Datos de la marca:** ~20 manual fields (SINPE number, titular, banco, IBAN, GAM / fuera del
  GAM, retiro text, horario) as the *primary* path. Owners already have this written down in their
  employee shortcut packs; nothing lets them paste it.

## Scope

**In**

- One paste-import flow **"Cargar desde mis atajos"** → AI extraction → review checklist →
  **Guardar** writes `brandFacts` + named playbooks (real Spanish copy) in one confirmed step.
- Atajos as a plain list (title · customer-facing text · on/off). Eng keys, `sys_*`, `{{…}}`,
  `kind`, `deliveryMode`, intents behind an **Avanzado** toggle. Starter chips only when they
  insert usable CR Spanish (resolved facts), never a raw template var.
- Probar as a fake WhatsApp thread with bubbles and one **Enviar**. Channel is required and
  one-click (pre-select the only bound WA account; "Probar aquí" from Canales still works).
  Replay / fixture suite / passRate / violaciones / hash / tokens move under a collapsed
  **Pruebas internas** section. Pánico → **Detener agente**; Historial → **Cambios recientes**
  (collapsed) or moved off this screen.
- Contrast lock from #61 stays: dark text on white in every new control.

**Out**

- Soft Figma redesign Track B; Soft chrome (`SoftSlimNav`, `SoftInboxBuckets`, `SoftCopilotRail`).
- Staff bot `src/lib/bot/**`, `src/app/api/bot/**`.
- SINPE queue / orders / Correos.
- Image upload (A2) beyond the existing disabled note.
- Any schema change; `prisma db push` / `prisma migrate` (forbidden on shared Supabase).
- Runtime behavior of the agent (classifier, gates, safety router) — UI + one extraction
  endpoint only.

## Slices

Prefer **one fat PR** (`feat(agentes): AL2-A1 UX redo`) landing all three screens together so
Rafael reviews the flow once. If the extraction endpoint drags, split as: PR-1 Atajos + Probar
(pure UI, zero new API) → PR-2 paste-import (new API + review checklist). Never ship PR-2 first.

## Acceptance tests

Run on a Vercel Preview with the isolated tenant (`.cursor/skills/verify-betsy/SKILL.md`), agent
bound to a WA account. Each box needs a screenshot or a passing test in the PR.

- [ ] **AT-1 Paste → facts.** Paste a real employee shortcut dump (PatchHouse / Bloom / DeepClean
      style, ≥ 800 chars, mixed pagos + envíos + horario) into "Cargar desde mis atajos". The
      review checklist shows `storeName`, `hoursText`, SINPE number + titular, EA GAM / fuera GAM
      costs, RA text, and ≥ 3 named playbooks, each with a confidence chip and an editable value.
      Nothing is persisted until **Guardar**.
- [ ] **AT-2 Guardar is one write, validated.** Clicking **Guardar** persists `brandFacts`
      (passes `BrandFactsSchema`) and creates the playbooks via the existing shortcut path;
      `version` bumps once; one `AuditLog` row; a second click is a no-op (idempotency key).
      Unchecked checklist rows are not written.
- [ ] **AT-3 Extraction is safe.** Extraction output that contains payment-confirmation wording
      ("pago confirmado", "recibimos tu pago") is rejected by the existing
      `confirmation_wording` guard and shown as a red row, not saved. Extraction never touches
      Meta, never writes `ChatMessage`, and counts against `testDailyTokenCap`.
- [ ] **AT-4 Plain atajo.** Default Atajos view shows only: human title, the exact customer text,
      an Activo toggle. Zero occurrences of `sys_`, `{{`, `_`-joined keys, `kind`, or
      `deliveryMode` in the DOM until **Avanzado** is toggled on.
- [ ] **AT-5 Chips insert Spanish.** Clicking a starter chip (e.g. "Formas de pago") inserts text
      whose `{{…}}` vars are already resolved from saved `brandFacts` (e.g. "SINPE 70339763 a
      nombre de Rafael García"); if a needed fact is missing, the chip is disabled with the hint
      "Completá Datos de la marca o cargá tus atajos".
- [ ] **AT-6 Probar bubble.** With the WA channel pre-selected, type `precio con envío?` and press
      **Enviar**. The thread renders a right-aligned customer bubble and a left-aligned agent
      bubble with the reply text, timestamp, and a small "Forge WA · sandbox" label. No
      `intent`, `decisionTrace`, JSON, or `wouldSend` visible by default.
- [ ] **AT-7 Channel never "ninguno".** If exactly one active WA binding exists, Probar starts
      with it selected. If several, a one-click picker appears above the thread. If none, the
      composer is replaced by "Conectá un canal en Canales" and **Enviar** is hidden — the string
      "Canal: ninguno" does not appear anywhere.
- [ ] **AT-8 Pruebas internas hidden.** Replay todo, the fixture table, passRate, violaciones,
      fixtureSetHash, tokens de prueba, message-type select, and the 24 h checkbox live under a
      collapsed **Pruebas internas** disclosure (or a separate route), closed by default, and keep
      working when opened (`/test/replay` still returns the same report).
- [ ] **AT-9 Panic / history relabeled.** No "Pánico" or "Historial (últimos 20)" heading on the
      main flow. **Detener agente** keeps the three existing actions with a confirm dialog and
      `update_config`; **Cambios recientes** is collapsed by default. `POST /panic` behavior is
      unchanged (existing tests green).
- [ ] **AT-10 Contrast.** Every new input, chip, bubble, and hint measures ≥ 4.5:1 dark text on
      its background in the Preview screenshot (spot-check with the verify-betsy contrast probe);
      `[color-scheme:light]` + `!text-slate-900` classes from #61 are preserved.
- [ ] **AT-11 Locks.** `git diff --exit-code` is empty for `src/lib/bot/**`, `src/app/api/bot/**`,
      `SoftSlimNav.tsx`, `SoftInboxBuckets.tsx`, `SoftCopilotRail.tsx`, `prisma/schema.prisma`,
      `supabase/migrations/**`. `npm run test:soft-ai-agent`, `npm run test:chat-harden`,
      `npm run lint`, `npm run build` green.
- [ ] **AT-12 Verify bar screenshots.** PR body embeds three Preview screenshots: (a) paste →
      checklist with facts filled, (b) plain atajo list with Avanzado off, (c) Probar bubble for
      `precio con envío?`. All readable dark-on-white.

## Suggested touchpoints (paths only)

**UI (`src/app/config/agentes/`)**

- `page.tsx` — section order (Cargar desde mis atajos → Atajos → Probar → Canales → Avanzado /
  Pruebas internas / Detener agente / Cambios recientes), channel auto-select, collapsibles.
- `BrandFactsEditor.tsx` — becomes the review checklist + "Editar a mano" fallback; manual form
  stays but is secondary.
- `ShortcutsEditor.tsx` — plain list, Avanzado toggle, resolved-Spanish chips.
- `AgentTestSandbox.tsx` — WhatsApp thread + single Enviar; internals move to a new
  `AgentInternalTests.tsx`.
- New: `ShortcutPasteImport.tsx` (paste → extract → checklist → Guardar).

**API (`src/app/api/chat/agents/[id]/`)**

- New: `import/extract/route.ts` — POST paste text, returns structured proposal (no write).
- New: `import/apply/route.ts` — POST reviewed proposal, single audited write of `brandFacts` +
  shortcuts (idempotency key). Or fold into `PATCH route.ts` + `shortcuts/route.ts` batch.
- Existing, unchanged contracts: `test/route.ts`, `test/replay/route.ts`, `shortcuts/**`,
  `bindings/route.ts`, `panic/route.ts`.

**Lib (`src/lib/soft-ai/`)**

- New: `shortcut-import.ts` — extraction prompt + zod output schema mapped onto
  `BrandFactsSchema` and `ShortcutDraft`; reuse `llm/client.ts` (Soft-only xAI client), never
  `src/lib/customer-paste-grok.ts` or anything under `lib/bot`.
- `shortcuts.ts` — helper to render a chip body with `brandFactTemplateValues()` resolved and
  report missing facts.
- `agent-claim-gates.ts` — charge extraction tokens to `testDailyTokenCap`.
- Tests: `src/lib/__tests__/soft-ai-shortcut-import.test.ts` (fixture dumps → expected facts;
  confirmation-wording rejection; missing-fact chip state); extend `soft-ai-probar-sandbox.test.ts`
  for channel auto-select.

## Risks

| Risk | Mitigation |
|---|---|
| **Channel none.** Probar depends on a WA binding; a fresh tenant has none, and today the button just greys out. | Auto-select the single active binding; explicit empty state pointing to Canales; never render "ninguno". Isolated test tenant must have a bound WA account before AT-6/7 screenshots. |
| **AI extraction quality.** Shortcut dumps are messy (emoji, prices as `₡3.000`, SINPE typed three ways); a wrong SINPE number reaching a customer is a money-path failure. | Review checklist is mandatory (no auto-save); confidence chips; monetary fields parsed with the existing `src/lib/crc-money.ts` helper; `confirmation_wording` guard on every playbook body; `BrandFactsSchema` strict parse; extraction is `reasoning_effort: low`, `store:false`, ≤ 1 model call. |
| **Token cost.** Extraction prompts are long (dump + schema). | Cap paste at 8k chars; charge to `testDailyTokenCap` (already enforced); show tokens used under Pruebas internas only. |
| **Hiding internals hides regressions.** Fixture replay is how CoS records the `aiFullUnlock` dark run. | Pruebas internas keeps 100 % of today's replay UI and endpoint; only visibility changes. |
| **Scope creep into runtime.** Tempting to "fix" reply wording while here. | Runtime, classifier, and gates are out; any wording issue becomes a follow-up ticket. |

## Done definition (Rafael's bar)

1. Preview screenshots in the PR body: paste → facts filled; plain atajo (Avanzado off); Probar
   bubble for `precio con envío?`. Dark, readable text on white in all three.
2. An owner can go from an empty agent to a working Probar answer using only paste → Guardar →
   Enviar, with zero eng keys or `{{}}` visible.
3. AT-1…AT-12 all checked; lint, build, `test:soft-ai-agent`, `test:chat-harden` green.
4. No change to schema, Soft chrome, staff bot, or agent runtime behavior.
5. `docs/audits/CHANGELOG_AGENTS.md` ledger entry; PR stays **draft** until Rafael says merge.

## Test plan (this PR)

n/a — docs only. `git diff --stat` shows `docs/**` only.
