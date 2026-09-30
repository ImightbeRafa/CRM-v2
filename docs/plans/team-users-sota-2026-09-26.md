# Team users SOTA — Opus plan (2026-09-26)

**Base:** `claudio/wa-multichannel-harden` @ `481d812`  
**Branch:** `claudio/team-users-sota`  
**Non-goals:** Figma v4, AI agentes, logistics UI for non-DeepSleep, merge/deploy.

## Audit findings

### 1. Avatars never show (Gestión de Usuarios)
- `GET /api/users` selects `id, username, email, active, createdAt, updatedAt` — **omits `image` and `name`**.
- UI (`src/app/config/page.tsx` ~757) always renders Lucide `Users` icon; no `<img>` from `User.image`.
- Google OAuth already writes `user.image` (Google picture); `next.config.js` already allows `lh3.googleusercontent.com`.

### 2–3. Invite → orphan tenant
- No `TenantInvite` / accept token. "Invite" = `POST /api/users` with **required password** → creates User + active Membership.
- Google `signIn` for **new** emails always `tenant.create` + OWNER membership.
- Google/register for existing user with **zero active memberships** calls `provisionOwnedTenantForExistingUser` → **new orphan tenant** (removed assistants / invitees who never got membership).
- Public `/api/auth/register` always creates owned tenant for brand-new emails.
- **Root cause:** no invite-token path that forces join-of-inviting-tenant; OAuth/register happy-path provisions a new org.

### 4. Logistics ACL
- Gated solely by `User.isLogisticsAdmin` (middleware + `logistics-auth.ts`).
- Not scoped to DeepSleep. DeepSleep id = `cmhsibjue0004js04gie724nx` (also in `finance-tenants` / `MANAGED_TENANTS`).
- Product: logistics is Rafael personal/company tool → allow only DeepSleep members (who are also logistics admins).

### 5. Chat human outbound attribution
- `ChatMessage` has **no** `senderUserId`.
- `/api/chat/send` has `userId` but only passes it to `finalizeOutboundDelivery` (read-state), **not** into message metadata/columns.
- Soft AI already snapshots `agentName`/`agentEmoji` in metadata; human bubbles only show delivery ticks.
- Soft chrome LOCK: do not edit SoftSlimNav / SoftInboxBuckets / SoftCopilotRail; SoftThreadPane data plugs OK.

## Implementation plan

1. **Avatars:** API select `image`+`name`; UI round avatar (`img` or initials).
2. **Invites:** additive `TenantInvite` + SQL `030_tenant_invites.sql`; lib accept helpers; `POST /api/users` invite mode (email+role, optional password); email via Resend; accept page + API; cookie for OAuth; **auth-options / register: pending invite ⇒ join, never provision orphan tenant**.
3. **Logistics:** `canAccessLogistics({ isLogisticsAdmin, membershipTenantIds })` requires DeepSleep membership; wire middleware, `logistics-auth`, dashboard link.
4. **Attribution:** dualWrite + send write `metadata.senderUserId/Name/Image` (+ optional `senderUserId` column + SQL `031`); SoftThreadPane shows name+avatar on human outbound; DTO passthrough.
5. **Tests:** invite accept pure helpers; logistics ACL; outbound label/metadata; membership-lifecycle still green; focused chat tests.
6. **Draft PR** — no merge, no CF deploy.

## Prove
Unit/integration tests added + existing focused suites. Note RESEND/DB env may be missing on box.
