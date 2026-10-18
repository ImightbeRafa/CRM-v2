@AGENTS.md

# Claude Code sessions (read after AGENTS.md)

Everything in AGENTS.md applies (database rules, `lm_*` tables, backups, env, scripts,
ledgers under `docs/audits/`, no merge to `dev` without Rafael's explicit GO) with **one
exception**: the grok-4.7 HARD LOCK is the **Cursor** model lock. In Claude Code the model
map below applies instead (Rafael, 2026-09-27). Never edit `.cursor/rules/**` to change that.

## Model map (Executor / Advisor loop)

| Role | Who | Model | Writes code? |
|---|---|---|---|
| Executor | the main session | whatever the session runs (default Opus) | yes, serially |
| Advisor (plan / safety / escalate) | `advisor` subagent | opus, high effort | never |
| Verifier (independent diff review) | `verifier` subagent | opus, extra-high effort | never |
| Security review ("SecureDog") | `securedog` subagent | opus, max effort | never |
| Scouts (read-only search, fan-out) | `scout` subagent | sonnet | never |

Spend intelligence where it changes outcomes: Advisor before non-trivial work, Verifier
after it, scouts for cheap parallel reading. Do not call the Advisor on trivial edits and
do not let subagents implement. Full loop: `.claude/skills/executor-advisor-loop/SKILL.md`.

## Where things are (Sep 2026)

- **Production**: `www.betsycrm.com` runs on **Cloudflare Containers** (Worker + standalone
  Next image, see `docs/ops/cloudflare-containers-daytime.md`). Vercel is no longer prod.
- **Preview**: Railway (`betsy-crm-*.up.railway.app`). It uses the **same production
  database** — anything written on preview is real. Prefer read-only checks there.
- **Live code line**: `claudio/team-users-sota` (#77) sits on `claudio/wa-multichannel-harden`
  (#76), which carries the CF packaging. The Aurora redesign (#78–#87) was built on `dev`
  and must be merged onto the live line, not shipped from `dev`.
- UI proof: `.cursor/skills/verify-betsy/SKILL.md` (scripts under its `scripts/`).

## Security register (Notion)

Every security finding — from `securedog`, the verifier, Cursor/Grok or a human — goes in
Notion › Betsy › **🛡️ Betsy Security Register (SecureDog)** › Security Findings
(https://app.notion.com/p/3e8bc39c41ae818d85eadf9f0abc4634). IDs by area (AUTH-, INT-, DATA-,
MEDIA-, INFRA-, DB-). Critical/High block a production deploy until Verified or accepted by Rafael.

## Always

- Work on a branch / worktree, never commit to `dev` directly. Draft PRs only.
- Never deploy to Cloudflare / change DNS / Meta webhooks / secrets without Rafael's GO.
- Prove before claiming done: `npx tsc --noEmit`, `npm run lint`, and the `test:*` suites
  that cover the touched area (see `package.json`). Report baseline failures as baseline.
- Update `docs/audits/CHANGELOG_AGENTS.md` after each meaningful slice.
