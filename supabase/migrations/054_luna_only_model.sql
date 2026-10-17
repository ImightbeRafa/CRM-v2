-- 054 luna-10 (Rafael 2026-10-17): gpt-6-luna is the only inbox agent model. Data + column default only; no new
-- table, column, index or constraint. Gated: BETSY_V2_APPLY_FILES=054. DO NOT run prisma db push / migrate.
--
-- ORDER (deploy 2 runbook):
--   1. Deploy 1 is live (Luna works, default Luna, older ids still resolvable).
--   2. Each LIVE agent is switched in the app (Agentes → agente → Avanzado → "Cambiar a Luna"), its quick check
--      passes and Activar is pressed again: the send permission is per agent + model, so this file never touches
--      live agents (rewriting them here would skip the "green run on this model" safety gate).
--   3. Run this file: every NOT-live agent (draft / paused / archived) moves to Luna; new rows default to Luna.
--   4. Deploy 2 (older ids no longer resolve). A live agent still on an older id is skipped (model_not_allowed)
--      until it is switched and activated — check with the SELECT at the end before deploying.
-- History (ChatAgentTurn, AiUsageEvent, version snapshots) keeps the model it ran with. Rollback: none needed
-- (re-deploying deploy 1 resolves both ids again).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public."ChatAgent" ALTER COLUMN "model" SET DEFAULT 'gpt-6-luna';

UPDATE public."ChatAgent"
SET "model" = 'gpt-6-luna', "updatedAt" = now()
WHERE "model" <> 'gpt-6-luna' AND "status" <> 'live';

COMMIT;

-- Before deploy 2 this must return 0 rows (or only test businesses you accept will stay quiet):
-- SELECT a.id, a.name, a.status, a.model, t.name AS tenant
-- FROM public."ChatAgent" a JOIN public."Tenant" t ON t.id = a."tenantId"
-- WHERE a."model" <> 'gpt-6-luna';
