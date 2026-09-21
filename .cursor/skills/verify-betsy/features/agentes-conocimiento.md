# Conocimiento wizard

Conocimiento lets an owner paste and review approved brand or policy text from the agentes page. The wizard opens on the same page. The address bar stays `/config/agentes`.

## Sub-features

- `conocimiento-open-wizard` opens the wizard from `Abrir wizard` without leaving `/config/agentes`.
- `conocimiento-open-card` opens the wizard from a checklist card (`Precios`, `Envíos`, `Ofertas`, `Políticas`) with the same URL.
- `conocimiento-back` returns to `Agentes de chat` through `Volver a agentes` without a document reload.
- `conocimiento-steps` shows the paste step `1. Pegar texto` and the heading `Conocimiento del agente`.

## How to get to it (user POV)

- On `/config/agentes`, in the Conocimiento section, choose `Abrir wizard`.
- On the same page, choose a checklist card (for example `Precios`).

## Driving it with Playwright

Preconditions:

- Doctor state is `READY`.
- `/config/agentes` shows heading `Agentes de chat` and heading `Conocimiento`.
- Do not approve, reject, or create a knowledge draft on `www`.

- **Wizard button.** From `/config/agentes`, set `window.__betsyVerifySentinel = 'agentes'`. Click `Abrir wizard`. Run `page.getByRole('button', { name: 'Abrir wizard' }).click()`. The path is `/config/agentes`, the sentinel remains, and heading `Conocimiento del agente` is visible.
- **Paste step.** The button `1. Pegar texto` is visible. A textbox for the source body is on the page. Do not fill it during a read-only proof.
- **Card entry.** Click `Volver a agentes`, then click the button whose name includes `Precios`. The path is still `/config/agentes` and heading `Conocimiento del agente` is visible again.
- **Back.** Click `Volver a agentes`. Heading `Agentes de chat` returns and the path is `/config/agentes`.
- **Proof.** Screenshot the open wizard to `evidence/conocimiento-wizard.png` before going back. The note records the path before and after the click.

## Gotchas

- The standalone route `/config/agentes/conocimiento` renders the same wizard component without the in-page back callback. A proof that navigates there does not prove the in-page panel.
- `Abrir wizard` passes no card id. A checklist card passes that card's id. Both must keep the URL on `/config/agentes`.
- Buttons that create or approve a draft write knowledge rows. Do not click them on `www`.
- If the page shows `SQL 028 aún no aplicado`, the wizard can still open. Creating a draft will fail. Opening the wizard is still the proof for this feature.
- Dark text uses the same light-surface classes as agentes (`!text-slate-900` on fields). If you check contrast here, use computed color the same way as `agentes-contrast`.
