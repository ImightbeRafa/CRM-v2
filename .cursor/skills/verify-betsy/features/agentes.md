# Agentes contrast

Agentes de chat lets an owner read voice, tools, conocimiento, and the Probar box on a light page. Body text and fields stay dark (slate-900) on the white surface. Opening conocimiento does not reload the document.

## Sub-features

- `agentes-open` shows `Agentes de chat` at `/config/agentes` after sign-in.
- `agentes-sections` shows Identidad, Voz, Herramientas, Modo, Conocimiento, Probar, and Pánico.
- `agentes-contrast` renders the title, section headings, and the Probar textarea in a dark foreground color.
- `agentes-no-remount` opens conocimiento in-page. The document `window` sentinel survives and the path stays `/config/agentes`.

## How to get to it (user POV)

- Sign in, then open `/config/agentes`.
- From Configuración, follow the link to Agentes de chat (`/config/agentes`).

## Driving it with Playwright

Preconditions:

- Doctor state is `READY` for `BETSY_VERIFY_BASE_URL`.
- Session email is `betsyv2.isolated@betsycrm.test` and tenant id is `cmteijij70000jsoyedmtfnl1`.
- The tenant has at least one agent. If the page shows `Todavía no hay agentes`, stop and report data-blocked. Do not click `Sembrar piloto Forge` or `Crear agente` on `www`.

- **Open the page.** Go to `/config/agentes`. Run `page.goto(base + '/config/agentes')` and `page.getByRole('heading', { name: 'Agentes de chat' })`. The heading is visible and the path is `/config/agentes`.
- **Sections.** Require headings `Identidad`, `Voz`, `Herramientas`, `Modo`, `Conocimiento`, `Probar`, and `Pánico`. Each heading is visible.
- **Contrast.** Read computed `color` on the `Agentes de chat` heading, the `Probar` heading, the `Voz` heading, and the textarea under `Probar` (placeholder `Escribí un mensaje de prueba…`). Each foreground is dark: relative luminance below `0.2` and no RGB channel above `90`. Screenshot this state to `evidence/agentes-sections.png`.
- **No remount.** Set `window.__betsyVerifySentinel = 'agentes'`. Click the button `Abrir wizard`. The sentinel is still `'agentes'`, the path is still `/config/agentes`, and the heading `Conocimiento del agente` is visible. Screenshot to `evidence/agentes-wizard.png`.
- **Back.** Click `Volver a agentes`. The heading `Agentes de chat` is visible, the path is `/config/agentes`, and the sentinel is still `'agentes'`.
- **Proof command.** Run `node .cursor/skills/verify-betsy/scripts/drive-agentes-contrast.mjs`. Exit code `0` writes `evidence/proof-agentes-contrast.md` with `mutations: none`.

## Gotchas

- Do not click `Probar (sin Meta)` on `www`. That runs a model turn.
- Do not click Pánico buttons. They confirm and change channel mode.
- Editing Nombre, Voz, or tools PATCHes the agent on blur or click. Do not type into those fields during a read-only proof.
- An empty tenant shows `Todavía no hay agentes` and has no Probar section. That is data-blocked, not a contrast pass.
- Class names `text-slate-900` and `!text-slate-900` support the contract. The pass condition is the computed color, because a dark theme can ignore a missing class and wash the text out.
- `/config/agentes/conocimiento` is a different route. The in-page proof must not land there. Use `Abrir wizard` on `/config/agentes`.
- `src/app/config/loading.tsx` is an empty loading boundary so soft navigations under `/config` do not flash a full-viewport skeleton. A surviving `window` sentinel is the check that the document did not reload.
