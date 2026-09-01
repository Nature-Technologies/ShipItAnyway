# Scope-Based RBAC: Real Invite Flow + Mailer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the dead `PENDING` state. Introduce a first-class `Invite` model with a hashed, single-use, TTL-bounded token; a shared nodemailer mailer with an SMTP-or-log transport; authority-gated create/revoke/list invite endpoints; public validate + accept-with-password endpoints; and a public accept page. Migrate any PENDING `ProjectMember` rows into `Invite`, then drop `ProjectMember` + `enum ProjectMemberStatus` entirely.

**Architecture:** Membership is teams, capability is groups (2.2), delegation is scopes (2.3); pending invitations become `Invite`. A superadmin invites with a `groupId` (capability grant); a `teams_manage` delegate invites with a `teamId` (membership grant). Accepting upserts a `User` with their chosen password, floors capability at the global `VIEWER` group, adds the team membership if present, and flips the invite to `ACCEPTED` (single-use). The raw token is emailed and never stored — only its `sha256` lives in the DB. With `SMTP_HOST` unset the accept link is logged (nodemailer `jsonTransport`), so dev/test/CI never need SMTP.

**Tech Stack:** Fastify 5, Prisma (PostgreSQL), Zod, bcrypt (`hash(pw, 12)`), `node:crypto`, nodemailer (net-new), React + React Router + Ant Design, TypeScript strict. Tests: `node:test` + `node:assert/strict` via `tsx --test`, `Fastify().inject` + preHandler stub, real Prisma.

**Spec:** `docs/superpowers/specs/2026-08-20-rbac-invites.md`

## Global Constraints

- Node 22 (backend), TypeScript strict. Prisma migrations are timestamped dirs `<YYYYMMDDHHMMSS>_<snake_case>/migration.sql`; boot runs `prisma migrate deploy && prisma db seed` (`backend/Dockerfile:25`). Create migrations with `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name <name>`; hand-edit the generated SQL for the pending-row data migration and the `ProjectMember` drop.
- Run tests with `cd backend && npx dotenv -e ../.env -- tsx --test tests/<file>.test.ts` (backend) and `cd frontend && npx tsx --test tests/<file>.test.ts` (frontend). Backend integration tests require the compose `db` + `redis` services running.
- New backend deps go through pnpm: `cd backend && pnpm add nodemailer` and `cd backend && pnpm add -D @types/nodemailer`.
- Route tests use `Fastify().inject` with a `preHandler` that stubs `req.user = { userId, email }` (real Prisma), reusing the `buildApp` / fixture / `cleanup` helper pattern from `backend/tests/data-case-run.test.ts:17-58`.
- **This plan assumes 2.2 and 2.3 are merged:** `Group` / `Team` / `UserGroup` / `TeamMember` / `TeamProject` models, a seeded global **VIEWER** group, and `requireSuperadmin(userId)` + `requireScope(projectId, userId, scope)` (with a boolean `hasScope(...)` variant) helpers all exist. Line numbers cited below are as of this branch (pre-2.2/2.3); 2.2/2.3 will already have migrated project access off `ProjectMember`, so the `ProjectMember` references in `seed.ts` and the test harness noted below are the last remnants this item removes (spec §"Amends 2.2" — verify no other references remain in planning: `grep -rn "projectMember\|ProjectMember" backend/src backend/prisma backend/tests`).
- Public routes are strictly `GET /auth/invite` and `POST /auth/accept-invite` (added to the JWT preHandler whitelist, `backend/src/index.ts:106-118`). Nothing else becomes public.
- Password rule is `min(8)`, reusing `ChangePasswordSchema` (`auth.ts:12-15`); hashing is `bcrypt.hash(pw, 12)` (`auth.ts:93`). Branding stays "ShipItAnyway".

---

### Task 1: Shared mailer service (nodemailer, SMTP-or-log transport)

**Files:**
- Modify: `backend/package.json` (add `nodemailer` dep + `@types/nodemailer` dev dep)
- Create: `backend/src/services/mailer.ts`
- Test: `backend/tests/mailer.test.ts`

**Interfaces:**
- Produces:
  - `sendMail(opts: { to: string; subject: string; text: string; html?: string }): Promise<SentMessageInfo>` — generic seam reused by Phase 3 reports.
  - `sendInviteEmail(to: string, acceptUrl: string): Promise<SentMessageInfo>`.
- Consumes env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. `SMTP_HOST` set ⇒ real SMTP; unset ⇒ nodemailer `jsonTransport` (logs, never sends). One warn-log at import naming the active mode.

- [ ] **Step 1: Add the dependency**

Run: `cd backend && pnpm add nodemailer && pnpm add -D @types/nodemailer`
Expected: `nodemailer` under `dependencies`, `@types/nodemailer` under `devDependencies`.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/mailer.test.ts` (force log-transport by clearing `SMTP_HOST` before import so no send is attempted):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

delete process.env.SMTP_HOST; // force jsonTransport (log) mode
const { sendMail, sendInviteEmail } = await import('../src/services/mailer');

test('sendInviteEmail logs the accept link via jsonTransport (no SMTP)', async () => {
  const info = await sendInviteEmail('invitee@example.com', 'https://app.test/accept-invite?token=RAW');
  const message = JSON.parse(info.message as string);
  assert.equal(message.to[0].address, 'invitee@example.com');
  assert.match(message.subject, /ShipItAnyway/);
  assert.ok(message.text.includes('https://app.test/accept-invite?token=RAW'));
});

test('sendMail returns a reusable message shape (Phase 3 seam)', async () => {
  const info = await sendMail({ to: 'r@example.com', subject: 'Report', text: 'body' });
  const message = JSON.parse(info.message as string);
  assert.equal(message.subject, 'Report');
  assert.equal(message.text, 'body');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/mailer.test.ts`
Expected: FAIL — `../src/services/mailer` not found.

- [ ] **Step 4: Implement the mailer**

Create `backend/src/services/mailer.ts`:

```ts
import nodemailer from 'nodemailer';

const FROM = process.env.SMTP_FROM ?? 'ShipItAnyway <no-reply@shipitanyway.local>';

function getTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    });
  }
  // ponytail: nodemailer's built-in jsonTransport IS the log transport — no custom transport class.
  return nodemailer.createTransport({ jsonTransport: true });
}

console.warn(`[mailer] transport mode: ${process.env.SMTP_HOST ? 'smtp' : 'log (jsonTransport)'}`);

export async function sendMail(opts: {
  to: string; subject: string; text: string; html?: string;
}) {
  const info = await getTransport().sendMail({ from: FROM, ...opts });
  if (!process.env.SMTP_HOST) console.warn('[mailer] logged (SMTP unset):', info.message);
  return info;
}

export async function sendInviteEmail(to: string, acceptUrl: string) {
  return sendMail({
    to,
    subject: 'You are invited to ShipItAnyway',
    text: `You've been invited to ShipItAnyway. Accept your invite: ${acceptUrl}`,
    html: `<p>You've been invited to ShipItAnyway.</p>`
      + `<p><a href="${acceptUrl}">Accept your invite</a></p>`
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/mailer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/pnpm-lock.yaml backend/src/services/mailer.ts backend/tests/mailer.test.ts
git commit -m "feat(mailer): shared nodemailer service with SMTP-or-log transport"
```

---

### Task 2: `Invite` model + `InviteStatus`; migrate PENDING rows; drop `ProjectMember`

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `enum InviteStatus` + `model Invite`; drop `model ProjectMember` ~168-184 and `enum ProjectMemberStatus` ~212-215; remove `members ProjectMember[]` from `Project` ~20 and `memberships ProjectMember[]` from `User` ~40; add `invitesSent Invite[] @relation("InvitesSent")` on `User`, `invites Invite[]` on `Group` and `Team` — the latter two models added in 2.2)
- Create: `backend/prisma/migrations/<new-timestamp>_add_invite_drop_project_member/migration.sql` (hand-edited: create `Invite`, data-migrate PENDING rows, drop `ProjectMember` + `ProjectMemberStatus`)
- Modify: `backend/prisma/seed.ts` (remove the `seedProjectOwners` `projectMember` usage ~41-69, superseded by 2.2 group/team seeding; note the pending-invite migration path)
- Modify: `backend/tests/data-case-run.test.ts` (the `createProjectAccess` `prisma.projectMember.create` at ~42-50 and the VIEWER member at ~564-572 — replace with the post-2.3 group/team access helper; last `ProjectMember` remnants)
- Test: verification is a manual scratch-DB check (a dropped table cannot be asserted from app code after the drop)

**Interfaces:**
- Produces: `Invite` / `InviteStatus` on the Prisma client; `ProjectMember` / `ProjectMemberStatus` no longer exist.

```prisma
enum InviteStatus { PENDING ACCEPTED REVOKED EXPIRED }

model Invite {
  id          String       @id @default(cuid())
  email       String                          // normalized lower/trim
  tokenHash   String       @unique            // sha256(raw token); raw is emailed, never stored
  status      InviteStatus @default(PENDING)
  groupId     String?                         // superadmin-set default capability (optional)
  teamId      String?                         // membership to grant on accept (delegate-set)
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime     @default(now())
  invitedBy   User   @relation("InvitesSent", fields: [invitedById], references: [id], onDelete: Cascade)
  group       Group? @relation(fields: [groupId], references: [id], onDelete: SetNull)
  team        Team?  @relation(fields: [teamId], references: [id], onDelete: Cascade)
  @@index([email])
  @@index([status])
}
```

- [ ] **Step 1: Add the enum + model, drop `ProjectMember`, fix back-relations**

In `schema.prisma`: paste the `InviteStatus` enum + `Invite` model above; delete `model ProjectMember` (~168-184) and `enum ProjectMemberStatus` (~212-215); remove `members ProjectMember[]` from `Project` (~20) and `memberships ProjectMember[]` from `User` (~40); add `invitesSent Invite[] @relation("InvitesSent")` to `User`, and `invites Invite[]` to the `Group` and `Team` models (added in 2.2).

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npx dotenv -e ../.env -- prisma migrate dev --name add_invite_drop_project_member`
Prisma generates `CREATE TABLE "Invite"` + `CREATE TYPE "InviteStatus"` and `DROP TABLE "ProjectMember"` + `DROP TYPE "ProjectMemberStatus"`. It regenerates the client.

- [ ] **Step 3: Hand-edit the SQL to migrate PENDING rows before the drop**

In the generated `migration.sql`, **after** the `Invite` table/enum creation and **before** `DROP TABLE "ProjectMember"`, insert the data migration (default = migrate per spec R1; the migrated tokens are fresh + unemailed, so recipients must be re-invited — simpler acceptable alternative noted below):

```sql
-- Migrate PENDING ProjectMember bridge rows (2.2 columns invitedGroupId/invitedTeamId) into Invite.
INSERT INTO "Invite" ("id","email","tokenHash","status","groupId","teamId","invitedById","expiresAt","createdAt")
SELECT gen_random_uuid()::text,
       pm."email",
       encode(sha256((gen_random_uuid()::text)::bytea), 'hex'),  -- unusable placeholder hash; no raw exists
       'PENDING',
       pm."invitedGroupId",
       pm."invitedTeamId",
       (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1), -- earliest user as system inviter
       now() + interval '7 days',
       now()
FROM "ProjectMember" pm
WHERE pm."status" = 'PENDING';
```

> **ponytail: migrated invites carry an unusable token (nothing was emailed) — they exist only to preserve the record; upgrade path is re-issue via `POST /invites` (Task 3). Simpler spec-allowed alternative: replace the INSERT with `-- log+drop` and skip it entirely (stale PENDING rows were never usable). Default to migrating.**

- [ ] **Step 4: Apply + verify on a scratch DB (manual)**

Before applying: seed one PENDING `ProjectMember` (with `invitedGroupId`/`invitedTeamId` set) on a scratch DB, run `prisma migrate deploy`, then assert an equivalent `Invite` row exists and `SELECT to_regclass('"ProjectMember"')` returns `NULL`. Then confirm the dev DB applied cleanly:

Run: `cd backend && npx dotenv -e ../.env -- prisma migrate status`
Expected: the new migration is applied; `ProjectMember` table and `ProjectMemberStatus` type are gone.

> No app-level unit test: the acceptance is a one-time data migration on a table that no longer exists post-drop, so it is verified by the scratch-DB check above (spec Test approach §"Migration").

- [ ] **Step 5: Remove the last `ProjectMember` references so the client compiles**

- `seed.ts`: delete `seedProjectOwners` (~41-69) and its call (~87); project ownership is seeded via 2.2's group/team seeding. Add a one-line comment pointing to the pending-invite migration (Step 3) for historical context.
- `data-case-run.test.ts`: replace `prisma.projectMember.create` (~42-50) and the VIEWER-member block (~564-572) with the post-2.3 group/team access helper (2.3 provides the grant helper the rest of that suite already uses).

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/data-case-run.test.ts`
Expected: PASS (harness compiles against the new schema).

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/prisma/seed.ts backend/tests/data-case-run.test.ts
git commit -m "feat(invites): add Invite model + InviteStatus; migrate pending rows; drop ProjectMember"
```

---

### Task 3: Create invite (`POST /invites`) — token hashing, authority, rate-limit, re-issue

**Files:**
- Create: `backend/src/utils/invite-token.ts`
- Create: `backend/src/routes/invites.ts`
- Modify: `backend/src/index.ts` (register `inviteRoutes` in the route block ~200-211)
- Test: `backend/tests/invite-create.test.ts`

**Interfaces:**
- Consumes: `sendInviteEmail` (Task 1), `requireSuperadmin` / `hasScope` (2.3), `Group` / `Team` / `TeamProject` (2.2).
- Produces:
  - `generateInviteToken(): { raw: string; hash: string }` and `hashInviteToken(raw: string): string` (sha256 hex).
  - `POST /invites` body `{ email, groupId?, teamId? }` → `201 { id, email, status }`. Emails the `${APP_URL}/accept-invite?token=<raw>` link. Rate-limited.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/invite-create.test.ts`. Force log-transport (`delete process.env.SMTP_HOST` before importing routes). Build an app registering `inviteRoutes` with a `req.user` stub; create a superadmin fixture (2.3), the global VIEWER group (2.2 seed or create), and a team + `TeamProject`. Assert the security + authority invariants:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
delete process.env.SMTP_HOST;
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { hashInviteToken } from '../src/utils/invite-token';
import { inviteRoutes } from '../src/routes/invites';

function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  return app.register(inviteRoutes).then(() => app);
}

test('superadmin creates a group invite; token is stored hashed, never raw', async () => {
  const { superadmin, group, cleanup } = await seedInviteFixtures(); // superadmin + VIEWER group
  const app = await buildApp(superadmin.id, superadmin.email);
  try {
    const res = await app.inject({
      method: 'POST', url: '/invites',
      payload: { email: 'New.Person@Example.com', groupId: group.id }
    });
    assert.equal(res.statusCode, 201);
    const invite = await prisma.invite.findFirst({ where: { email: 'new.person@example.com' } });
    assert.ok(invite);
    assert.equal(invite!.status, 'PENDING');
    assert.equal(invite!.groupId, group.id);
    assert.equal(invite!.tokenHash.length, 64);       // sha256 hex
    assert.ok(invite!.expiresAt > new Date());
  } finally { await app.close(); await cleanup(); }
});

test('teams_manage delegate may invite with a teamId on their project but is 403 for a groupId', async () => {
  const { delegate, team, cleanup } = await seedDelegateFixtures(); // teams_manage on team's project
  const app = await buildApp(delegate.id, delegate.email);
  try {
    const ok = await app.inject({ method: 'POST', url: '/invites', payload: { email: 'a@x.io', teamId: team.id } });
    assert.equal(ok.statusCode, 201);
    const forbidden = await app.inject({ method: 'POST', url: '/invites', payload: { email: 'b@x.io', groupId: 'any' } });
    assert.equal(forbidden.statusCode, 403);
  } finally { await app.close(); await cleanup(); }
});

test('re-inviting a PENDING email rotates the token instead of duplicating', async () => {
  const { superadmin, group, cleanup } = await seedInviteFixtures();
  const app = await buildApp(superadmin.id, superadmin.email);
  try {
    await app.inject({ method: 'POST', url: '/invites', payload: { email: 'dup@x.io', groupId: group.id } });
    const first = await prisma.invite.findFirstOrThrow({ where: { email: 'dup@x.io' } });
    await app.inject({ method: 'POST', url: '/invites', payload: { email: 'dup@x.io', groupId: group.id } });
    const all = await prisma.invite.findMany({ where: { email: 'dup@x.io' } });
    assert.equal(all.length, 1);                       // re-issued, not duplicated
    assert.notEqual(all[0].tokenHash, first.tokenHash); // token rotated
  } finally { await app.close(); await cleanup(); }
});
```

> `seedInviteFixtures` / `seedDelegateFixtures` build on the harness pattern (`data-case-run.test.ts:29-58`) plus 2.2/2.3 group/team/scope grants; each returns a `cleanup()` that deletes its rows.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-create.test.ts`
Expected: FAIL — `invite-token` / `invites` modules missing.

- [ ] **Step 3: Implement the token helper**

Create `backend/src/utils/invite-token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url'); // ≥256-bit CSPRNG
  return { raw, hash: hashInviteToken(raw) };
}
```

- [ ] **Step 4: Implement the create route**

Create `backend/src/routes/invites.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { generateInviteToken } from '../utils/invite-token';
import { sendInviteEmail } from '../services/mailer';
import { requireSuperadmin, hasScope } from '../utils/rbac'; // consumed from 2.3

const INVITE_TTL_MS = Number(process.env.INVITE_TTL_DAYS ?? 7) * 24 * 60 * 60 * 1000;
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

const CreateInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  groupId: z.string().optional(),
  teamId: z.string().optional()
});

// groupId (or neither) ⇒ superadmin; teamId-only ⇒ teams_manage on a project the team is attached to, else superadmin.
async function assertInviteAuthority(userId: string, groupId?: string, teamId?: string) {
  if (groupId || !teamId) { await requireSuperadmin(userId); return; }
  const links = await prisma.teamProject.findMany({ where: { teamId }, select: { projectId: true } });
  for (const { projectId } of links) {
    if (await hasScope(projectId, userId, 'teams_manage')) return;
  }
  await requireSuperadmin(userId); // throws 403 when the delegate lacks scope
}

export async function inviteRoutes(fastify: FastifyInstance) {
  fastify.post('/invites', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }
  }, async (req, reply) => {
    const parsed = CreateInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid invite' });
    const { email, groupId, teamId } = parsed.data;
    await assertInviteAuthority(req.user.userId, groupId, teamId); // 403 throws → 403

    const existingUser = await prisma.user.findUnique({ where: { email } });
    // ponytail: "usable" = non-empty hash; passwordless placeholder rows still accept an invite.
    if (existingUser?.passwordHash) {
      return reply.status(409).send({ error: 'A user with that email already exists' });
    }

    const { raw, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const pending = await prisma.invite.findFirst({ where: { email, status: 'PENDING' } });
    const invite = pending
      ? await prisma.invite.update({
          where: { id: pending.id },
          data: { tokenHash: hash, expiresAt, groupId: groupId ?? null, teamId: teamId ?? null,
                  invitedById: req.user.userId }
        })
      : await prisma.invite.create({
          data: { email, tokenHash: hash, expiresAt, groupId: groupId ?? null, teamId: teamId ?? null,
                  invitedById: req.user.userId }
        });

    await sendInviteEmail(email, `${APP_URL}/accept-invite?token=${raw}`);
    return reply.status(201).send({ id: invite.id, email: invite.email, status: invite.status });
  });
}
```

- [ ] **Step 5: Register the route**

In `backend/src/index.ts`, import `inviteRoutes` and add `await fastify.register(inviteRoutes);` in the route block (~200-211).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-create.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/invite-token.ts backend/src/routes/invites.ts backend/src/index.ts backend/tests/invite-create.test.ts
git commit -m "feat(invites): POST /invites with token hashing, authority gating, re-issue"
```

---

### Task 4: Validate invite (`GET /auth/invite` — public)

**Files:**
- Modify: `backend/src/routes/auth.ts` (add public `GET /auth/invite`; import `hashInviteToken`)
- Modify: `backend/src/index.ts` (whitelist `GET /auth/invite` in the preHandler ~106-118)
- Test: `backend/tests/invite-validate.test.ts`

**Interfaces:**
- Produces: `GET /auth/invite?token=<raw>` → `200 { email }` for a valid PENDING+unexpired token, else generic `400 { error: 'Invalid or expired invite' }`. Lazily flips a past-`expiresAt` PENDING invite to `EXPIRED`. No user enumeration.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/invite-validate.test.ts`:

```ts
test('GET /auth/invite returns only the email for a valid token, generic 400 otherwise', async () => {
  const app = Fastify(); // no preHandler — route is public
  await app.register(authRoutes);
  const { raw, hash } = generateInviteToken();
  const invite = await prisma.invite.create({
    data: { email: 'valid@x.io', tokenHash: hash, invitedById: inviter.id,
            expiresAt: new Date(Date.now() + 60_000) }
  });
  const expiredRaw = generateInviteToken();
  await prisma.invite.create({
    data: { email: 'old@x.io', tokenHash: expiredRaw.hash, invitedById: inviter.id,
            expiresAt: new Date(Date.now() - 60_000) }
  });
  try {
    const ok = await app.inject({ method: 'GET', url: `/auth/invite?token=${raw}` });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { email: 'valid@x.io' });

    const bad = await app.inject({ method: 'GET', url: '/auth/invite?token=nope' });
    assert.equal(bad.statusCode, 400);

    const expired = await app.inject({ method: 'GET', url: `/auth/invite?token=${expiredRaw.raw}` });
    assert.equal(expired.statusCode, 400);
    const flipped = await prisma.invite.findFirst({ where: { email: 'old@x.io' } });
    assert.equal(flipped!.status, 'EXPIRED'); // lazily marked
  } finally { await app.close(); /* delete invites + inviter */ }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-validate.test.ts`
Expected: FAIL — route not registered (404).

- [ ] **Step 3: Add the route**

In `backend/src/routes/auth.ts`, `import { hashInviteToken } from '../utils/invite-token';` and add:

```ts
fastify.get('/auth/invite', {
  config: { rateLimit: { max: 20, timeWindow: '5 minutes' } }
}, async (req, reply) => {
  const token = (req.query as { token?: string }).token;
  if (!token) return reply.status(400).send({ error: 'Invalid or expired invite' });
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
  if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
    if (invite?.status === 'PENDING' && invite.expiresAt < new Date()) {
      await prisma.invite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    }
    return reply.status(400).send({ error: 'Invalid or expired invite' }); // generic — no enumeration
  }
  return { email: invite.email };
});
```

- [ ] **Step 4: Whitelist the public route**

In `backend/src/index.ts` `publicRoutes` (~106-118), add `{ method: 'GET', url: '/auth/invite' }`. (The `startsWith` match covers the `?token=` query string.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-validate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/index.ts backend/tests/invite-validate.test.ts
git commit -m "feat(invites): public GET /auth/invite validate endpoint (generic errors)"
```

---

### Task 5: Accept invite (`POST /auth/accept-invite` — public)

**Files:**
- Modify: `backend/src/routes/auth.ts` (add public `POST /auth/accept-invite`; reuse `bcrypt` + password `min(8)`)
- Modify: `backend/src/index.ts` (whitelist `POST /auth/accept-invite` ~106-118)
- Test: `backend/tests/invite-accept.test.ts`

**Interfaces:**
- Consumes: `hashInviteToken`, `bcrypt.hash(pw, 12)`, `UserGroup` / `TeamMember` (2.2), the global VIEWER group (2.2).
- Produces: `POST /auth/accept-invite` body `{ token, password }` (`password min(8)`). In a transaction: resolve PENDING+unexpired invite (else 400) → upsert `User` with hashed password → `UserGroup(user, invite.groupId ?? VIEWER)` (auto-VIEWER floor) → `TeamMember(team, user)` if `teamId` → mark `ACCEPTED` + `acceptedAt` (single-use). Returns `200 { ok: true }`; the invitee then logs in. Rate-limited.

> **Design pick (spec R5): return `{ ok: true }` and let the invitee log in — simpler than issuing a JWT here; no session plumbing on a public route.**

- [ ] **Step 1: Write the failing test**

Create `backend/tests/invite-accept.test.ts`:

```ts
test('accept with no groupId floors capability at VIEWER, adds team membership, is single-use', async () => {
  const app = Fastify();
  await app.register(authRoutes);
  const { raw, hash } = generateInviteToken();
  const invite = await prisma.invite.create({
    data: { email: 'accept@x.io', tokenHash: hash, invitedById: inviter.id, teamId: team.id,
            expiresAt: new Date(Date.now() + 60_000) } // no groupId → VIEWER floor
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/auth/accept-invite',
      payload: { token: raw, password: 'sup3rsecret' }
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'accept@x.io' } });
    assert.ok(await bcrypt.compare('sup3rsecret', user.passwordHash));       // usable password
    const groups = await prisma.userGroup.findMany({ where: { userId: user.id } });
    assert.deepEqual(groups.map((g) => g.groupId), [viewerGroup.id]);         // VIEWER floor
    assert.ok(await prisma.teamMember.findFirst({ where: { userId: user.id, teamId: team.id } }));
    assert.equal((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).status, 'ACCEPTED');

    const second = await app.inject({ method: 'POST', url: '/auth/accept-invite',
      payload: { token: raw, password: 'sup3rsecret' } });
    assert.equal(second.statusCode, 400);                                     // single-use
  } finally { await app.close(); /* delete user/invite/fixtures */ }
});

test('accept rejects a password under 8 chars', async () => {
  const app = Fastify(); await app.register(authRoutes);
  const { raw } = /* create a fresh PENDING invite */ freshInvite;
  try {
    const res = await app.inject({ method: 'POST', url: '/auth/accept-invite',
      payload: { token: raw, password: 'short' } });
    assert.equal(res.statusCode, 400);
  } finally { await app.close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-accept.test.ts`
Expected: FAIL — route not registered (404).

- [ ] **Step 3: Add the route**

In `backend/src/routes/auth.ts` add (VIEWER lookup uses the constant 2.2 exports, e.g. `VIEWER_GROUP_NAME`):

```ts
const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8)   // same rule as ChangePasswordSchema
});

fastify.post('/auth/accept-invite', {
  config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }
}, async (req, reply) => {
  const parsed = AcceptInviteSchema.safeParse(req.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid or expired invite' });

  const tokenHash = hashInviteToken(parsed.data.token);
  const user = await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { tokenHash } });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) return null;

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const u = await tx.user.upsert({
      where: { email: invite.email },
      update: { passwordHash },
      create: { email: invite.email, passwordHash }
    });

    const groupId = invite.groupId
      ?? (await tx.group.findFirstOrThrow({ where: { name: VIEWER_GROUP_NAME } })).id;
    await tx.userGroup.upsert({
      where: { userId_groupId: { userId: u.id, groupId } }, update: {},
      create: { userId: u.id, groupId }
    });
    if (invite.teamId) {
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: invite.teamId, userId: u.id } }, update: {},
        create: { teamId: invite.teamId, userId: u.id }
      });
    }
    await tx.invite.update({ where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    return u;
  });

  if (!user) return reply.status(400).send({ error: 'Invalid or expired invite' });
  return { ok: true };
});
```

- [ ] **Step 4: Whitelist the public route**

In `backend/src/index.ts` `publicRoutes` (~106-118), add `{ method: 'POST', url: '/auth/accept-invite' }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-accept.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/index.ts backend/tests/invite-accept.test.ts
git commit -m "feat(invites): public POST /auth/accept-invite (VIEWER floor, single-use, tx)"
```

---

### Task 6: Revoke + list invites (`DELETE /invites/:id`, `GET /invites`)

**Files:**
- Modify: `backend/src/routes/invites.ts` (add `DELETE /invites/:id` and `GET /invites`)
- Test: `backend/tests/invite-manage.test.ts`

**Interfaces:**
- Produces:
  - `DELETE /invites/:id` → `200 { ok: true }`; sets `status = REVOKED`. Inviter or superadmin only; a revoked token never accepts.
  - `GET /invites` → `200 Invite[]` (PENDING only). Superadmin sees all; a `teams_manage` delegate sees invites for teams on their projects. No `tokenHash` in the response.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/invite-manage.test.ts`:

```ts
test('inviter revokes their invite; a revoked token no longer accepts', async () => {
  const app = await buildApp(inviter.id, inviter.email); // registers inviteRoutes
  const authApp = Fastify(); await authApp.register(authRoutes);
  const { raw, hash } = generateInviteToken();
  const invite = await prisma.invite.create({
    data: { email: 'rev@x.io', tokenHash: hash, invitedById: inviter.id,
            expiresAt: new Date(Date.now() + 60_000) }
  });
  try {
    const del = await app.inject({ method: 'DELETE', url: `/invites/${invite.id}` });
    assert.equal(del.statusCode, 200);
    assert.equal((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).status, 'REVOKED');
    const accept = await authApp.inject({ method: 'POST', url: '/auth/accept-invite',
      payload: { token: raw, password: 'sup3rsecret' } });
    assert.equal(accept.statusCode, 400);
  } finally { await app.close(); await authApp.close(); /* cleanup */ }
});

test('GET /invites lists PENDING invites for a superadmin and omits tokenHash', async () => {
  const app = await buildApp(superadmin.id, superadmin.email);
  await prisma.invite.create({ data: { email: 'list@x.io', tokenHash: generateInviteToken().hash,
    invitedById: superadmin.id, expiresAt: new Date(Date.now() + 60_000) } });
  try {
    const res = await app.inject({ method: 'GET', url: '/invites' });
    assert.equal(res.statusCode, 200);
    const rows = res.json();
    assert.ok(rows.some((r: { email: string }) => r.email === 'list@x.io'));
    assert.ok(rows.every((r: object) => !('tokenHash' in r)));
  } finally { await app.close(); /* cleanup */ }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-manage.test.ts`
Expected: FAIL — routes not registered (404).

- [ ] **Step 3: Add the routes**

In `backend/src/routes/invites.ts`:

```ts
fastify.delete<{ Params: { id: string } }>('/invites/:id', async (req, reply) => {
  const invite = await prisma.invite.findUnique({ where: { id: req.params.id } });
  if (!invite) return reply.status(404).send({ error: 'Not found' });
  if (invite.invitedById !== req.user.userId) await requireSuperadmin(req.user.userId); // else inviter ok
  await prisma.invite.update({ where: { id: invite.id }, data: { status: 'REVOKED' } });
  return { ok: true };
});

fastify.get('/invites', async (req) => {
  const select = { id: true, email: true, status: true, groupId: true, teamId: true,
                   invitedById: true, expiresAt: true, createdAt: true }; // no tokenHash
  if (await isSuperadmin(req.user.userId)) {
    return prisma.invite.findMany({ where: { status: 'PENDING' }, select });
  }
  // teams_manage delegate: invites for teams on projects they manage
  const teamIds = await manageableTeamIds(req.user.userId); // teams on projects where hasScope teams_manage
  return prisma.invite.findMany({ where: { status: 'PENDING', teamId: { in: teamIds } }, select });
});
```

> `isSuperadmin` / `manageableTeamIds` are thin wrappers over the 2.3 helpers (`isSuperadmin` = boolean form of `requireSuperadmin`; `manageableTeamIds` resolves teams whose `TeamProject` project passes `hasScope(projectId, userId, 'teams_manage')`). Add them beside the route or in `utils/rbac` if 2.3 does not already expose them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx dotenv -e ../.env -- tsx --test tests/invite-manage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/invites.ts backend/tests/invite-manage.test.ts
git commit -m "feat(invites): DELETE /invites/:id revoke + GET /invites list (gated, no token leak)"
```

---

### Task 7: Frontend public accept page

**Files:**
- Create: `frontend/src/pages/AcceptInvitePage.tsx`
- Modify: `frontend/src/App.tsx` (add a public `/accept-invite` route beside `/login`, outside `ProtectedRoute` ~39)
- Modify: `frontend/src/api/client.ts` (add `validateInvite` + `acceptInvite` helpers)
- Test: `frontend/tests/accept-invite.test.ts`

**Interfaces:**
- Consumes: `GET /auth/invite` (Task 4), `POST /auth/accept-invite` (Task 5). Uses the shared `api` instance — no token → no `Authorization` header; a `400` never trips the `401` logout interceptor (`AuthContext.tsx:36-47`).
- Produces:
  - `validateInvite(token: string): Promise<{ email: string }>`
  - `acceptInvite(token: string, password: string): Promise<{ ok: true }>`
  - `AcceptInvitePage` at `/accept-invite?token=` (public): validates on mount, shows the email, collects a password (`min(8)`), accepts, then routes to `/login`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/accept-invite.test.ts` (unit-level: the client helpers hit the right paths):

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInvite, acceptInvite, api } from '../src/api/client';

test('validateInvite GETs /auth/invite with the token param', async () => {
  const calls: any[] = [];
  const restore = api.get;
  (api as any).get = async (url: string, cfg: any) => { calls.push({ url, cfg }); return { data: { email: 'x@y.io' } }; };
  try {
    const out = await validateInvite('RAW');
    assert.equal(out.email, 'x@y.io');
    assert.equal(calls[0].url, '/auth/invite');
    assert.equal(calls[0].cfg.params.token, 'RAW');
  } finally { (api as any).get = restore; }
});

test('acceptInvite POSTs token + password to /auth/accept-invite', async () => {
  const calls: any[] = [];
  const restore = api.post;
  (api as any).post = async (url: string, body: any) => { calls.push({ url, body }); return { data: { ok: true } }; };
  try {
    const out = await acceptInvite('RAW', 'sup3rsecret');
    assert.deepEqual(out, { ok: true });
    assert.equal(calls[0].url, '/auth/accept-invite');
    assert.deepEqual(calls[0].body, { token: 'RAW', password: 'sup3rsecret' });
  } finally { (api as any).post = restore; }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx tsx --test tests/accept-invite.test.ts`
Expected: FAIL — `validateInvite` / `acceptInvite` not exported.

- [ ] **Step 3: Add the client helpers**

In `frontend/src/api/client.ts`:

```ts
export const validateInvite = (token: string) =>
  api.get<{ email: string }>('/auth/invite', { params: { token } }).then((r) => r.data);

export const acceptInvite = (token: string, password: string) =>
  api.post<{ ok: true }>('/auth/accept-invite', { token, password }).then((r) => r.data);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx tsx --test tests/accept-invite.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the page + register the public route**

Create `frontend/src/pages/AcceptInvitePage.tsx`: read `token` via `useSearchParams`; on mount call `validateInvite(token)` — on failure show a generic "invalid or expired invite" message; on success show the email (read-only) and an AntD password form (`min(8)`) that calls `acceptInvite(token, password)` then `navigate('/login')` with a success notice. In `frontend/src/App.tsx`, add `<Route path="/accept-invite" element={<AcceptInvitePage />} />` as a sibling of the `/login` route (~39), i.e. outside `ProtectedRoute`.

- [ ] **Step 6: Manually verify the end-to-end flow**

Create an invite via `POST /invites` (SMTP unset → link logged in the backend console); open `/accept-invite?token=<raw>`; confirm the email renders, a `<8`-char password is rejected, a valid password accepts and routes to `/login`, and the new user can log in. Re-opening the same link 400s (single-use).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/AcceptInvitePage.tsx frontend/src/App.tsx frontend/src/api/client.ts frontend/tests/accept-invite.test.ts
git commit -m "feat(invites): public accept-invite page + client helpers"
```

---

## Self-Review

**Spec coverage:** R1 (`Invite` + `InviteStatus`, migrate PENDING, drop `ProjectMember`/`ProjectMemberStatus`) → Task 2. R2 (mailer, SMTP-or-log, `sendMail`/`sendInviteEmail`, `APP_URL`) → Task 1. R3 (`POST /invites`: authority matrix, `randomBytes(32).base64url` + sha256 store-only-hash, TTL, re-issue, rate-limit, reject existing usable user) → Task 3. R4 (`GET /auth/invite` public, `{email}` or generic 400, lazy EXPIRED) → Task 4. R5 (`POST /auth/accept-invite` public, tx upsert user + VIEWER floor + TeamMember + single-use, password `min(8)`, rate-limit; chose `{ok:true}`) → Task 5. R6 (`DELETE /invites/:id` revoke + `GET /invites` gated, no token leak) → Task 6. R7 (public `AcceptInvitePage` + route; admin form/list out of scope) → Task 7. All mapped.

**Security requirements:** ≥256-bit CSPRNG + sha256-only storage → Task 3 (`invite-token.ts`, `tokenHash @unique` in Task 2, asserted `length === 64` and re-issue rotates hash). Single-use + TTL + revocation honored → Tasks 4/5/6 (status flip, `expiresAt` checks, REVOKED never accepts — asserted). Rate-limiting → Tasks 3 (`/invites`), 4 (`/auth/invite`), 5 (`/auth/accept-invite`). Password length → Task 5 (`min(8)`, asserted). No user enumeration → Task 4 (generic 400) + Task 6 (`GET /invites` omits `tokenHash`). Public routes strictly `GET /auth/invite` + `POST /auth/accept-invite` → Tasks 4/5 whitelist edits only.

**Placeholder scan:** every code step carries real code or an exact edit target with cited line numbers (`schema.prisma:168-184/212-215/20/40`, `index.ts:106-118/200-211`, `auth.ts:12-15/93`, `App.tsx:39`, `AuthContext.tsx:36-47`, harness `data-case-run.test.ts:17-58`). Task 2 Step 4 states its no-app-test reason (dropped table) and gives the scratch-DB verification instead.

**Type consistency:** `hashInviteToken(raw) → string` and `generateInviteToken() → {raw,hash}` used identically in Tasks 3/4/5. `Invite` fields (`groupId?`, `teamId?`, `invitedById`, `expiresAt`, `acceptedAt?`, `status`) match the R1 model across create/validate/accept/manage. `POST /invites → 201 {id,email,status}`, `GET /auth/invite → {email}`, `POST /auth/accept-invite → {ok:true}`, `GET /invites → Invite[]` (no `tokenHash`) consistent between routes and tests. Consumed 2.2/2.3 surface (`requireSuperadmin`/`hasScope`/`isSuperadmin`, `Group`/`Team`/`TeamProject`/`UserGroup`/`TeamMember`, `VIEWER_GROUP_NAME`) named uniformly and flagged as dependencies in Global Constraints.

**Ordering:** 1 (mailer) before 3 (create emails the link). 2 (schema: `Invite` + drop `ProjectMember`) before 3–6 (routes need the model) and before harness/seed compile. 3 before 4/5/6 (shared `invite-token.ts` + the create path the accept/manage tests exercise). 4 and 5 both add to the public whitelist independently; 6 depends on 5's accept path (revoke-then-accept assertion) and 3's routes file. 7 (frontend) after 4/5 (its endpoints exist). Recommended order = task number order.

**Ponytail simplifications (noted, not smuggled):** log transport = nodemailer's built-in `jsonTransport` (no custom transport). Migrated PENDING invites carry an unusable placeholder token (nothing was emailed) — upgrade path is re-issue; spec-allowed log+drop alternative flagged. "Existing usable user" = non-empty `passwordHash` (ceiling commented). Accept returns `{ok:true}` rather than auto-login JWT (spec-permitted, simpler). None touch the security floor (token hashing, TTL/single-use, rate-limit, password length all kept).
