# Canales conectados

Canales conectados lists the owner's Instagram and WhatsApp accounts. The page finishes loading and shows either connected accounts or an empty connect state for each network. The staff bot is not one of those channels.

## Sub-features

- `social-open` shows `Canales conectados` at `/config/social`.
- `social-list` finishes loading and shows Instagram and WhatsApp sections.
- `social-not-staff` does not present the staff bot as a connected customer channel.

## How to get to it (user POV)

- Sign in and open `/config/social`.
- From Configuración, open the social / channels entry that routes to `/config/social`.

## Driving it with Playwright

Preconditions:

- Doctor state is `READY`.
- Do not click connect, reconnect, rename, or deactivate. Those mutate Meta tokens or account rows.

- **Open the page.** Go to `/config/social`. Run `page.goto(base + '/config/social')` and `page.getByRole('heading', { name: 'Canales conectados' })`. The heading is visible and the path is `/config/social`.
- **List loaded.** Headings `Instagram` and `WhatsApp` are visible. The text `Cargando…` is gone. Each section shows either a connected-account name or the empty copy `Ninguna cuenta de Instagram todavía. Conectá la primera para empezar.` / `Ningún número de WhatsApp todavía. Conectá el primero para el inbox.` Screenshot to `evidence/social-channels.png`.
- **Staff bot.** The intro contains `El bot staff NO aparece aquí` and a link to `/chats`. Account names in the Instagram and WhatsApp lists are customer channels, not the staff bot webhook.
- **Search.** The textbox `Buscar cuenta` is visible. Do not need to type. Typing only filters the client list.

## Gotchas

- Connecting Instagram or WhatsApp starts OAuth or embedded signup. Do not start it on `www` or Preview during a smoke proof.
- A reconnect banner (`data-testid="social-token-reconnect-banners"`) means a token needs attention. The list still counts as loaded. Do not click reconnect unless the task is explicitly about reconnect and the target is a Preview URL.
- The staff bot webhook may appear in a diagnostics block labeled as internal (`Bot interno (no inbox)`). That line is not a customer channel row. A customer-channel row with the staff bot's name is a failure.
- Empty sections are a valid loaded list for a tenant with no accounts. The isolated QA tenant may have zero channels. Do not connect one to force a row.
