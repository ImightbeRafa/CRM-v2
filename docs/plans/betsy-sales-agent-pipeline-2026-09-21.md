# Betsy sales-agent pipeline — Costa Rica store (source of truth)

> **Status:** **SOURCE OF TRUTH.** Locked **2026-09-21** by Rafael García in chat with CoS.
> Docs only. No product code. No schema. This file sits **above** the Agent Layer phase
> plans. Those phases implement slices of this pipeline; they do not redefine it.
>
> **Author:** CoS, from the Rafael lock.
>
> **Parents (implementation slices, not this SoT):**
> [`betsy-agent-layer-arc2-fable-2026-09-21.md`](./betsy-agent-layer-arc2-fable-2026-09-21.md)
> (phases A–D) ·
> [`betsy-al2-a1-ux-redo-fable-2026-09-21.md`](./betsy-al2-a1-ux-redo-fable-2026-09-21.md)
> (owner UX for facts / atajos / Probar) ·
> [`betsy-agent-layer-fable-2026-09-21.md`](./betsy-agent-layer-fable-2026-09-21.md)
> (Arc 1 runtime).
>
> **Model lock for implementers:** Cursor Executor = **grok-4.7 high fast**
> (`grok-4.7-high-fast`) only. Never grok-4.5 or any 4.5 alias for coding, planning,
> or verification. Do not merge to `dev` unless Rafael explicitly says merge.

## 1. Status / date / author

| | |
|---|---|
| Locked | 2026-09-21, Rafael García with CoS |
| Kind | Product pipeline source of truth for the sales-layer agent |
| Applies to | Any Costa Rican store on Betsy. No brand is hardcoded (not Forge, not PatchHouse, not PuraSonrisa). |
| This PR | Documentation. Implementers do not start Correos guía creation, a Soft Figma redesign, or staff-bot changes from this file. |

## 2. Goal

A tunable sales-layer agent maps to Betsy inventory, runs a real Costa Rica sales conversation, pauses for a human to verify payment, creates the order only after that approval when the client data is complete, and hands everything after the sale to a person.

## 3. Sales-layer boundary

The agent is a **sales layer**. It is not a post-sale desk and it is not a staff bot.

**The AI handles, in order, until it must stop:**

1. New lead from ads, Instagram, or WhatsApp.
2. Greeting.
3. Location in Costa Rica.
4. Product education.
5. Questions and answers grounded in that product and the store’s brand knowledge.
6. Quote: product price + eligible shipping + payment options that are actually valid for that place.
7. Collect client and order fields from the chat.
8. Payment instructions.
9. Payment-proof pause (one acknowledgement, then quiet, human queue).

**The AI exits the sales layer** when any of these happen:

- The order is done (approved payment, order created, order number sent).
- The customer says some form of “maybe later”, “payday”, or “no thanks”.

Those chats move to the **human follow-up section**. The sales AI does not keep pitching.

**Humans own:**

- Payment verification (approve, reject, fraud, amount mismatch).
- Post-sale tracking, delivery timing, and issues. The agent flags the chat; it does not answer those.
- Any moment a person chooses to stay on the chat or leave it back to the AI.

**Reorder later** may re-enter the sales AI. A returning customer asking “¿dónde va mi pedido?” stays with a human. A returning customer asking to buy again re-enters this pipeline. Recurring discounts are tunable per store; they are not a fixed brand rule.

## 4. State machine

Names below are the product states. Code may store them however it needs to; behavior must match this table. “AI” means the sales agent. “Human” means a store user on the chat. “System” means Betsy after a human approval, not the model deciding that money arrived.

| State | Who acts | What happens | Leaves when |
|---|---|---|---|
| `lead_in` | AI | Inbound from an ad, Instagram, or WhatsApp. Often a price or a “¿dónde?”. | Greeting is sent. |
| `greet` | AI | Costa Rica time of day: buenos días / buenas tardes / buenas noches. Uses the configured presentation name. Says they are from the team of `{store}`. | Location question is sent. |
| `locate` | AI | Asks where in Costa Rica (province, and canton/district when the zone helper needs them). This runs early because it decides shipping eligibility. | A zone can be classified, or the customer chose retiro and the store allows RA. |
| `know_product` | AI | Asks “¿ya conocés {product}?” using the mapped product name, not “el producto”. | Customer says they know it, or they do not. |
| `educate` | AI | Only if they do not know it. Short educational text plus the infographic image. Then asks if they want to buy. | They ask more, or they want to buy, or they exit. |
| `answer` | AI | Further questions from that product’s inventory record and the store’s brand knowledge. | Buying intent, an exit phrase, or an unknown that must be flagged. |
| `quote` | AI | Full total: product price, eligible shipping, and the payment options valid for that zone. If a promotion exists, offer it with its price and the promo image. | Customer accepts a way to pay, or keeps asking, or exits. |
| `collect` | AI | Asks only for client fields that are still empty and that this store requires. | Required slots for the chosen order type are filled. |
| `pay_instruct` | AI | Sends the store’s payment instructions (SINPE, transfer, or another enabled method). | Customer sends payment proof, or says they will pay later (exit). |
| `pay_pause` | AI quiet, human queue | One line: thank you, one moment while we verify. Then the AI stays quiet. | A human approves or rejects. |
| `pay_review` | Human | Staff checks proof against the quote (amount, name, method). | Approve, or reject / fraud / mismatch. |
| `order_commit` | System | Runs only after approve **and** required client/order data is complete. Creates the order, upserts the client, sends the order number. | Confirmation is sent. |
| `sales_exit` | Human follow-up | Sales AI is off. Covers order-done, “maybe later”, “payday”, and “no thanks”. | A later reorder inbound re-enters `greet` (or `quote` if the SKU is already known). |
| `human_control` | Human | Person has the chat: manual stay, reject/fraud, unknown answer, system failure, or a post-sale flag. | Manual leave returns the chat to the sales AI only when the state is still a sales state. Leave does not resume the AI during `pay_pause`, `sales_exit`, or post-sale. |

### Transitions that must not be improvised

- `know_product` → `educate` when the customer does not know the product. `know_product` → `answer` or `quote` when they do.
- `locate` stays put while the zone helper returns no zone because canton or district is missing. Ask for that part. Do not guess GAM vs fuera del GAM.
- `quote` lists only payment methods the store enabled **and** that the zone allows. Contra entrega is omitted when the zone is fuera del GAM.
- `collect` never re-asks a slot already present on the chat or the client record.
- `pay_instruct` is not payment confirmation. Instructions are allowed. “Ya quedó el pago” is not.
- Proof, a confirmation request, a refund, a dispute, or an image that is a comprobante enters `pay_pause`. The customer is not left in `answer`.
- `pay_review` reject, fraud, or amount mismatch → `human_control`. The AI does not negotiate the rejection.
- `pay_review` approve + data still incomplete → `collect` for the missing slots only, then `order_commit`. Do not create a half order.
- `pay_review` approve + data complete → `order_commit` → customer receives the order number → `sales_exit`.
- “Maybe later”, “payday”, “no thanks”, or the same intent in Costa Rican Spanish → `sales_exit` from any sales state.
- After `sales_exit`, tracking / “¿cuándo llega?” / a problem with the delivery stays in human follow-up. The agent flags; it does not answer.
- A human **stay** forces `human_control` immediately. A human **leave** returns to the last sales state only under the rule in the table.

### Quiet criteria (`pay_pause`)

While verification is open:

- Send one acknowledgement. Example shape: “Gracias, un momento mientras verificamos el pago.”
- Do not send another sales question, a new quote, or a second “¿le ayudo con algo?”.
- Do not use confirmation wording: confirmado, verificado, recibimos el pago, pago aprobado, ya quedó.
- Further customer messages stay on the human queue. The AI does not resume the pitch.
- If the system cannot enqueue the human review, notify staff and move to `human_control` with an honest “una persona del equipo le escribe” line. Do not leave the customer in silence with no staff alert.

## 5. Inventory mapping

Each sales agent maps to **one or more** `InventoryItem` rows. Multi-product is normal: PatchHouse patches, PuraSonrisa flavors, color variants. The map is store configuration. The runtime must not special-case those names.

Requirements:

- The agent picks and confirms a SKU before quoting. If several mapped items fit, it asks which one (flavor, color, size) and waits.
- Price, stock, promotion, and images come from **that** inventory row (and the store promotion attached to it), not from a generic brand blurb.
- Never say “el producto” or “nuestro producto” when a mapped item exists. Use the inventory name.
- Out of stock: say so from inventory. Do not offer a date the stock record does not have.
- A price in a shortcut, a pasted FAQ, or a model guess loses to the inventory `sellingPrice`.
- Unmapped stores are not a silent free-for-all. If the agent has no inventory map, it does not invent a catalog; it flags a human.

Today `search_inventory` can look up rows, and it is not a per-agent allowlist. The allowlist is a requirement of this pipeline. This document does not add the column.

## 6. GAM / shipping rules

Shipping eligibility uses the logistics segmentation Betsy already uses for guías. Implementers **copy or extract** that helper. They do not type a new province list.

**Helper to reuse:** `getCorreosAutomatedShippingCost` in `src/lib/correos-gam-pricing.ts`.

- Input: province, canton, district (the same Costa Rica place fields as an EA order).
- Output: `zone` of `gam`, `outside_gam`, or `null`, plus `reason`.
- `null` means the helper cannot classify yet (`Falta canton…`, `Falta distrito…`, `Falta provincia…`). Ask for the missing part. Do not quote a shipping price.

**What the helper’s colones are:** it also returns the Correos automated amounts (`CORREOS_GAM_SHIPPING_COST` 2100, `CORREOS_OUTSIDE_GAM_SHIPPING_COST` 2850). Those are the guía cost table. The **customer-facing** envío is the store’s configured price for the zone the helper picked:

- zone `gam` → `brandFacts.shipping.ea.gamCost` when EA is enabled
- zone `outside_gam` → `brandFacts.shipping.ea.outsideGamCost` when EA is enabled

If that configured cost is missing, do not fall back to 2100 or 2850 unless the store actually saved those numbers. Flag a human instead of inventing envío.

**Order types already in ventas:**

- `EA` — envío a domicilio. Needs province, canton, district, address, and courier (`validateOrderForm` in `src/app/ventas/components/orderFormValidation.ts`).
- `RA` — retiro. Address parts clear and shipping is 0. Offer RA only when `brandFacts.shipping.ra.enabled`.

**Contra entrega:**

- Supported only inside GAM (`zone === 'gam'`) and only when the store enabled it (`brandFacts.shipping.contraEntrega` and/or payment method `contra_entrega`).
- Fuera del GAM: **never offer** contra entrega, even if the store toggle is on.
- Zone `null`: do not offer it yet.
- The GAM helper does not know cash-on-delivery. The product rule is: take its `zone`, then apply this gate. Do not write a second map of cantons.

Retiro and envío copy stay in brand facts (`shippingSummary`). The agent does not hardcode a store address.

## 7. Image rules

Two intents, both tunable per agent, per mapped product, and per intent. Later wiring is `ChatAgentAsset` plus the inventory image. Outbound image send is still an Arc 2 gap (phase A2); the product rule is already this:

| Intent | When | What to send |
|---|---|---|
| Education | `educate`, explaining how the product works | Infographic / educational image for that SKU, plus the short text. |
| Offer | `quote`, when stating price and an active promotion | Promo image for that offer, with the promo price in the text. |

Rules:

- No image for an intent that has no asset. Say the text. Do not describe a picture you did not send.
- Do not put SINPE numbers, IBANs, or QR codes inside images. Payment numbers stay text facts.
- A payment-proof image from the customer is not an asset to “understand”. It enters `pay_pause`.

## 8. Client / order data extraction

Collect from the chat. Persist slots as they appear. Ask only for what is still empty.

**Always required to create an order** (same as `validateOrderForm`):

- Customer name
- Phone
- At least one product line with a confirmed SKU, quantity, and the inventory price

**Also required when the order is EA:**

- Province, canton, district, address, courier

**Required only when this store says so:**

- Email
- Any other `businessInfoFields` entry marked required for that tenant

RA does not ask for the EA address block.

Do not invent a phone, a district, or an email. Empty stays empty until the customer says it or a human fills it. Labeled paste already has a parser (`src/lib/customer-paste.ts`); reuse that path when the message is a labeled block. Free chat still fills the same slots one question at a time.

On `order_commit`: upsert the client, then create the order through the existing order path. The sales AI does not claim the order exists before that write succeeds.

## 9. Payment verification and the reject path

Payment **questions** (“¿cómo pago?”, “¿me pasa el SINPE?”) stay in the sales layer and answer from configured facts when `canSharePaymentFacts` is true. The live classifier is `classifyPaymentText` in `src/lib/soft-ai/payment-classifier.ts` (`payment_info_safe` vs `payment_proof_or_risk`).

Payment **proof** (comprobante, “ya pagué”, “¿ya les llegó?”, refund, dispute, fraud wording) is `pay_pause` → human. The model never decides that money arrived.

| Path | What the customer gets | What staff get |
|---|---|---|
| Proof received | One verification acknowledgement. AI goes quiet. | Human queue item with the quote (SKU, prices, shipping, total) and the proof message. |
| Approve, data complete | Order number and the store’s confirmation shortcut, after the order row exists. | Order created, client upserted, intent closed. |
| Approve, data incomplete | Only the missing fields. Then the order number. | No order until the slots exist. |
| Reject, fraud, or amount mismatch | The human speaks. AI stays off. | `human_control`. No automatic “le devolvemos” and no second payment pitch from the model. |
| Classifier or queue failure | A short handoff line, not silence. | Staff notification. Chat in `human_control`. |

Confirmation wording stays forbidden on every AI line, including shortcuts, the same way the current output validator already blocks it.

**Later phase, not v1 of this sales AI:** creating the Correos guía, the contra-entrega slip, and the retiro slip, plus sending whichever confirmation shortcut the store picked for that fulfillment type. v1 stops at: order exists, client upserted, order number sent, sales AI exited.

## 10. Reorder / recurring

- A completed order ends in `sales_exit`. The next inbound is not automatically a sale.
- Buy-again intent (a mapped product, a price question, “quiero otro”) re-enters the sales AI. Skip slots the client record already has. Still confirm the SKU and the ship-to if they want a different place.
- Recurring discount is a **knob** (on/off, amount or percent, which mapped SKUs, how long after the last paid order). Default off. The agent may mention it only when the knob is on and the inventory/promo price is the one quoted.
- Delivery status on a reorder conversation is still human if that is what they asked. Do not mix a tracking answer into the sales model.

## 11. Tunable knobs

Nothing in this column is a Forge constant. Empty means the agent flags a human instead of guessing.

| Knob | Default | Lives today | Pipeline use |
|---|---|---|---|
| Store name in the greeting | unset | `brandFacts.storeName` | “soy del equipo de {store}” |
| Presentation name | unset | `ChatAgent.introductionNames` | The name in the greeting |
| Greeting clock | America/Costa_Rica | not a sales state yet (Arc 2 phase D is horario) | días / tardes / noches from CR local time |
| Mapped inventory | none | not a per-agent allowlist yet | SKU choice, price, stock, promo, images |
| Educational text | unset | shortcuts / knowledge | `educate` body |
| Infographic asset | none | `ChatAgentAsset` table exists; outbound send is A2 | `educate` image |
| Promo text and price | inventory promotion | inventory + shortcuts | `quote` |
| Promo image | none | same asset gap as infographic | `quote` image |
| EA on/off and GAM / fuera costs | off / unset | `brandFacts.shipping.ea` | Customer envío after the zone helper |
| RA on/off and retiro text | off | `brandFacts.shipping.ra` | Pickup quote, shipping 0 |
| Contra entrega on/off | off | `brandFacts.shipping.contraEntrega`, method `contra_entrega` | Offered only in GAM |
| Payment methods and instructions | none; `shareWithCustomers` false | `brandFacts.payment` | `pay_instruct` and safe payment questions |
| Required extra fields | name + phone; EA address block | `businessInfoFields` + `validateOrderForm` | `collect` |
| Exit phrases | maybe later / payday / no thanks and Spanish equivalents | not a single list yet | → `sales_exit` |
| Recurring discount | off | not built | Reorder quote only |
| Human stay / leave | staff can take a chat (`aiMode`) | conversation `aiMode` | `human_control` vs return to sales |
| Verification quiet | one ack, then silence | payment proof currently escalates; no quiet state | `pay_pause` |

## 12. Probar acceptance conversations

Probar is the WhatsApp sandbox (no real send). Each scenario is a pass only if the reply follows this pipeline. Prices below are fixtures; the asserted price is whatever inventory and brand facts the fixture saved.

1. **Ad, price, inside GAM.** Customer: “Vi el anuncio, ¿en cuánto sale?” Store has one mapped SKU. Agent greets by CR time and store name, asks where in Costa Rica, hears “San José, Escazú”, asks “¿ya conocés {nombre del SKU}?”, gets “sí”, quotes that SKU’s price + configured GAM envío + enabled payment methods. Does not say “el producto”. Does not offer a method the store disabled.
2. **Does not know the product.** “No, ¿qué es?” → short education + infographic (or text only if no asset is configured) + one buy question. No price dump before they want to buy, unless they already asked for the price.
3. **Fuera del GAM, no contra entrega.** “Guanacaste, Liberia.” Quote uses `outsideGamCost`. Contra entrega is absent even when the store toggle is on. SINPE (or whatever else is enabled) is present.
4. **Zone not ready.** “Heredia” only, and the helper needs a canton. Agent asks the canton. It does not pick GAM or fuera, and it does not quote envío yet.
5. **Several SKUs.** Two flavors mapped. “Quiero el de menta.” Agent confirms that SKU and quotes that row’s price, not the other flavor and not a range.
6. **Slots already in the chat.** Customer already wrote name and phone. Agent asks only missing EA fields (canton, district, address). It does not ask the name again. Email is asked only when this store requires it.
7. **Payment proof pause.** “Ya le hice el SINPE” plus a photo. One thank-you / verifying line. No “pago confirmado”. No new pitch. Decision is `pay_pause` for a human.
8. **Reject.** Staff rejects mismatch. The next customer line is not answered by the sales AI. The chat is `human_control`.
9. **Exit.** “Mejor el día de pago” / “tal vez después” / “no gracias”. Agent stops selling. State `sales_exit`. A human follow-up owns the thread.
10. **Post-sale flag.** After an order number was sent, “¿a qué hora pasa Correos?”. Agent does not invent a delivery window. Human flag. Sales AI stays off.
11. **Unknown and outage.** “¿Sirve para mascotas?” with nothing in inventory or brand facts → flag a human, no guessed yes. If inventory or the send path throws → staff notified, customer gets a handoff line, not a hang.
12. **Reorder.** Known client, previous paid order, recurring discount knob on. “Quiero otro.” Agent re-enters sales, confirms the SKU, quotes inventory price with the configured discount, still runs location if the ship-to is unknown. Tracking questions in the same thread stay human.

## 13. Mapping to shipped AL2 phases and the gaps

Shipped on `dev` and **not rewritten here:**

- **AL2-A1 #64 and #66** are live: `brandFacts`, shortcut paste-import (“Cargar desde mis atajos”), WhatsApp Probar, and the payment text classifier (`classifyPaymentText` / proof vs safe payment info).

Still open on the Arc 2 plan, under this pipeline:

| This pipeline | Arc 2 slice | Gap against the lock |
|---|---|---|
| Payment instructions vs proof | A1 classifier (shipped) | Proof becomes a human escalate. It is not yet the quiet `pay_pause` queue. |
| Promo and infographic images | A2 outbound `ChatAgentAsset` | Not shipped. Product rule is already §7. |
| Human verify, approve, reject | B SINPE `ChatPaymentIntent` queue | Not shipped. |
| Create order after approve | C order create | Not shipped. Arc 2 C still has a person click **Crear pedido**. This SoT creates the order once a human has approved payment and the required fields are complete. That click is not the product rule. |
| CR greeting clock, quiet hours | D horario | Clock for días/tardes/noches is part of `greet`. Full after-hours behavior stays phase D. |
| Inventory allowlist, state machine, GAM gate on contra entrega, reorder discount | none | Specified here. Not a phase letter yet. |

Implementers sequence work so each phase still matches this file. A phase that hardcodes one brand, lets the model confirm a payment, offers contra entrega fuera del GAM, or keeps selling after `sales_exit` is wrong even if an older plan paragraph allowed it.

## 14. Explicit non-goals

- Live Correos guía creation in v1 of the sales AI (later phase, after the order exists).
- Contra-entrega slip and retiro slip in that same v1.
- Soft chrome / Figma redesign.
- Staff bot changes (code, webhook, or prompts).
- Hardcoding a brand, a SINPE number, a shipping price, or a SKU list in source.
- A new GAM geography table. Use `getCorreosAutomatedShippingCost`.
- The model approving, rejecting, or “verifying” money.
- Schema or SQL in the PR that adds this document.
- Merging to `dev` without an explicit Rafael GO.
