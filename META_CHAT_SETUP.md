# Meta Chat Setup Runbook

This app uses the official Meta Graph API path for both customer-facing channels:

- WhatsApp: WhatsApp Cloud API, routed by `phone_number_id`.
- Instagram: Messenger API support for Instagram, routed by the Instagram Business account id.

**Two products, two Meta apps, two webhooks.** Never share callbacks.

| Product | Meta app | Callback | Audience |
|---|---|---|---|
| CRM inbox IG | Existing `META_APP_ID` app | `{NEXTAUTH_URL}/api/chat/webhook` | Instagram customers |
| CRM inbox WA | Dedicated Inbox WA app (`META_WA_APP_ID`) | same `{NEXTAUTH_URL}/api/chat/webhook` | WhatsApp customers (Forge, etc.) |
| Staff AI assistant | Staff app (e.g. live `1514613536240301`) + `WHATSAPP_*` | `{NEXTAUTH_URL}/api/bot/whatsapp/webhook` | Internal team |

HMAC on `/api/chat/webhook` accepts `META_APP_SECRET`, `META_WA_APP_SECRET`, and optional `INSTAGRAM_APP_SECRET`.

Owner diagnostic: `GET /api/chat/meta-status` (also rendered on `/config/social`). It reports which env vars are set without leaking secrets.

## Betsy URLs

Production `NEXTAUTH_URL` must be the **www** host (the apex hostname 307s to www). Use that exact origin in Meta, not the apex. Canonical readiness URLs default to the www production origin when `NEXTAUTH_URL` is unset.

- Unified chat webhook callback: `{NEXTAUTH_URL}/api/chat/webhook`
- Instagram OAuth redirect: `{NEXTAUTH_URL}/api/auth/instagram/callback`
- Instagram data deletion callback: `{NEXTAUTH_URL}/api/auth/instagram/data-deletion`
- Data deletion instructions: `{NEXTAUTH_URL}/data-deletion`
- Privacy / Terms: `{NEXTAUTH_URL}/privacy` · `{NEXTAUTH_URL}/terms`
- Social account configuration: `{NEXTAUTH_URL}/config/social`
- Chat inbox: `{NEXTAUTH_URL}/chats`

Instagram Login scopes requested by Betsy (needed because the callback calls `GET /me/accounts` then subscribes the Page):

`instagram_basic`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `business_management`

## Environment Variables

Set these in Vercel/production and local development as needed:

```bash
META_APP_ID=
NEXT_PUBLIC_META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
NEXT_PUBLIC_META_GRAPH_API_VERSION=v24.0
META_GRAPH_API_VERSION=v24.0
NEXT_PUBLIC_FB_LOGIN_CONFIG_ID=   # WhatsApp Embedded Signup config (on CRM WA Meta app)
NEXT_PUBLIC_IG_LOGIN_CONFIG_ID=   # optional Instagram Login for Business config

# Dedicated CRM WhatsApp Inbox Meta app (recommended in production)
META_WA_APP_ID=
NEXT_PUBLIC_META_WA_APP_ID=
META_WA_APP_SECRET=
```

If `META_WA_*` are unset, WA connect falls back to `META_APP_*` (single-app / local). Production should set the dedicated WA Inbox app so staff app `1514613536240301` stays isolated.

Backward-compatible verify token names still work, but new installs should use
`META_WEBHOOK_VERIFY_TOKEN` for the unified `/api/chat/webhook`. A live GET
verify on that route can succeed using the staff-bot `WHATSAPP_VERIFY_TOKEN`
fallback, so seeing a configured webhook does not prove the inbox-specific
token is set.

For the separate Betsy AI WhatsApp assistant bot, keep using:

```bash
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
```

The bot webhook and the CRM inbox webhook are separate products on **separate Meta apps**:

- `/api/chat/webhook` receives client IG + CRM WA messages (HMAC: META_APP_SECRET + META_WA_APP_SECRET + optional INSTAGRAM_APP_SECRET).
- `/api/bot/whatsapp/webhook` receives internal staff assistant messages via staff `WHATSAPP_*` env — never point CRM WA at this callback, and never point staff at `/api/chat/webhook`.

## Meta App Checklist

1. Create or open the Betsy Meta Business app in Meta for Developers.
2. Add the WhatsApp product.
3. Add/configure the Messenger product for Instagram messaging.
4. In app settings, set the app domain to your Betsy domain.
5. Add valid OAuth redirect URI: `https://YOUR_DOMAIN/api/auth/instagram/callback`.
6. Set the webhook callback URL to `https://YOUR_DOMAIN/api/chat/webhook`.
7. Set the webhook verify token to the exact value in `META_WEBHOOK_VERIFY_TOKEN`.
8. Subscribe webhook fields:
   - WhatsApp: `messages`.
   - Instagram: `messages`, plus message reaction/read fields later if the CRM needs them.
9. Enable App Secret Proof in Meta app settings after confirming `META_APP_SECRET` is configured.
10. Put the app in Live mode only after business verification, permissions, and test messages pass.

## WhatsApp Setup

1. In Meta Business Settings, create a System User.
2. Assign the System User access to the WhatsApp Business Account.
3. Generate a System User access token with:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
4. In Meta's WhatsApp API setup, copy:
   - Phone Number ID
   - WhatsApp Business Account ID
5. In Betsy, go to `/config/social` and link WhatsApp with:
   - Phone Number ID
   - WhatsApp Business Account ID
   - System User access token
6. Click re-subscribe if you rotate tokens or reconnect the WABA.
7. Send a WhatsApp message from a real customer/test phone to the connected number.
8. Confirm it appears in `/chats`.

## Instagram Setup

1. Convert the Instagram account to a professional Business account (**Empresa**, not Creator).
2. Link that Instagram account to a Facebook Page.
3. Make sure the Meta user connecting from Betsy has **admin** access to the Page.
4. If the Meta app is in Development mode, that user must be app Admin/Developer/Tester.
5. Optional: create a Facebook Login for Business configuration and set `NEXT_PUBLIC_IG_LOGIN_CONFIG_ID` so the OAuth dialog shows Meta’s Page + IG asset picker.
6. In Betsy, go to `/config/social` and click **Conectar Instagram**.
7. If Meta returns zero Pages, follow the Spanish troubleshooting on the callback page (wrong FB user, missing Page admin, IG not Empresa-linked, Dev-mode tester).
8. Send a DM from another Instagram account to the Business account.
9. Confirm the linked account on `/config/social` and that it appears in `/chats`.

## App Review Notes

Expected permissions for the CRM inbox:

- WhatsApp: `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`
- Instagram: `instagram_basic`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `business_management`

For review, prepare a short screen recording that shows:

1. User opens `/config/social`.
2. User connects Instagram or WhatsApp.
3. A customer sends a message.
4. Message appears in `/chats`.
5. Betsy sends a human reply from `/chats`.
6. Customer receives the reply in Instagram or WhatsApp.

## Operational Rules

- Do not use temporary WhatsApp tokens in production.
- Keep `META_APP_SECRET` server-only.
- Use the unified `/api/chat/webhook` callback for the CRM inbox.
- Expect Meta to send delivery/read/status events; the inbox stores only actual customer messages.
- WhatsApp free-form replies should happen inside the customer service window. Use approved templates to initiate or re-open conversations outside the window.
- Instagram cannot be used to message arbitrary users first; the customer needs to start the DM thread.
- If webhooks verify but real messages do not arrive, re-check app Live mode, field subscriptions, WABA/Page app subscriptions, app review permissions, and whether the sending test user is allowed while the app is in Development mode.
