# PatchHouse on Instagram — first live test (deploy 1 = `claudio/luna-10`)

Goal: Sofi (PatchHouse ventas) answers the ~58 Instagram chats waiting on @patchhouse.cr (all inside the 24 h
window; oldest ≈ 12 h on 2026-10-17 morning), on Luna with every luna-10 fix, and hands to a person whatever she
must not handle (payment claims, receipts, refunds, health alarms, wholesale, complaints).

Rafael runs every step marked **YOU**. Nothing here was run by Claude. Deploy 2 (Grok removal + SQL 054) and the
staff bot come later and are not needed for this test.

## 0. Before (Claude, done 2026-10-17)

- `claudio/luna-10` contains everything live: `e2b9fd2c`, release `1b37f820` and `21142b06` (knowledge map) are
  ancestors → no rollback. Last Cloudflare upload: 2026-10-17 00:49Z.
- Release gate: verifier r13 PASS, SecureDog r8 PASS. Tests: soft-ai 979/0, security 271/0, chat-harden 644/0, lint 0.
- Production secrets include `SOFT_AI_OPENAI_API_KEY` (Luna for the inbox agents) and `OPENAI_API_KEY`.
- Docker image builds (see the session log).

## 1. Deploy — **YOU**

Docker Desktop must be running.

```
cd D:\Coder\CRM-v2-luna
npx wrangler deploy --keep-vars
npx wrangler deployments list
```

Then open https://www.betsycrm.com and log in (health check). WhatsApp keeps answering as before (same agent,
still Grok until step 2).

## 2. Switch PatchHouse ventas to Luna — **YOU** (in Betsy › Agentes)

1. Today's test budget is used up by the exams, so the quick check would be refused. Tell Claude "raise the test cap"
   (an audited raise to 21 000 000 for the switch only, restored right after) — or raise "Tope de pruebas"
   yourself in Agentes and lower it back to 800 000 after step 3.
2. PatchHouse ventas → model **Luna (OpenAI)** → run the quick check (Probar y activar) → must be green → **Activar**.
   The WhatsApp line now answers on Luna.

## 3. Turn on Instagram — **YOU**

PatchHouse ventas → Canales → add **@patchhouse.cr (Instagram)** → **Activar**.

What happens next (automatic, code-owned):

- The "line turned on" sweep answers the **50 newest** waiting chats right away (3 at a time, each message answered
  once — the webhook's own delivery key; a chat a person already answered is skipped).
- The background sweep answers the remaining ones (10 per cron run).
- Before 8:00 a. m. the replies carry the night intro ("…, asistente virtual de PatchHouse") and anything that needs
  a person says the team writes back from 8:00.

## 4. Watch the first replies — **YOU** (10 minutes)

- Chats › Instagram: open 10 answered chats. Look for: correct price / combo, one question per message, no promises,
  no "no lo tengo", payment details only after the customer picks a method.
- Hand-offs show up in Notificaciones with the reason.
- Stop instantly if anything is wrong: Agentes › PatchHouse ventas → **Pausar** (or the kill switch). Already-sent
  replies stay; nothing else goes out.

## 5. After the test

- Lower the test cap back to 800 000 if you raised it.
- Tell Claude: it reads every answered chat (the trace of each turn) and lists anything to fix.
- Then: deploy 2 (`claudio/luna-10-d2`, SQL 054 first — see its header), staff bot (`claudio/luna-10-staffbot`),
  remove `XAI_API_KEY` / `XAI_MODEL`, and after 2–3 days of shadow data decide `SOFT_AI_PAYMENT_CHECK=enforce`.

## Known limits for this test

- Betsy cannot send images on Instagram yet (text only).
- Follow-up messages ("¿Te gustaría encargarlo?") are not built yet.
- Split payments like "Les pago la mitad hoy y el resto mañana", or free text after a payment ask ("Les pago hoy en
  la tarde porque…"), go to a person — the same as live today.
