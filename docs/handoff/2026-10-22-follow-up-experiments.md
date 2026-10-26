# Follow-up experiments for every agent — Lane E (2026-10-22)

Rafael: "Follow up needs to be enabled for all active agents, properly set up to experiment, and then use the ones
with the best results, for all agents."

## 1. How follow-ups work today (plain words)

- **What it is.** One extra message to a customer who talked to the agent and then went quiet. Engine:
  `src/lib/soft-ai/follow-up.ts`, run by the chat-automation cron every minute, max 6 sends per run.
- **Campaign.** Stored in the tenant flag `agent_follow_up_v1`: one agent, its lines, **two texts (A and B)**, a wait
  ("silence") in minutes, and an end time (**48 h max**). Created/stopped only by the audited script
  `scripts/agent-pack/follow-up-campaign.ts`.
- **Split.** Each chat gets A or B by a hash of campaign id + chat id: a fair, fixed 50/50. A chat is "claimed" once
  per campaign and never gets a second follow-up (the engine also skips any chat that already had one).
- **Who can get one.** The customer wrote within the last **23 h** (Meta's 24 h window, 1 h margin), the agent wrote
  last, and the chat has been quiet for the wait. Only while the agent is live, inside the agent's **business hours**
  (never at night), with the line answering, the kill switch off and the AI terms accepted.
- **Who never gets one.** A chat a person took over / paused / closed / snoozed; a chat past the early stages; a chat
  with a payment or order alert or a linked order; a chat where the agent handed off or said "Dame un momento"; a
  chat where a person wrote the last message; a customer who asked to stop (opt-out) or said no ("no gracias",
  "más adelante", "lo pienso"…).
- **How results are measured** (script `--report`): sent / failed per text, **replied** (customer wrote within 24 h),
  **ordered** (an order linked to the chat within 7 days, cancelled ones excluded), **₡** of those orders, and
  **opt-outs / no** after the follow-up.

## 2. The 2026-10-18 PatchHouse campaign (`fu-2026-10-18-4d727c`, Sofi, WA + IG)

Ran 2026-10-18 01:04 → 19:04 UTC, wait 90 min. 115 chats claimed, 98 messages delivered, 17 failed (Meta refused;
the reason is not stored).

| Text | Sent | Replied (24 h) | Orders | ₡ | Opt-outs / no |
|---|---|---|---|---|---|
| A "¿Te quedó alguna duda sobre los parches? Si querés, te ayudo a hacer tu pedido 😊" | 48 | **10 (21 %)** | 0 | ₡0 | 0 |
| B "Te cuento que el combo de 2 paquetes a elección sale en ₡22 800 con envío incluido 🚚 ¿Te ayudo…?" | 50 | 2 (4 %) | 1 (2 %) | ₡12 900 | 0 |

- A got **5× more replies** (99 % sure it is better at replies). B's only order was one package (₡12 900), not the
  combo. 1 vs 0 orders is too few to say which one sells more (74 %).
- **No complaints, no opt-outs.** Replies were real buying questions ("¿Cuánto cuesta el GLP-1?", "Sí, quiero
  llevármelo", "Hacen envíos a Escazú", "La otra semana lo pido").
- **93 of 98 went out on Instagram**: the WhatsApp line simply has very few chats in a 23 h window (1 right now vs 20 on
  IG; `--eligible` shows it per line).
- Because the campaign started at night, most follow-ups went out the next morning, **2–19 h** after the customer's
  last message, so the 90 min setting was not the real wait. A real timing test needs per-text waits (Lane D, below).
- Decision: **A ("duda") is the champion**. B ("combo") is retired on replies.

## 3. The standing experiment (per agent)

Each pack has a `follow-up.json`: agent, lines, wait (120 min), round length (48 h), **champion**, a queue of
**challengers**, the texts, and the retired ones with the reason. Each round = champion vs the next challenger, 50/50.

Commands (from the CRM repo, `.env.local` with the prod DB):

```
node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/follow-up-campaign.ts --pack=<pack> --start --dry-run
… --pack=<pack> --start            first round (refuses an agent that is not live, or a plan on_hold)
… --pack=<pack> --rotate           apply the winner rule, then open the next round (run at least every 48 h)
… --compare --root=<packs folder>  every agent side by side with the rule's verdict (read-only)
… --pack=<pack> --eligible         who could get one right now, per line, and why not (read-only)
… --pack=<pack> --report --replies one campaign's numbers and the customers' replies (read-only)
```

Writes lock the flag row (`SELECT … FOR UPDATE`) so the cron's claims are never overwritten, and they never switch
the tenant-wide follow-up flag back on unless `--enable` is passed. A new round stops only that agent's earlier rounds and refuses a line another agent's round is using (several agents
share the DeepSleep tenant).

### The winner rule (`scripts/agent-pack/follow-up-rule.ts`, tests `src/lib/__tests__/follow-up-experiment.test.ts`)

1. **Opt-out guardrail first** (hard opt-outs only — "no me escriban", "STOP", "no quiero bot"; a soft "no gracias /
   más adelante" is shown in the report but never counts, it also matches buying phrases like "ya no puedo dormir").
   A text with ≥ 3 opt-outs and more than 3 % of its sends (or twice the champion's
   rate) is out. If the **champion** breaks it, that agent's follow-ups stop and Rafael is told.
2. **Minimum sample:** 150 chats per text **and** 7 days of rounds actually running (gaps between rounds don't count).
3. **Orders first:** with ≥ 10 orders between the two texts, the challenger wins if it is 95 % sure to sell more;
   the champion keeps if it is 95 % sure to sell more.
4. **Then replies:** if orders can't decide, the challenger wins if it is 95 % sure to get more replies **and** is not
   clearly worse at orders (≥ 20 % chance of being better while there are < 10 orders; ≥ 50 % once there are 10+);
   the champion keeps on the mirror case.
5. **Max:** no clear difference after 600 chats per text → champion stays, challenger retired.
6. After every decision `--rotate` writes the new champion / retired text into `follow-up.json` and opens the next
   round with the next challenger. "Sure" = Bayesian chance with a flat prior (deterministic Monte Carlo).

## 4. Status per agent (2026-10-22)

| Agent | DB status | Plan | Round 1 |
|---|---|---|---|
| Sofi (PatchHouse) WA + IG | live | live | "duda" vs "cual" — **ready; not started yet** (see below) |
| Vale (Sleeping) WA + IG | **live** (ai_full, bound on WA + IG) | live | "duda" vs "pack" — ready; not started yet |
| Laura (Pura Sonrisa) WA | draft | draft | "duda" vs "sabor" — `--start` the moment she is live |
| Dani (Prototipo) WA | draft | draft | "duda" vs "combo" — `--start` the moment she is live |
| Andrés (Forge) WA | draft | on_hold | Rafael's hold; set `status: "draft"` when released |
| Caro (DeepClean) | draft, no line | on_hold | needs a line in `lineIds` + Rafael's release |

**Not started:** the `--start` write for Sofi (and Vale) was blocked by this session's permission check (it makes
the prod cron send real messages). Dry runs are clean. Rafael runs it himself:

```
node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/follow-up-campaign.ts --pack=D:/Coder/betsy-agent-packs/patchhouse --start
node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/agent-pack/follow-up-campaign.ts --pack=D:/Coder/betsy-agent-packs/sleeping --start
```

First sends happen at the next business-hours window (08:00 Costa Rica). Right now `--eligible` shows up to 15 chats for Sofi and
78 for Vale (an upper bound: hours, line and kill-switch checks still apply at send). Check with `--report`.

## 5. Spec for Lane D (engine, `src/lib/soft-ai/follow-up.ts` — Lane E did not touch it)

The script can run champion vs challenger today, but three things Rafael asked for need the engine:

**D1. Standing rounds (no 48 h death).** Today a round dies after `MAX_CAMPAIGN_HOURS = 48` unless someone runs
`--rotate`. Add `standing: true` campaigns: `until` optional; the cron calls the same winner rule once a day (move
`scripts/agent-pack/follow-up-rule.ts` into `src/lib/soft-ai/follow-up-rule.ts` as-is, pure) and on a decision swaps
the texts in place: new champion from the verdict, next challenger from `queue: string[]` in the campaign, retired keys
with reason in `retired`. `stop_agent` sets `active: false` and raises an inbox alert. Keep the atomic claim.
Audit each promotion (`logAudit` FollowUpCampaign).

**D2. Variants with their own wait (timing test: 2 h vs 20 h).** Replace `texts: {A,B}` with
`arms: Array<{ key: string; text: string; delayMinutes: number; weight: number; holdout?: boolean }>` (2–3 arms,
weights sum 100; parse old `{A,B}` campaigns as two 50/50 arms with the campaign's `silentMinMinutes`).
Assignment = `sha256(campaignId:conversationId)` → bucket 0–99 → arm by weight. **Assign at the first moment the
chat is eligible for the SMALLEST delay** and store the claim then (intent-to-treat), so a 20 h arm is not only
shown the chats that stayed quiet 20 h. At send time re-run every skip check; if the customer wrote meanwhile, or the
23 h window / business hours run out before the arm's delay, mark the claim `resolved` / `expired` (no send) — it
still counts in that arm's denominator. A 20 h arm only sends when the 20–23 h mark falls inside business hours
(08:00–20:00), so many of its chats will expire; the report must show `expired` per arm.

**D3. Holdout.** One arm `{ key: 'holdout', holdout: true, weight: 10 }`: claimed, never sent. The report measures
orders / replies for it from the claim time, so we see what follow-ups add over doing nothing. Rule addition: if the
champion's order rate is not above the holdout's after 300 holdout chats, flag it to Rafael (follow-ups may only be
pulling forward orders that would happen anyway).

**D4. Claim record.** `claimed[convId]` becomes `{ v: string; at: ISO; state: 'assigned'|'sent'|'failed'|'resolved'|'expired'; sentAt?: ISO; err?: string }`
(parse the old `'A'` / `'A!'` strings). `err` = Meta's error code: 17 of 115 sends failed on 10-18 with no reason kept.

**D5. Opt-out auto-pause.** If an arm reaches ≥ 3 opt-outs and > 3 % of its sends, pause that arm right away (don't
wait for the daily rule).

**D6. "Already bought" across channels.** `has_order` only looks at orders linked to this chat. Also skip when the
same client (clientId / phone) has an order in the last 30 days.

**D7. Two short bubbles.** Optional `text2` per arm sent as a separate bubble after 1–2 s (house style: short separate
bubbles), counted as one follow-up.

Tests to add with it: weighted split ±5 % over 1 000 ids; ITT (a chat that replied before its 20 h send stays in the
arm's denominator); holdout never calls `sendMetaText`; legacy `{A,B}` config parses; promotion is idempotent.

## 6. Known gaps

- The flag's config grows by one campaign (with its claims) per agent per round, and the cron reads it every minute.
  D1 (standing rounds in place) fixes it; until then prune stopped campaigns older than ~30 days by hand.
- Checking the running totals at every `--rotate` ("peeking") makes the real false-win rate a bit above 5 %.

- Orders count only when linked to the chat (the agent's flow links them; a manual order typed elsewhere is missed).
- 2026-10-26: the cron renews a live agent's round that ran out on its own (same texts, 48 h; stopped by the opt-out guard
  instead when a text crosses it). `--rotate` is still how a new winner / challenger gets picked.
- "envio" challengers say **2 a 3 días hábiles**; use them only after the live agent itself says 2–3 days (Lane C's
  shipping rules), otherwise the follow-up and the agent contradict each other.
