# Railway PR preview

This PR deploys to Railway PR Environments (not Vercel Preview).
Stable `dev` host: https://betsy-crm-production.up.railway.app

Trigger commit for Railway ephemeral env after PR Environments enabled (2026-09-22).

## 2026-09-28 — Aurora release candidate preview
- Service `betsy-crm-pr72` (project betsy-crm-test) tracks branch `rafa/aurora-on-live`
  (PR #88) with **auto deploy enabled** by Rafael. Preview URL:
  https://betsy-crm-pr72-production.up.railway.app — uses the PRODUCTION database.
- "Wait for CI" stays off (no GitHub Actions in this repo).
