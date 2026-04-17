# Meta Chat Setup Runbook

This app uses the official Meta Graph API path for both customer-facing channels:

- WhatsApp: WhatsApp Cloud API, routed by `phone_number_id`.
- Instagram: Messenger API support for Instagram, routed by the Instagram Business account id.

## Betsy URLs

Replace `https://YOUR_DOMAIN` with the production domain in `NEXTAUTH_URL`.

- Unified chat webhook callback: `https://YOUR_DOMAIN/api/chat/webhook`
- Instagram OAuth redirect: `https://YOUR_DOMAIN/api/auth/instagram/callback`
- Instagram data deletion callback: `https://YOUR_DOMAIN/api/auth/instagram/data-deletion`
- Social account configuration: `https://YOUR_DOMAIN/config/social`
- Chat inbox: `https://YOUR_DOMAIN/chats`

## Environment Variables

Set these in Vercel/production and local development as needed:

```bash
META_APP_ID=
NEXT_PUBLIC_META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
NEXT_PUBLIC_META_GRAPH_API_VERSION=v24.0
META_GRAPH_API_VERSION=v24.0
NEXT_PUBLIC_FB_LOGIN_CONFIG_ID=
```

Backward-compatible verify token names still work, but new installs should use
`META_WEBHOOK_VERIFY_TOKEN` for the unified `/api/chat/webhook`.

For the separate Betsy AI WhatsApp assistant bot, keep using:

```bash
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
```

The bot webhook and the CRM inbox webhook are separate products:

- `/api/chat/webhook` receives client messages for the CRM inbox.
- `/api/bot/whatsapp/webhook` receives internal team assistant messages.

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

1. Convert the Instagram account to a professional Business account.
2. Link that Instagram account to a Facebook Page.
3. Make sure the Meta user connecting from Betsy has admin access to the Page.
4. In Betsy, go to `/config/social` and connect Instagram.
5. Complete Facebook Login and grant messaging permissions.
6. Send a DM from another Instagram account to the Business account.
7. Confirm it appears in `/chats`.

## App Review Notes

Expected permissions for the CRM inbox:

- WhatsApp: `whatsapp_business_management`, `whatsapp_business_messaging`
- Instagram: `instagram_manage_messages`
- Depending on Meta's current review flow, Page/Messenger permissions may also be requested for the Instagram Page subscription path.

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
