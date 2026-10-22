# Section to append to CLAUDE.md (or AGENTS.md)

## Support pipeline (tickets, contact, MCP, managed agents)
- Spec: docs/plans/support-pipeline/SPEC.md. Single write path: `createSupportTicket()` in `src/lib/support/tickets.ts`. Never insert `SupportTicket` rows elsewhere; it writes the outbox event in the same transaction.
- Outbound to the Grok agent only via `SupportTicketEvent` outbox + `dispatchPendingSupportEvents()`; never fetch the webhook inline from a route.
- Agent access only through `/api/mcp` with `SUPPORT_MCP_TOKEN`; every tool output goes through `src/lib/support/redact.ts`; every call is audited in `SupportMcpAudit`.
- Tenant agent access = `TenantFeatureFlag` key `custom_agents` (default off). Only super admin changes it. Enforce server-side on `/config/agentes` and agent APIs. Never add it to PREVIEW_UNLOCKED_KEYS. No user-facing tiers; review views live under `/super-admin` only.
- `/agentes` for non-enabled tenants is a sales page; its CTA creates an `agent_request` ticket via `createSupportTicket()`.
- Webhook payload stays compatible with Advance `ticket.created` (+ `source: "betsy"`). Contact info (WhatsApp, Instagram, emails, hours) comes from `getSupportContactConfig()`.
- Tenant id comes from the session JWT, never from the request body. Foreign ticket ids return 404.
- Support emails come from env (`SUPPORT_AGENT_EMAIL`=hola@betsycrm.com, `SUPPORT_FROM_EMAIL`, `SUPPORT_ESCALATION_EMAIL`, `SUPPORT_PUBLIC_EMAILS`); never hardcode addresses.
- Kill switch: `SUPPORT_PIPELINE_ENABLED=false` must keep legacy behavior.
- Tests: `npm run test:support`.
