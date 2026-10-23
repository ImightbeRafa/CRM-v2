# Data handling questions: answers

These answers match the privacy policy at https://www.betsycrm.com/privacy (version 2026-10-22). If the policy changes,
change these answers too.

## Where the data is (servers)

- Database and chat files: **Supabase on AWS us-east-1 (United States)**.
- App hosting: **Cloudflare** Workers + Containers (Cloudflare's global network); private backups on Cloudflare R2,
  kept 14 days.
- No servers of our own; no copies outside the providers below.

## Data processors / service providers

**Do you have processors or service providers that will have access to the Platform Data you get from Meta?** Yes.

| Provider | What it does for Betsy | Platform Data it can access | Region |
|---|---|---|---|
| Supabase (on AWS) | Database and private file storage | All stored messages, media, account ids, encrypted tokens | United States (us-east-1) |
| Cloudflare | Hosting (Workers + Containers), network, private backups (R2, 14 days) | Data in transit; database backups | Global network; backups US |
| Railway | Test (preview) copy of the app on the same database | Same as the app when used | United States |
| OpenAI | AI features the business turns on (inbox agent text, payment-claim check; staff assistant) | Customer message text and display name, recent conversation text, order status (masked card / account / ID numbers). No customer photos or audio from the inbox. | United States |
| Upstash | Rate limits, short-lived connection step (Instagram page picker, 10 min) | Encrypted pending connection record; no messages | United States |

Not processors of Platform Data: Resend (service email), Tilopay (subscription billing), Correos de Costa Rica
(shipping), Telegram (staff assistant), Google (sign-in). They get no Instagram or WhatsApp data from Meta, except that a
business's own staff assistant can look up orders that started in a chat.

## Responsible entity

**Who is responsible for the Platform Data?** Rafael Garcia Montoya (Betsy CRM), Costa Rica. Contact:
support@betsycrm.com. Each business that connects its account controls its own customers' data; Betsy processes it on the
business's behalf.

**Country:** Costa Rica.

## Requests from public authorities

**In the past 12 months, have you given Platform Data to public authorities in response to national security requests?**
No.

**Which policies or processes do you have for requests from public authorities?** (tick all that apply)

- We require a valid legal process (court order or equivalent) before we disclose anything.
- We review each request for legality and challenge it if it is unlawful, too broad or not properly served.
- We disclose the minimum data needed to comply.
- We keep a record of every request and our answer.
- We tell the affected business, unless the law forbids it.

## Other answers (if asked)

- **Do you sell, license or buy Platform Data?** No.
- **Do you use Platform Data for advertising, profiling, or to train AI models?** No. Ad sales events go only to the
  business's own Meta dataset, on its behalf, when it turns that on.
- **Do you share Platform Data with other parties?** Only with the processors above, to run the service, and with Meta
  (the business's own dataset).
- **How do users delete their data?** In Facebook/Instagram settings → remove Betsy → ask for deletion. Meta calls
  https://www.betsycrm.com/api/auth/instagram/data-deletion; we disconnect that person's lines at once, tell the business owner, and 3 days later delete the conversations, messages, media, ad referrals
  and AI records of the lines that person connected, and return a status page
  (https://www.betsycrm.com/data-deletion?code=…). Or by email to support@betsycrm.com. A whole account is erased by
  hand within 30 days.
- **Retention** (same as https://www.betsycrm.com/privacy §7):
  - Access tokens: deleted at once when the business disconnects or removes Betsy in Facebook/Instagram.
  - Conversations, messages and chat media: kept for the business while its account exists (also after a disconnect);
    deleted by a deletion request (§8) or an account erase.
  - AI agent outputs: 90 days. WhatsApp ad click id (ctwa_clid): 90 days. Staff assistant short-term memory: 7 days.
  - Notifications: 90 days once read, 180 if unread. Workspace activity history: 395 days.
  - Security logs (sign-ins, IP): while the account exists; deleted with an account erase.
  - Backups: 14 days. Data held by OpenAI for the API: up to 30 days (abuse monitoring only).
- **Security.** HTTPS everywhere, tokens encrypted at rest, each business's data isolated, private storage, access limited
  to what the service needs.
