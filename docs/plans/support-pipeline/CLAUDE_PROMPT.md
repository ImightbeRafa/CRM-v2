# Prompt to paste into local Claude Code (D:\Coder\CRM-v2)

```
Read docs/plans/support-pipeline/SPEC.md fully, then AGENTS.md and CLAUDE.md. Implement the whole spec as ONE PR.

Rules:
- git fetch; branch `feat/support-pipeline` from origin/dev. PR target: dev, open as DRAFT. Never merge; never push to main/dev directly.
- Never run prisma db push / prisma migrate against any remote DB. Schema = raw SQL in supabase/migrations/030_support_pipeline.sql (check the number is free across open branches) registered in the manifest but NOT in DEFAULT_APPLY_FILES, plus matching models in prisma/schema.prisma; run `npx prisma generate` only.
- Do not deploy, do not run wrangler deploy or `wrangler triggers deploy`. Claudio deploys on Rafael's word.
- No real secrets in code or commits. Add every new var to .env.example with empty values.
- Keep /api/feedback and /api/contact response shapes backward compatible.
- Everything behind SUPPORT_PIPELINE_ENABLED (default false). Tenant agent access behind the custom_agents flag (default off, super-admin only). No user-facing Regular/Enhanced tiers.
- Webhook body must match Advance IANAI `buildTicketCreatedPayload` keys exactly, plus `source: "betsy"` and a `betsy` object; add a snapshot test.

Order of work (commit per step):
1. src/lib/support/types.ts + redact.ts + events.ts (pure parts) + unit tests.
2. Migration 030 + Prisma models + backfill script (dry-run default).
3. tickets.ts (single write path with outbox in one transaction), spam.ts, notify.ts, dispatcher.
4. API routes (§4) + auth-matrix tests.
5. /api/mcp (protocol, auth, 8 tools, audit) + tests.
6. contact-config.ts (defaults: SUPPORT_PUBLIC_EMAILS=hola@betsycrm.com, SUPPORT_WHATSAPP=50662470831 → +506 6247-0831 / https://wa.me/50662470831, SUPPORT_INSTAGRAM=betsy_crm → @betsy_crm / https://www.instagram.com/betsy_crm/; put these in .env.example) + /soporte page (WhatsApp/Instagram/emails/hours from env + ticket form + Mis tickets); agent-access.ts + super-admin custom-agent toggle; /agentes sales page + agent_request endpoint; server-side gate on /config/agentes and agent APIs.
7. Super-admin Soporte panel + internal agent review (/super-admin/agentes, super admin only).
8. package.json `test:support`; run lint, build, test:support, test:security; fix until green.
9. docs/runbooks/support-pipeline.md: env setup, applying 030, backfill, smoke test with webhook.site and MCP inspector, rollback.

When done, report: PR link, test output summary, anything you deviated from in the spec and why, and the list of env vars Claudio must set.
If something in the spec is wrong for the codebase, stop and write the issue in the PR description instead of silently working around it.
```
