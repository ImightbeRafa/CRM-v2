# Spec for Lane D: plug AI credits + the business limit into the live AI allowance

Owner of the change: **Lane D** (`src/lib/soft-ai/**`). Lane H (AI credits, SQL 060) does not edit soft-ai.
Status: Lane H ships `resolveCreditAllowance()`; nothing pauses on credits until this hook is wired **and** the
owner turns on "Pausar la IA al llegar al tope" in Logística › Admin › IA.

## What exists (Lane H, branch `claude/wave-ai-credits-4ad5c6`)

```ts
import { resolveCreditAllowance } from '@/lib/ai-billing/allowance'

type CreditAllowance = {
  source: 'credits'
  enforce: boolean            // false before SQL 060, with enforcement off, or for exempt tenants
  exhausted: boolean          // true only when enforce && (free+prepaid credit used up || own limit reached)
  cap: 'credit' | 'limit'
  periodKey: string           // Costa Rica month, same as ai-allowance
  renewsAt: Date | null       // start of next CR month
  remainingListMicros: number | null  // in AiUsageEvent.costMicros units (list price), floor
}
```

- Same contract as your budget source: soft cap, read once before a turn, cached 30 s (5 s when < $0.05 left),
  **fails open** (last known value, else not enforced), never throws.
- Counts only billable features (`inbox_agent`, `payment_check`, `vision`, `customer_paste`, `agent_import`,
  `shortcut_import`). Staff bot, agent tests / Probar and templates never count and must never be gated by it.
- Exempt = `exemptTenantIds()` from your `ai-allowance.ts` (same env `AI_ALLOWANCE_EXEMPT_TENANTS`).

## The change (small)

In `src/lib/soft-ai/ai-allowance.ts`:

1. `AiAllowanceSource` gets `'credits'`.
2. In `resolveAiAllowance(tenantId, now)` after the exempt early return, resolve both sources and return the
   **tightest exhausted one** (exempt still wins):

```ts
const [budgetAllowance, credits] = await Promise.all([
  resolveBudgetAllowance(tenantId, now),        // today's body, unchanged
  resolveCreditAllowance(tenantId, now),        // never throws, fails open
])
if (budgetAllowance.exhausted) return budgetAllowance
if (credits.enforce && credits.exhausted) {
  return {
    source: 'credits',
    enforce: true,
    limitMicros: null,
    spentMicros: budgetAllowance.spentMicros,
    remainingMicros: 0,
    periodKey: credits.periodKey,
    renewsAt: credits.renewsAt,
    exhausted: true,
  }
}
return budgetAllowance
```

3. Where the allowance stops a live reply (`agent-claim-gates.ts`, `waiting-sweep.ts`), keep the current hand-off
   (chat goes to a person, no half reply). Suggested internal note for the person: `credits` + `cap === 'limit'` →
   "Se alcanzó el límite mensual de IA del negocio"; `cap === 'credit'` → "Sin crédito de IA (recargá en
   Configuración › Uso de IA)".
4. Tests: one case per source in `ai-allowance.test.ts` (credits exhausted pauses, credits not enforced never
   pauses, exempt wins over credits, credits read error fails open).

## Follow-ups (not in this change)

- Gating non-agent AI (customer paste, vision, payment check) on credits: today the allowance only gates agent
  claims. Spec separately if Rafael wants regular accounts' helpers paused when the free credit is used.
- Alert emails at 80 / 100 % (the usage page shows banners today).
