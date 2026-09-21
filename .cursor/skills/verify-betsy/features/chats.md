# Soft inbox

Chats is the customer inbox. An owner opens `/chats`, picks a WhatsApp or Instagram thread, and sees the composer at the bottom of the thread. This map checks the current Soft chrome only.

## Sub-features

- `chats-open` shows the Inbox heading and the bucket list.
- `chats-open-thread` selects a conversation and shows that thread.
- `chats-composer` shows the composer textarea after a thread is open.
- `chats-not-staff` does not list the staff bot as a customer thread.

## How to get to it (user POV)

- Sign in and open `/chats`.
- From Canales conectados, follow the `/chats` link in the page intro.

## Driving it with Playwright

Preconditions:

- Doctor state is `READY`.
- Viewport is at least 1280×800 so the desktop list and thread pane are both mounted.
- Do not press `Enviar`. Do not click `Cargar chats DEMO` on `www`.

- **Open inbox.** Go to `/chats`. Run `page.goto(base + '/chats')` and `page.getByRole('heading', { name: 'Inbox' })`. The heading is visible and the path is `/chats`.
- **Buckets.** Buttons `Tus chats`, `Abiertos`, `IA manejando`, `Sin asignar`, and `Hechos` are visible. Click `Abiertos` only to change the client filter. The path stays `/chats`.
- **Open a thread.** Click the first conversation button that has attribute `data-soft-conv-key`. Run `page.locator('button[data-soft-conv-key]').first().click()`. A `textarea` becomes visible.
- **Composer.** The textarea placeholder is one of `Escribí un mensaje… Enter envía · Shift+Enter nueva línea`, `Mensaje… Enter envía`, or `Tomá control o pausá la IA para escribir`. The button `Enviar` is visible. Screenshot to `evidence/chats-thread.png`.
- **Staff bot.** The thread list does not use the staff bot as a row label. Customer rows are WhatsApp or Instagram conversations. If you need the separation statement, `/config/social` says `El bot staff NO aparece aquí` and points inbox traffic at `/chats`.
- **Empty inbox.** If the list shows `Todavía no hay chats` and no `data-soft-conv-key` button, report data-blocked for `chats-open-thread`. `chats-open` can still pass. Do not load demo chats on `www`.

## Gotchas

- Soft Copilot redesign is on hold. Verify this chrome. Do not restyle the inbox as part of a verification run.
- Below the `md` breakpoint the thread pane replaces the list. Use a desktop viewport so the composer and the list can be checked together.
- When the IA is active the textarea is disabled and the placeholder is `Tomá control o pausá la IA para escribir`. A disabled composer is still a visible composer. Do not click `Tomar control` or `Pausar` on `www` just to enable it.
- `Enviar` posts a customer-visible reply. Never click it during verification.
- The staff bot is a separate webhook. It must not be mixed into this inbox. Do not treat a staff-bot chat as a passing thread.
- Search placeholder `Buscar…  ⌘K` is the inbox filter, not the composer.
