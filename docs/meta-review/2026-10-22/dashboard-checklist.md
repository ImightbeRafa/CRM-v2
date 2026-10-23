# What only Rafael can do (Meta dashboard and prod)

Do these in order. Each step says where to click and how to check it worked. Nothing here was done by Claude.

## A. Before you submit

1. **Ship the code and SQL** (Release 1, your GO).
   - Apply `supabase/migrations/058_meta_data_deletion.sql` (`BETSY_V2_APPLY_FILES=058`). It adds the "who connected
     this line" column and the deletion-request table, and changes no existing data. The code works before and after it,
     but the deletion status page shows real progress only once 058 is applied.
   - Deploy this branch to Cloudflare.
   - Check: https://www.betsycrm.com/privacy shows "Version 2026-10-22", and /data-deletion shows the
     "Desconectar o eliminar" section.
2. **Business Verification.** business.facebook.com → Security Center → Business verification must say *Verified* for
   the portfolio that owns app 1038331905909624. Advanced access needs it.
3. **App settings → Basic** (developers.facebook.com/apps/1038331905909624/settings/basic):
   - Privacy Policy URL: `https://www.betsycrm.com/privacy`
   - Terms of Service URL: `https://www.betsycrm.com/terms`
   - User data deletion: choose **Data deletion callback URL**:
     `https://www.betsycrm.com/api/auth/instagram/data-deletion`
   - App icon, category (Business and pages) and contact email filled in.
4. **Facebook Login for Business → Settings**:
   - Deauthorize callback URL: `https://www.betsycrm.com/api/auth/meta/deauthorize` (new).
   - Data deletion request URL: the same callback as above.
5. **Instagram login configuration** (Facebook Login for Business → Configurations → the config whose id is in
   `NEXT_PUBLIC_IG_LOGIN_CONFIG_ID`): add the permission **instagram_manage_events** next to the ones already there
   (instagram_basic, instagram_manage_messages, pages_show_list, pages_read_engagement, pages_manage_metadata,
   pages_messaging, business_management). Save.
6. **WhatsApp Embedded Signup configuration: must be v4 — do this BEFORE deploying this branch.** If the old
   configuration is still in `NEXT_PUBLIC_FB_LOGIN_CONFIG_ID` when the v4 launch code ships, WhatsApp connect may stall. Meta deprecated Embedded Signup v2/v3 on 2026-10-15. Since
   PR "meta review kit" Betsy launches the v4 way (no `sessionInfoVersion`; coexistence still on), and in v4 **the version
   comes from the configuration**:
   - Facebook Login for Business → Configurations → **Create configuration** → login variation **WhatsApp Embedded
     Signup** (or the template "WhatsApp Embedded Signup Configuration With 60 Expiration Token"), product **WhatsApp
     Cloud API** (plus the WhatsApp Business app onboarding/coexistence option if offered).
   - Permissions: whatsapp_business_management, whatsapp_business_messaging, business_management and
     **whatsapp_business_manage_events**.
   - Copy the new configuration id into `NEXT_PUBLIC_FB_LOGIN_CONFIG_ID`. It is baked into the browser bundle, so this
     needs a **rebuild + deploy** (not only a Worker variable).
   - Test once: Config › Cuentas conectadas → **Agregar línea** with a test number, including a WhatsApp Business app
     number (coexistence). If the popup errors, tell Claude the exact message.
7. **Marketing API Access Tier.** App Dashboard → Marketing API → Access tier. Both events permissions need it. Meta's
   page says the bar is about 500 to 1,500 successful Marketing API calls in 15 days with under 10% errors (the
   number changed recently, so check the figure on the dashboard). If the tier is still Limited/Standard, request the
   upgrade there. Betsy's own dataset and event calls count once businesses turn the feature on.
8. **Test users for the reviewer.** Follow [reviewer-instructions.md](reviewer-instructions.md) §1: create the Betsy test
   login, connect your own test Instagram account and WhatsApp number to it, and add the reviewer as an Instagram tester
   if Meta asks for one.
9. **Record the screencasts** with [screencast-script.md](screencast-script.md). One video per permission is fine, or one
   long video with chapters. Show the permission dialog on each.
10. **Human Agent switch (for Video 5).** Set `META_IG_HUMAN_AGENT=1` as a Cloudflare Worker variable. The Worker now
   passes it to the app (`CONTAINER_ENV_KEYS`), so this needs the Worker deployed with this branch first; the value takes
   effect on the next container start. Effect for every business: a person answering an Instagram chat 24 h–7 days
   after the customer's last message sends with the HUMAN_AGENT tag; until Meta approves it they see a clear "not
   approved yet" message instead of Meta's raw error (nothing is sent either way). After 7 days Betsy refuses.
11. **Fill App Review → Permissions and features**: request advanced access for `whatsapp_business_manage_events`,
   `instagram_manage_events` and the **Human Agent** feature (human_agent), and confirm the existing ones. Paste the texts from [permissions.md](permissions.md), upload
   the videos, and answer Data Handling with [data-handling-answers.md](data-handling-answers.md).

### Demo data for the recording (optional)

Create the test business yourself in Betsy (never by script) and connect its test lines. Then fill it with demo
products, customers, orders and demo chats, all marked "[DEMO]":

```
node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs scripts/meta-review-demo-seed.ts --tenant=<slug>
```

That is a dry run (prints the plan). To write, add `--apply` with `META_DEMO_CONFIRM_TENANT=<slug>`; to remove,
`--cleanup` with the same variable. It refuses a business with more than 20 real orders. Demo chats can't send
anything (Betsy refuses `demo-` customers) and are never reported to Meta. For the ad → event part of Video 3 use real ad
chats (reviewer-instructions §1.6).

## B. After approval

- **Human Agent**: keep `META_IG_HUMAN_AGENT=1` (set in A.10). If Meta rejects Human Agent, set it back to empty: human
  replies after 24 h then go out as before and Meta's refusal shows as a clear message.

1. Reconnect each business's lines once so the new permission is on their token. In Betsy: Configuración › Cuentas
   sociales → Conectar Instagram again (same account) and, for WhatsApp, run Embedded Signup again. Until then the card
   says "Falta permiso: reconectá Instagram/WhatsApp". Messaging keeps working.
2. Owners who already turned on "Ventas por anuncios (Meta)" accepted a WhatsApp-only notice. The card asks them to
   accept the updated one ("Aceptar e incluir Instagram"). WhatsApp keeps sending meanwhile.
3. The sender stays off until `META_SALES_CAPI_SENDER=1` is set on Cloudflare. It may already be on for WhatsApp.

## C. Decisions only you can make

- **A deletion request from one admin deletes the chats of the lines that admin connected**, even if the business has
  other admins (Meta's rules: delete the data obtained through that person). SecureDog rated this High, so it is softened:
  the lines are disconnected at once, the owner gets an email, and the erase runs only 3 days later. If the owner
  reconnects in that time, nothing is erased automatically: the request goes to manual review (an alert reaches the ops
  error list) and support finishes it within 30 days. The business always keeps its agents, saved replies, orders and
  customers. Accept this, or say if you want a different wait.
- **WhatsApp lines and the deletion callback.** Betsy remembers which Facebook user connected each line (at connect, and a
  nightly backfill for older lines).
  For WhatsApp, Embedded Signup's token may belong to a system user rather than the person, so a deletion request might
  not find a WhatsApp line. Test once with a test WhatsApp signup (remove the app in Facebook settings, then check
  /data-deletion?code=…). If it says "Sin datos", WhatsApp deletion stays manual through support@betsycrm.com, which the
  policy already offers.
- **AI terms text** (`src/lib/soft-ai/ai-terms.ts`, Lane D) says the agent sends message text, name, context and order
  status to OpenAI. That is still true (it sends no images or audio), so it was **not** changed and no re-acceptance is
  needed. If the agent ever starts reading customer photos or voice notes, the AI terms version must be bumped, which
  pauses live agents until each owner accepts again.
- **Upstash region**: the policy says United States. Confirm in the Upstash console that the Redis database is in a US
  region; if not, tell Claude the region and the policy line changes.

## D. Support runbook: manual deletion requests

The status page tells people with "no automatic match" or "manual review" to email support@betsycrm.com with their
code. **The code proves nothing about who owns an account.** Before erasing anything by hand:

1. Confirm that the person controls the Instagram or WhatsApp account. For example, ask them to send a message from it to
   the business line, or to write from the email registered on the Betsy account.
2. If the line belongs to a business with other admins, get the business owner's confirmation by email.
3. Erase within 30 days of the request, and reply with what was deleted. Backups roll over 14 days later.
4. For a "manual review" request (the business reconnected during the 3-day wait), ask the owner first. If they keep
   the line, delete only what came through the requester's connection, or record why nothing was deleted.
