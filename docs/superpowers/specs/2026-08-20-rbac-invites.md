# Spec — Scope-Based RBAC: Real Invite Flow + Mailer (Roadmap 2.4)

**Status:** Ready for planning
**Roadmap item:** Phase 2.4 — "Real invite flow (close dead `PENDING` state)"
**Plan:** `docs/superpowers/plans/2026-08-20-rbac-invites.md` (to be written)
**Depends on:** 2.2 (Group/Team model) · 2.3 (superadmin owns capability; `teams_manage`
delegates own membership).

## Decisions (confirmed with product)
- **Auto VIEWER floor on accept.** An accepted invitee with no explicit group gets the
  `VIEWER` group (global, read-only) as system policy — so a `teams_manage` delegate's
  invitee can at least read. Higher capability still requires a superadmin group grant (2.3).
- **Shared mailer: nodemailer + SMTP env, console fallback.** `SMTP_*` env configured ⇒ send;
  unset (dev/test) ⇒ log the accept link. One `mailer` service, reused by Phase 3 reports.
- **No self-signup** (roadmap invariant) — accounts exist only via seed or invite.

## Amends 2.2
2.2 retained `ProjectMember` as a temporary bridge holding PENDING invites
(`invitedGroupId?/invitedTeamId?`). This item introduces a first-class **`Invite`** model,
migrates any PENDING `ProjectMember` rows into it, and **drops `ProjectMember` +
`enum ProjectMemberStatus` entirely**. Membership is teams; capability is groups; pending
invites are `Invite`. Nothing else references `ProjectMember` after 2.3 (verify in planning —
2.3 R5 removed the last route usage; 2.3 R6/R7 removed the invariant helpers).

## Problem

`enum ProjectMemberStatus { ACTIVE PENDING }` exists (`schema.prisma:212-215`) and the
frontend renders a "Pending" tag, but **nothing produces PENDING** — the old `POST members`
always wrote `ACTIVE` with a required password (removed in 2.3 R5). There is **no invite
token, no mailer, no set-your-own-password flow** anywhere (grep: no nodemailer / token /
invite code exists). This item builds them.

## Verified current state

- **`auth.ts`** has `login` (rate-limited 10/5min, timing-safe compare `:39`), `logout`,
  `me`, `change-password` (`newPassword min(8)` `:14`), `users/exists`. **No accept-invite /
  set-password-by-token route.**
- **Public routes** are whitelisted in the JWT preHandler (`index.ts:106-125`); accept-invite
  endpoints must be added there (they run pre-authentication).
- **Password hashing:** `bcrypt.hash(pw, 12)` everywhere (`auth.ts`, `projects.ts`, `seed.ts`).
- **No mailer dependency** in `backend/package.json` — nodemailer is net-new.
- `notifier.ts` is the existing outbound-notification service (Slack/webhook channels) — the
  mailer is separate but can live beside it under `services/`.
- **`ProjectMember`** (`schema.prisma:168-184`) + **`ProjectMemberStatus`** (`:212-215`) — to
  be dropped here.

## Requirements

### R1 — `Invite` model + status enum; drop `ProjectMember`
```prisma
enum InviteStatus { PENDING ACCEPTED REVOKED EXPIRED }

model Invite {
  id          String   @id @default(cuid())
  email       String                       // normalized lower/trim
  tokenHash   String   @unique             // sha256(raw token); raw is emailed, never stored
  status      InviteStatus @default(PENDING)
  groupId     String?                       // superadmin-set default capability (optional)
  teamId      String?                       // membership to grant on accept (delegate-set)
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime @default(now())
  invitedBy   User   @relation("InvitesSent", fields: [invitedById], references: [id], onDelete: Cascade)
  group       Group? @relation(fields: [groupId], references: [id], onDelete: SetNull)
  team        Team?  @relation(fields: [teamId], references: [id], onDelete: Cascade)
  @@index([email])
  @@index([status])
}
```
Migration: create `Invite`; for each PENDING `ProjectMember`, insert an `Invite`
(`email`, `groupId=invitedGroupId`, `teamId=invitedTeamId`, fresh token+expiry, `invitedById`
= a superadmin) — or, simpler and acceptable, drop stale pending rows (they were never
usable) and log them. Then **drop `ProjectMember` and `ProjectMemberStatus`**. Confirm the
drop choice in planning; default to migrating.

### R2 — Mailer service (`backend/src/services/mailer.ts`)
- Add `nodemailer`. Config from env: `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM`.
- `getTransport()`: if `SMTP_HOST` set ⇒ real SMTP transport; else a **console/log transport**
  that prints the message (so dev/test/CI never require SMTP). One warn-log on startup which
  mode is active.
- `sendInviteEmail(to, acceptUrl)` — minimal text+html with the link. Export a generic
  `sendMail({to,subject,text,html})` so Phase 3 reports reuse it.
- `APP_URL` env for building `${APP_URL}/accept-invite?token=<raw>`.

### R3 — Create invite (`POST /invites`)
Body `{ email, groupId?, teamId? }`.
- **Authority:**
  - `groupId` present ⇒ **superadmin only** (`requireSuperadmin`, 2.3 R1) — capability grant.
  - `teamId` present ⇒ caller needs `teams_manage` on a project that team is attached to
    (`requireScope(project, teams_manage)` for some `TeamProject`), or superadmin.
  - Neither ⇒ superadmin only (a pure capability-less invite is a superadmin bootstrap act).
- **Reject if a `User` with a usable password already exists** for `email` (use 2.3 endpoints
  to assign existing users). If a PENDING invite already exists, **re-issue** (rotate token,
  reset expiry) instead of duplicating.
- Generate raw token = `crypto.randomBytes(32).toString('base64url')`; store `sha256(raw)`;
  `expiresAt = now + INVITE_TTL` (default 7 days). Email the link (R2).
- Rate-limit (reuse the login rate-limit pattern).

### R4 — Validate invite (`GET /auth/invite?token=` — public)
Public (add to preHandler whitelist). Hash the token, look up PENDING + unexpired; return
`{ email }` for the accept form, or a generic `400 invalid/expired` (don't distinguish). Lazily
mark `EXPIRED` if past `expiresAt`.

### R5 — Accept invite (`POST /auth/accept-invite` — public)
Body `{ token, password }` (`password min(8)`, reusing the change-password rule). In a
transaction:
- Resolve the invite (PENDING + unexpired); else 400.
- Upsert the `User` (create with `bcrypt.hash(password,12)`; if a passwordless user row exists
  for the email, set its hash).
- **Capability:** `UserGroup(user, invite.groupId ?? VIEWER-group-id)` — the auto VIEWER floor.
- **Membership:** if `invite.teamId`, `TeamMember(team, user)`.
- Mark invite `ACCEPTED`, set `acceptedAt`. Token is single-use (status flip).
- Return `{ ok: true }` (user then logs in) — or issue a JWT to auto-login; pick one in
  planning (auto-login is friendlier, `ok` is simpler). Rate-limit this route.

### R6 — Revoke / list invites
- `DELETE /invites/:id` — inviter or superadmin; sets `REVOKED` (or hard delete). Revoked/used
  tokens never accept.
- `GET /invites` — list PENDING invites the caller may see (superadmin: all; `teams_manage`:
  invites for teams on their projects). Gated accordingly.

### R7 — Frontend: public accept page only
- `AcceptInvitePage` at `/accept-invite?token=`: calls R4 to show the email, collects a
  password, calls R5, then routes to login (or straight in if auto-login). Public route (no
  auth guard).
- **Out of scope here:** the admin invite *form* and the pending-invite list UI — those ship
  with the management console in 2.5. This item delivers the end-to-end flow with the accept
  page; invites can be created via API/tests meanwhile.

## Security requirements (not simplified away)
- Raw token: ≥256-bit CSPRNG (`crypto.randomBytes`); **only** `sha256(token)` persisted;
  constant-work lookup by hash.
- Single-use + TTL-expiry enforced server-side; revocation honored.
- Accept & invite routes rate-limited; accept validates password length.
- `GET /auth/invite` and failures return generic errors — no user-enumeration via invites.
- Public routes strictly limited to `GET /auth/invite`, `POST /auth/accept-invite`.

## Explicitly out of scope
- Admin invite-form / pending-list **UI** — Roadmap 2.5.
- Password reset / forgot-password (invite ≠ reset) — not in Phase 2.
- Email templating/branding beyond a plain link; bounce handling; retries — Phase 3 may extend
  the mailer.
- SSO / OAuth / self-signup.

## Acceptance criteria
- `Invite`/`InviteStatus` exist; `ProjectMember`/`ProjectMemberStatus` are dropped and
  unreferenced; pending rows migrated (or logged+dropped per R1).
- A superadmin creates an invite with a `groupId`; a `teams_manage` delegate creates one with
  a `teamId` on their project but is **403** if they pass a `groupId` or a `teamId` for a
  project they lack authority on.
- Accepting a valid invite creates a usable user, assigns the invited group **or VIEWER by
  default**, adds the team membership if present, and marks the invite ACCEPTED (single-use —
  a second accept 400s).
- Expired/revoked/used tokens are rejected; `GET /auth/invite` reveals only the email for a
  valid token and a generic error otherwise.
- With `SMTP_HOST` unset the accept link is logged (no send attempted); with it set, one mail
  is sent. Tests run without SMTP.
- Invite and accept routes are rate-limited; passwords under 8 chars rejected.

## Test approach
`node:test` + `node:assert/strict` via `tsx --test`; `Fastify().inject` + real Prisma per
`backend/tests/data-case-run.test.ts`; mailer forced to log-transport in tests.
- **Token security:** stored value ≠ raw token (is its sha256); tampered/expired/revoked
  tokens 400; second accept 400.
- **Authority:** superadmin vs `teams_manage` vs plain member creating invites with
  group/team combinations → allow/403 matrix (R3).
- **Accept effects:** default-VIEWER path and explicit-group path both yield the right
  `UserGroup`; teamId yields `TeamMember`; user can then log in.
- **Migration:** seed a PENDING `ProjectMember`, run migration, assert an equivalent `Invite`
  and that `ProjectMember` is gone.
- **Mailer:** log-transport captures the link; `sendMail` shape reusable (asserted for the
  Phase 3 seam).
