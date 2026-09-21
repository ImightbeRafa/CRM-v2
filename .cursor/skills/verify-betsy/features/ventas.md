# Ventas

Ventas is the sales workspace. Opening it shows the sales screen rather than a 404 or the sign-in page.

## Sub-features

- `ventas-open` loads `/ventas` for a signed-in owner.
- `ventas-not-404` stays on `/ventas` and shows the sales dashboard.
- `ventas-add-visible` shows the add-order control. Do not submit an order on `www`.

## How to get to it (user POV)

- Sign in and open `/ventas`.
- From the app shell, choose the Ventas navigation entry.

## Driving it with Playwright

Preconditions:

- Doctor state is `READY`.
- Permission `view_sales` is on the isolated owner session. A redirect to `/unauthorized` is a failed open, not a skip.
- Do not create an order. Pickup (`Retiro (RA)`) is the smallest form, and it still writes an order on the shared database.

- **Open the page.** Go to `/ventas`. Run `page.goto(base + '/ventas')`. Wait until the path is `/ventas` and the document is not the sign-in page. The response is not a 404 page.
- **Dashboard.** The text `Historial de Ventas` is visible. Screenshot to `evidence/ventas.png`.
- **Add control.** The button `Agregar orden` is visible. Do not click it on `www`. On a Preview URL, clicking it may open the form; closing it without submit is still a write-risk if the form autosaves. Leave it unclicked unless the task is the order form and the target is Preview.

## Gotchas

- Unauthenticated visitors are redirected to `/auth/signin`. A proof that stops on the sign-in page does not pass `ventas-open`.
- `/ventas` is in this map. Logistics pages are not. Do not continue into `/logistica` or workforce screens.
- `Historial de Ventas` is the dashboard card title, not a heading role. Match it as text.
- Creating an order writes to the shared order tables. Read-only smoke stops at the loaded page.
