# RBAC Frontend: Scope-Based Permission Gating + Access UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all frontend authorization off `role` and onto **effective scopes**: gate every project control on a `can(scope)` primitive driven by per-project `currentUserScopes`, replace member-role management with Teams + invites, add a superadmin-only Access console for groups and user↔group assignment, and register the public accept-invite route.

**Architecture:** The server (2.2–2.4) now sends `currentUserScopes: Scope[]` on `GET /projects/:id` (replacing `currentUserRole`) and `isSuperadmin` on `/auth/me` + `/auth/login` (replacing `isSystemAdmin`). The frontend consumes those two shapes only. A pure `deriveProjectGates(scopes)` adapter turns the scope list into named booleans, keeping `ProjectPage` a mechanical rename of its existing flags. The old role dropdown / add-with-password modal and their client calls are deleted; a team-derived member list + invite modal + pending-invites list replace them. A `SuperadminRoute` guard hides the Access console and the public `/accept-invite` route is excluded from the auth guard.

**Tech Stack:** React + Ant Design + TypeScript strict, Vite, axios. Tests: `node:test` + `node:assert/strict` via `tsx --test` (pure-util only).

**Spec:** `docs/superpowers/specs/2026-08-20-rbac-frontend.md`

## Global Constraints

- Frontend: React + Ant Design + TypeScript strict, Vite. Frontend tests: `cd frontend && npx tsx --test tests/<file>.test.ts` (node:test + node:assert/strict); pure-util tests only, no new e2e framework.
- Reuse existing AntD components/patterns; no visual redesign beyond swapping controls.
- Branding "ShipItAnyway".
- **Consumed backend contract (delivered by 2.2/2.3/2.4 — not built here):** `GET /projects/:id` emits `currentUserScopes: Scope[]` in place of `currentUserRole`; `/auth/me` + `/auth/login` emit `isSuperadmin` in place of `isSystemAdmin`; endpoints `/groups`, `/users`, `/users/:id/groups`, `/teams`, `/teams/:id/members`, `/teams/:id/projects`, `/invites`, and the reshaped `GET /projects/:id/members` (team-derived) exist. **Dependency to flag:** if `GET /projects/:id` still returns `currentUserRole` at implementation time, that one-line server change (emit `currentUserScopes` from the caller's effective scopes) is the single backend touch this plan assumes from 2.1/2.2 — surface it to the backend owner rather than re-adding a role path here.
- Acceptance grep must stay clean: no `ProjectRole`, `currentUserRole`, `isOwner`, `isEditor`, `isViewer`, `isSystemAdmin` remain in `frontend/src` after this plan.

---

### Task 1: Scope catalog, `deriveProjectGates` adapter, and workspace type swap

**Spec:** R1 (add `Scope`, drop `currentUserRole`/`ProjectRole`/`ProjectMemberStatus`), R2 (`can()` primitive).

**Files:**
- Create: `frontend/src/utils/scopes.ts`
- Test: `frontend/tests/scopes.test.ts`
- Modify: `frontend/src/types/index.ts` (drop `ProjectRole` ~116, `ProjectMemberStatus` ~117, `currentUserRole` on `ProjectWorkspace` ~110 and `ProjectSummary` ~137; add `Scope` re-export + `currentUserScopes` on `ProjectWorkspace`)

**Interfaces:**
- Produces:
  - `Scope = 'checks:edit' | 'runs:trigger' | 'schedules:edit' | 'environments:edit' | 'alerts:edit' | 'teams:manage' | 'members:read'`
  - `can(scopes: Scope[], scope: Scope): boolean`
  - `isReadOnly(scopes: Scope[]): boolean` (no `*:edit` present)
  - `deriveProjectGates(scopes: Scope[]): ProjectGates` (named booleans consumed by `ProjectPage`)
  - `ProjectWorkspace.currentUserScopes?: Scope[]`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/scopes.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { can, isReadOnly, deriveProjectGates, type Scope } from '../src/utils/scopes';

const EDITOR: Scope[] = ['checks:edit', 'runs:trigger', 'schedules:edit', 'environments:edit', 'alerts:edit'];

test('can() is scope membership', () => {
  assert.equal(can(['checks:edit'], 'checks:edit'), true);
  assert.equal(can(['checks:edit'], 'schedules:edit'), false);
  assert.equal(can([], 'runs:trigger'), false);
});

test('isReadOnly is true only when no *:edit scope is present', () => {
  assert.equal(isReadOnly([]), true);
  assert.equal(isReadOnly(['teams:manage', 'members:read']), true);
  assert.equal(isReadOnly(['runs:trigger']), true);
  assert.equal(isReadOnly(['alerts:edit']), false);
});

test('deriveProjectGates maps a read-only scope set to all-false gates', () => {
  const g = deriveProjectGates([]);
  assert.deepEqual(g, {
    canEditChecks: false, canTriggerRuns: false, canEditSchedules: false,
    canEditEnvironments: false, canEditAlerts: false, canManageTeams: false,
    canReadMembers: false, readOnly: true
  });
});

test('deriveProjectGates unlocks per-feature gates for an editor-equivalent set', () => {
  const g = deriveProjectGates(EDITOR);
  assert.equal(g.canEditChecks, true);
  assert.equal(g.canTriggerRuns, true);
  assert.equal(g.canEditSchedules, true);
  assert.equal(g.canEditEnvironments, true);
  assert.equal(g.canEditAlerts, true);
  assert.equal(g.canManageTeams, false);
  assert.equal(g.readOnly, false);
});

test('deriveProjectGates surfaces teams-manage and members-read independently', () => {
  const g = deriveProjectGates(['teams:manage', 'members:read']);
  assert.equal(g.canManageTeams, true);
  assert.equal(g.canReadMembers, true);
  assert.equal(g.readOnly, true); // no *:edit
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx tsx --test tests/scopes.test.ts`
Expected: FAIL — `../src/utils/scopes` module not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/utils/scopes.ts`:

```ts
export type Scope =
  | 'checks:edit'
  | 'runs:trigger'
  | 'schedules:edit'
  | 'environments:edit'
  | 'alerts:edit'
  | 'teams:manage'
  | 'members:read';

export function can(scopes: Scope[], scope: Scope): boolean {
  return scopes.includes(scope);
}

export function isReadOnly(scopes: Scope[]): boolean {
  return !scopes.some((s) => s.endsWith(':edit'));
}

export interface ProjectGates {
  canEditChecks: boolean;
  canTriggerRuns: boolean;
  canEditSchedules: boolean;
  canEditEnvironments: boolean;
  canEditAlerts: boolean;
  canManageTeams: boolean;
  canReadMembers: boolean;
  readOnly: boolean;
}

export function deriveProjectGates(scopes: Scope[]): ProjectGates {
  return {
    canEditChecks: can(scopes, 'checks:edit'),
    canTriggerRuns: can(scopes, 'runs:trigger'),
    canEditSchedules: can(scopes, 'schedules:edit'),
    canEditEnvironments: can(scopes, 'environments:edit'),
    canEditAlerts: can(scopes, 'alerts:edit'),
    canManageTeams: can(scopes, 'teams:manage'),
    canReadMembers: can(scopes, 'members:read'),
    readOnly: isReadOnly(scopes)
  };
}
```

- [ ] **Step 4: Swap the workspace/summary types**

In `frontend/src/types/index.ts`:
- Add near the top: `import type { Scope } from '../utils/scopes';` and `export type { Scope };`
- `ProjectWorkspace` (~110): remove `currentUserRole?: ProjectRole;`, add `currentUserScopes?: Scope[];`
- `ProjectSummary` (~137): remove `currentUserRole?: ProjectRole | null;`
- Delete `export type ProjectRole` (~116) and `export type ProjectMemberStatus` (~117). (`ProjectMember` is re-shaped in Task 3 — leave its declaration for now but it will no longer reference `ProjectRole`/`ProjectMemberStatus` after Task 3; if TS errors here on the dangling references, jump to Task 3's type edit first.)

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx tsx --test tests/scopes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/scopes.ts frontend/tests/scopes.test.ts frontend/src/types/index.ts
git commit -m "feat(rbac): scope catalog + deriveProjectGates adapter; workspace carries currentUserScopes"
```

---

### Task 2: `AuthContext` — `isSystemAdmin` → `isSuperadmin`

**Spec:** R1 (`/auth/me` + `/auth/login` emit `isSuperadmin`), R4/R6 (superadmin drives Access console + project creation).

**Files:**
- Modify: `frontend/src/context/AuthContext.tsx` (interface ~11; state ~24; `/auth/me` read ~65-72; login read ~96-106; logout ~115; memo deps ~123-132)

**Interfaces:**
- Consumes: `/auth/me` + `/auth/login` payload field `isSuperadmin: boolean` (2.3 R7).
- Produces: `useAuth()` exposes `isSuperadmin: boolean` (keeps `canCreateProject`); `isSystemAdmin` removed.

- [ ] **Step 1: Rename the flag end-to-end**

In `frontend/src/context/AuthContext.tsx`, replace every `isSystemAdmin` occurrence with `isSuperadmin`:
- `AuthContextType.isSystemAdmin` → `isSuperadmin` (~11)
- `const [isSystemAdmin, setIsSystemAdmin] = useState(false)` → `isSuperadmin`/`setIsSuperadmin` (~24)
- `/auth/me` generic type + read: `{ …; isSuperadmin: boolean }` and `setIsSuperadmin(Boolean(data.isSuperadmin))` (~65,72)
- catch/reset + logout `setIsSuperadmin(false)` (~81,116)
- `/auth/login` generic type + read (~96,106)
- `value` object + `useMemo` deps (~127,132)

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only at the (not-yet-updated) `isSystemAdmin` consumers in `ProjectPage.tsx` (fixed in Task 4) — none inside `AuthContext.tsx`. (`ProjectsPage.tsx` uses only `canCreateProject`, so it stays clean — verified `ProjectsPage.tsx:82`.)

> No unit test: the adapter is `Boolean(data.isSuperadmin)` — a trivial one-liner (YAGNI, matches the repo's untested AuthContext). Behaviour is exercised by the Task 6 manual-verify.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/AuthContext.tsx
git commit -m "feat(rbac): AuthContext exposes isSuperadmin instead of isSystemAdmin"
```

---

### Task 3: API client — prune member mutations; add groups/users/teams/invites; re-shape `ProjectMember`

**Spec:** R1 (drop member types), R3 (invites + teams replace add-with-password; remove `updateProjectMember`/`deleteProjectMember`/`POST members`), R4 (groups + user↔group).

**Files:**
- Modify: `frontend/src/api/client.ts` (imports ~2-22; remove `addProjectMember` ~95-98, `updateProjectMember` ~100-104, `deleteProjectMember` ~106-107; `getProjectMembers` return type ~87-88; add new methods)
- Modify: `frontend/src/types/index.ts` (re-shape `ProjectMember` ~119-130; add `Group`, `Team`, `Invite`)

**Interfaces:**
- Consumes: `/groups`, `/users`, `/users/:id/groups`, `/teams`, `/teams/:id/members`, `/teams/:id/projects`, `/invites`, `GET /projects/:id/members` (2.3/2.4).
- Produces (types):
  - `ProjectMember = { userId: string; email: string; teams: Team[]; groups: Group[]; scopes: Scope[] }`
  - `Group = { id: string; name: string; isSystem: boolean; isGlobal: boolean; scopes: Scope[] }`
  - `Team = { id: string; name: string; projectId?: string | null }`
  - `Invite = { id: string; email: string; teamId: string | null; groupId: string | null; status: 'PENDING' | 'ACCEPTED' | 'REVOKED'; createdAt: string }`
- Produces (client methods): `getGroups`, `createGroup`, `updateGroup`, `deleteGroup`, `getUsers`, `setUserGroups`, `getTeams`, `createTeam`, `deleteTeam`, `attachTeamToProject`, `detachTeamFromProject`, `getTeamMembers`, `addTeamMember`, `removeTeamMember`, `getInvites`, `createInvite`, `revokeInvite` (`getProjectMembers` kept, new return type).

- [ ] **Step 1: Re-shape the member type + add RBAC types**

In `frontend/src/types/index.ts` replace the `ProjectMember` interface (~119-130) and add the new admin types:

```ts
export interface Group {
  id: string;
  name: string;
  isSystem: boolean;
  isGlobal: boolean;
  scopes: Scope[];
}

export interface Team {
  id: string;
  name: string;
  projectId?: string | null;
}

export interface ProjectMember {
  userId: string;
  email: string;
  teams: Team[];
  groups: Group[];
  scopes: Scope[];
}

export interface Invite {
  id: string;
  email: string;
  teamId: string | null;
  groupId: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  createdAt: string;
}
```

- [ ] **Step 2: Prune removed member calls + add new client methods**

In `frontend/src/api/client.ts`:
- Delete `addProjectMember` (~95-98), `updateProjectMember` (~100-104), `deleteProjectMember` (~106-107).
- Keep `getProjectMembers` but retype: `api.get<ProjectMember[]>(...)` (return type now the team-derived shape — no code change beyond the type import staying valid).
- Add the imports for `Group`, `Team`, `Invite` and append:

```ts
// Groups (superadmin)
export const getGroups = () => api.get<Group[]>('/groups').then((r) => r.data);
export const createGroup = (data: { name: string; scopes: string[] }) =>
  api.post<Group>('/groups', data).then((r) => r.data);
export const updateGroup = (id: string, data: Partial<{ name: string; scopes: string[] }>) =>
  api.patch<Group>(`/groups/${id}`, data).then((r) => r.data);
export const deleteGroup = (id: string) => api.delete(`/groups/${id}`);

// Users + global group assignment (superadmin)
export const getUsers = () =>
  api.get<Array<{ id: string; email: string; groups: Group[] }>>('/users').then((r) => r.data);
export const setUserGroups = (userId: string, groupIds: string[]) =>
  api.put(`/users/${userId}/groups`, { groupIds });

// Teams (per-project, teams:manage)
export const getTeams = (projectId: string) =>
  api.get<Team[]>('/teams', { params: { projectId } }).then((r) => r.data);
export const createTeam = (data: { name: string; projectId: string }) =>
  api.post<Team>('/teams', data).then((r) => r.data);
export const deleteTeam = (id: string) => api.delete(`/teams/${id}`);
export const attachTeamToProject = (teamId: string, projectId: string) =>
  api.post(`/teams/${teamId}/projects`, { projectId });
export const detachTeamFromProject = (teamId: string, projectId: string) =>
  api.delete(`/teams/${teamId}/projects/${projectId}`);
export const getTeamMembers = (teamId: string) =>
  api.get<Array<{ userId: string; email: string }>>(`/teams/${teamId}/members`).then((r) => r.data);
export const addTeamMember = (teamId: string, email: string) =>
  api.post(`/teams/${teamId}/members`, { email });
export const removeTeamMember = (teamId: string, userId: string) =>
  api.delete(`/teams/${teamId}/members/${userId}`);

// Invites (2.4)
export const getInvites = (projectId: string) =>
  api.get<Invite[]>('/invites', { params: { projectId } }).then((r) => r.data);
export const createInvite = (data: { email: string; projectId: string; teamId?: string; groupId?: string }) =>
  api.post<Invite>('/invites', data).then((r) => r.data);
export const revokeInvite = (id: string) => api.delete(`/invites/${id}`);
```

> No unit test: these are thin axios wrappers (matches the repo — `client.ts` is untested). Their consumption is covered by the Task 5/Task 6 manual-verify; the payload shapes are asserted by the 2.2–2.4 backend route tests.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: remaining errors only in `ProjectPage.tsx` (still referencing the removed calls/flags) — resolved in Tasks 4 & 5.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/types/index.ts
git commit -m "feat(rbac): client methods for groups/users/teams/invites; team-derived ProjectMember; drop role member calls"
```

---

### Task 4: `ProjectPage` gating — replace role flags with `deriveProjectGates` + `isSuperadmin`

**Spec:** R2 (per-feature scope at every button and guard clause; read-only banner on no `*:edit`).

**Files:**
- Modify: `frontend/src/pages/ProjectPage.tsx` (flag block ~543-551; `load` member fetch condition ~566; imports ~52-90; ~20 usage sites — full list below)

**Interfaces:**
- Consumes: `deriveProjectGates` (Task 1), `useAuth().isSuperadmin` (Task 2), `ProjectWorkspace.currentUserScopes` (Task 1).
- Produces: no role flags remain; each control gates on its `gates.*` boolean; project delete gates on `isSuperadmin`.

**Flag → gate mapping** (applied at both the handler guard clause *and* the button `disabled`/`type`):

| Old flag | New source | Sites (line ~) |
|---|---|---|
| `canManageEnvironments` | `gates.canEditEnvironments` | 660,672,684,717,2224,2227,2248,2258,2259,2266,2310,2906,2950,2962,2974,2986,2994 |
| `canManageSchedules` | `gates.canEditSchedules` | 962,972,982,1013,1034,1048,2047,2050,2070,2080,2081,2088,2165 |
| `canWriteProject` (checks) | `gates.canEditChecks` | 1134,1140,1173,1538,1546,1643,1649,1655,1953,1959,1965 |
| `canWriteProject` (run/trigger) | `gates.canTriggerRuns` | 1071/1103 (run-check),1192/1202 (run-suite),1659,1822,2031 |
| `canWriteProject` (channels) | `gates.canEditAlerts` | 734,756,778,864,916,930,940,2368,2371,2392,2395,2404,2405,2412,2475 |
| `isViewer` (settings + banner) | `gates.readOnly` | 1626 (banner),2539,2560,2576,2604,2613,2616 |
| `canManageMembers` (tab) | `gates.canReadMembers` | 1456,2727 (Members tab visibility) |
| `isOwner` (delete project) | `isSuperadmin` | 1281,2718 |

- [ ] **Step 1: Replace the flag block**

In `ProjectPage.tsx`, remove `currentUserRole`/`isViewer`/`isEditor`/`isOwner`/`canWriteProject`/`canManageMembers`/`canManageSchedules`/`canManageEnvironments` (~543-550) and `isProtectedAdminMember` (~551, obsolete). Add, importing `deriveProjectGates` from `../utils/scopes` and `useAuth` (already imported for other state — confirm):

```ts
const { isSuperadmin } = useAuth();
const gates = deriveProjectGates(project?.currentUserScopes ?? []);
```

- [ ] **Step 2: Rewrite the member fetch condition**

`load` (~566): change `projectData.currentUserRole === 'OWNER' ? getProjectMembers(...)` to
`can(projectData.currentUserScopes ?? [], 'members:read') ? getProjectMembers(projectId!) : Promise.resolve([])` (import `can`).

- [ ] **Step 3: Swap every usage site per the mapping table**

Mechanical replace at each line above: `canManageEnvironments → gates.canEditEnvironments`, `canManageSchedules → gates.canEditSchedules`, `canWriteProject → gates.canEditChecks | gates.canTriggerRuns | gates.canEditAlerts` (per the table's site split), `isViewer → gates.readOnly`, `canManageMembers → gates.canReadMembers`, `isOwner → isSuperadmin`. Guard-clause `message.info('Read-only access')` bodies stay; only the condition changes. (The Members-tab body at 2727 and its handlers are rebuilt in Task 5 — this task only fixes the tab-visibility gate; leave the old member table compiling by keeping Task 5's edits in the same branch or expect a transient TS error resolved there.)

- [ ] **Step 4: Type-check + smoke the whole page**

Run: `cd frontend && npx tsc --noEmit`
Expected: no `isViewer`/`isOwner`/`canWrite*`/`currentUserRole` references remain; residual errors only from the still-present old member modal/handlers (Task 5).
Run: `grep -nE "isOwner|isEditor|isViewer|canManage|canWriteProject|currentUserRole" frontend/src/pages/ProjectPage.tsx`
Expected: no matches.

> No unit test: the gating logic under test lives in `deriveProjectGates` (Task 1); which button renders is verified by Step 6 manual-verify (component-level, no e2e — YAGNI).

- [ ] **Step 5: Commit** (may be squashed with Task 5 if the page doesn't compile alone)

```bash
git add frontend/src/pages/ProjectPage.tsx
git commit -m "feat(rbac): gate ProjectPage controls on scope-derived gates + isSuperadmin"
```

- [ ] **Step 6: Manually verify**

With a read-only scope set: every edit/trigger/manage button hidden or disabled and the read-only banner shows; with an editor-equivalent set: check/schedule/env/alert/run controls enabled, Members tab hidden (no `members:read`); with `teams:manage`+`members:read`: Members tab visible, edit controls still gated. Confirm no dead buttons (each matches a server 403).

---

### Task 5: `ProjectPage` Members tab — Teams + invites replace role management

**Spec:** R3 (team-derived member list, team controls gated `teams:manage`, invite modal replaces add-with-password with superadmin-only group field, pending invites with revoke; remove old modal/handlers).

**Files:**
- Modify: `frontend/src/pages/ProjectPage.tsx` (member state ~529-538; member handlers ~1306-1437; Members tab render ~2727-2801; member modal ~3191-3245; imports ~52-90)

**Interfaces:**
- Consumes: `getProjectMembers`, `getTeams`/`createTeam`/`deleteTeam`/`attachTeamToProject`/`detachTeamFromProject`/`getTeamMembers`/`addTeamMember`/`removeTeamMember`, `getInvites`/`createInvite`/`revokeInvite` (Task 3); `gates.canManageTeams`, `gates.canReadMembers`, `isSuperadmin` (Task 4).
- Produces: team-derived member list (no role column); team management + invite UI; pending-invites list.

- [ ] **Step 1: Remove the old member state, handlers, and modal**

Delete: `memberModalOpen`/`memberSaving`/`memberLookupLoading`/`memberUserExists`/`memberForm` state (~530-538) except keep `projectMembers` (~529); `openMemberInvite` (~1306-1311), the email-lookup `useEffect` (~1313-1353), `handleCreateUserAccess` (~1355-1411), `handleChangeMemberRole` (~1413-1422), `handleRemoveMember` (~1424-1437); the "Create user access" `<Modal>` (~3191-3245); and imports of `addProjectMember`/`updateProjectMember`/`deleteProjectMember`/`checkUserExists`/`ProjectRole` (~52-90). Remove `isPotentialEmail` usage if now unused.

- [ ] **Step 2: Add teams + invites state and loaders**

Add state: `teams: Team[]`, `invites: Invite[]`, `inviteModalOpen`, `inviteForm: { email: string; teamId?: string; groupId?: string }`, `inviteSaving`, `teamModalOpen`, `newTeamName`. Extend `load` (or a `loadMembersTab` run when the Members tab activates and `gates.canReadMembers`) to also fetch `getTeams(projectId)` and, when `gates.canManageTeams`, `getInvites(projectId)`. Add handlers: `handleCreateTeam`, `handleDeleteTeam`, `handleAttachTeam`, `handleAddTeamMember`, `handleRemoveTeamMember`, `handleCreateInvite`, `handleRevokeInvite` — each wrapping the Task 3 client call + `message` + reload, guarded on `gates.canManageTeams` (invite/team mutations) and following the existing error-extraction pattern (`error.response.data.error`).

- [ ] **Step 3: Rebuild the Members tab render**

Replace the tab body (~2727-2801). Structure (reuse existing AntD `Card`/`Table`/`Space`/`Tag`/`Button`/`Modal`/`Select`):
- **Member list** `Table<ProjectMember>` columns: *Name / Email* (`row.email`), *Teams* (`row.teams.map(t => <Tag>)`), *Effective scopes* (`row.scopes.map(s => <Tag>)`). No role column, no per-row role `Select`, no Remove-by-role.
- **Teams card** (render only when `gates.canManageTeams`): list `teams` with attach/detach + delete; a "Create team" control (`newTeamName` → `handleCreateTeam`); per-team member add (email `Input` → `handleAddTeamMember`) / remove.
- **Invite button** in the card `extra` (gated `gates.canManageTeams`) opens the invite modal; a **Pending invites** `Table<Invite>` (filter `status === 'PENDING'`) with a Revoke button (`handleRevokeInvite`).

- [ ] **Step 4: Add the invite modal**

New `<Modal>` (replaces the deleted one) bound to `inviteModalOpen`: `email` `Input`; optional team `Select` from `teams`; **group `Select` rendered only when `isSuperadmin`** (options from a superadmin group list — reuse `getGroups` if already loaded, else omit for non-superadmin entirely per spec: capability is superadmin-only). `onOk` → `handleCreateInvite` → `createInvite({ email, projectId, teamId, groupId })`.

- [ ] **Step 5: Type-check + grep**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (whole frontend compiles now that Task 4 + Task 5 are both in).
Run: `grep -nE "ProjectRole|updateProjectMember|deleteProjectMember|addProjectMember|handleChangeMemberRole|memberForm" frontend/src/pages/ProjectPage.tsx`
Expected: no matches.

- [ ] **Step 6: Manually verify**

As a `teams:manage` user: create/attach a team, add/remove a member, send an invite (email + team) — **no** group field visible, no superadmin console link. As a superadmin on the same modal: the group field appears. Confirm pending invites list + revoke work, and the old role dropdown / add-with-password modal are gone.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ProjectPage.tsx
git commit -m "feat(rbac): Members tab shows team-derived members with team management + invites"
```

---

### Task 6: Superadmin Access console (groups + user↔group assignment)

**Spec:** R4 (list/create/edit/delete custom groups with scope multi-select; system groups read-only; list users + assign/unassign global groups; superadmin-floor error inline).

**Files:**
- Create: `frontend/src/pages/AccessConsolePage.tsx`
- Modify: `frontend/src/App.tsx` (import + `SuperadminRoute` guard + `/access` route)

**Interfaces:**
- Consumes: `getGroups`/`createGroup`/`updateGroup`/`deleteGroup`, `getUsers`/`setUserGroups` (Task 3); `useAuth().isSuperadmin` (Task 2); `Scope` catalog (Task 1) for the scope multi-select options.
- Produces: route-guarded `/access` page; hidden entirely for non-superadmins.

- [ ] **Step 1: Build the Access console page**

Create `frontend/src/pages/AccessConsolePage.tsx` — an AntD `Tabs` page (reuse `Layout`/`Content`/`AppFooter` like the other pages):
- **Groups tab:** `Table<Group>` (name, `isSystem` tag, scopes as `Tag`s). "New group" `Modal` with a name `Input` + a `Select mode="multiple"` whose options are the `Scope` catalog (`createGroup`). Edit/delete actions on **custom** groups only (`isSystem` rows render read-only — no edit/delete buttons). Errors via the existing `error.response.data.error` pattern.
- **Users tab:** `Table` from `getUsers()` (email + current global groups as `Tag`s); a per-row `Select mode="multiple"` of groups → `setUserGroups(userId, groupIds)`. On the 2.3 R6 superadmin-floor error (removing the last superadmin), surface `error.response.data.error` inline via `message.error` and reload so the UI reflects the unchanged assignment.

- [ ] **Step 2: Guard + register the route**

In `frontend/src/App.tsx`:
- Add a `SuperadminRoute` mirroring `ProtectedRoute` (~19-31) that additionally checks `useAuth().isSuperadmin` and `<Navigate to="/dashboard" replace />` otherwise.
- Import `AccessConsolePage` and add inside the protected `<Routes>`: `<Route path="/access" element={<SuperadminRoute><AccessConsolePage /></SuperadminRoute>} />`.
- (Navigation entry to `/access` — add to the existing app nav/menu only where superadmin; if the nav is shared, gate the link on `isSuperadmin`. Keep it a single conditional link, no new nav component.)

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

> No unit test: page composition + axios wrappers; the gating primitive is already unit-tested (Task 1) and route-guarding is verified manually below (no e2e — YAGNI).

- [ ] **Step 4: Manually verify**

As superadmin: `/access` loads; create a custom group with scopes, edit/delete it; system groups are read-only; assign/unassign a user's global groups; trigger the last-superadmin removal and see the floor error inline. As a non-superadmin: `/access` redirects to `/dashboard` and no console link shows.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AccessConsolePage.tsx frontend/src/App.tsx
git commit -m "feat(rbac): superadmin Access console for groups + user-group assignment"
```

---

### Task 7: Public accept-invite route + project-creation gating verification

**Spec:** R5 (`/accept-invite` public, excluded from auth guard), R6 (`canCreateProject` gate stays; no role refs in `ProjectsPage`).

**Files:**
- Modify: `frontend/src/App.tsx` (register public `/accept-invite` route outside `ProtectedRoute`)
- Verify: `frontend/src/pages/ProjectsPage.tsx` (no role refs; `canCreateProject` gate intact)

**Interfaces:**
- Consumes: `AcceptInvitePage` (built in 2.4 — this task only routes it) and `canCreateProject` from `useAuth` (unchanged).
- Produces: `/accept-invite` reachable unauthenticated; project-creation affordance gated on `canCreateProject`.

- [ ] **Step 1: Register the public route**

In `frontend/src/App.tsx`, alongside `<Route path="/login" …>` (~39, sibling of the `/*` `ProtectedRoute` branch):

```tsx
<Route path="/accept-invite" element={<AcceptInvitePage />} />
```

Import `AcceptInvitePage` from `./pages/AcceptInvitePage`. **If 2.4 has not landed `AcceptInvitePage` yet**, this is a hard dependency — flag it and skip only this route registration (do not stub the page here; it is out of scope per spec R5). The `/*` protected branch and its `/login` sibling are untouched, so the guard already excludes this path.

- [ ] **Step 2: Verify `ProjectsPage` is role-clean**

Run: `grep -nE "isOwner|isEditor|isViewer|isSystemAdmin|currentUserRole|ProjectRole" frontend/src/pages/ProjectsPage.tsx`
Expected: no matches (verified: it uses only `canCreateProject`, `ProjectsPage.tsx:82,123,233,236,311,313,505,508`). No change needed — the existing `canCreateProject` gate already reflects the superadmin-only `POST /projects` (2.3 R5).

- [ ] **Step 3: Full type-check + repo-wide grep gate**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.
Run: `grep -rnE "ProjectRole|currentUserRole|\bisOwner\b|\bisEditor\b|\bisViewer\b|isSystemAdmin" frontend/src`
Expected: no matches (acceptance grep-clean).

- [ ] **Step 4: Manually verify**

Open `/accept-invite?token=…` while logged out — the page renders (no redirect to `/login`). Confirm "New project" is offered only when `canCreateProject` is true.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(rbac): register public /accept-invite route; confirm canCreateProject gating"
```

---

## Self-Review

**Spec coverage:** R1 → Task 1 (Scope, `currentUserScopes`, drop `ProjectRole`/`ProjectMemberStatus`/`currentUserRole`) + Task 2 (`isSuperadmin`) + Task 3 (drop member types). R2 → Task 1 (`can`/`deriveProjectGates`) consumed by Task 4 (all ~20 sites + guard clauses per the mapping table). R3 → Task 5 (team-derived list, team controls gated `teams:manage`, invite modal with superadmin-only group field, pending invites, removal of old modal/handlers) + Task 3 (client calls). R4 → Task 6 (Access console: custom-group CRUD, system read-only, user↔group, floor error). R5 → Task 7 Step 1 (public `/accept-invite`). R6 → Task 7 Step 2 (`canCreateProject`, `ProjectsPage` grep-clean). All requirements mapped.

**Placeholder scan:** every code step carries real code or an exact edit target with line numbers; the two "no unit test" steps (Tasks 2, 3, 4, 6) state their reason (trivial one-liner / thin axios wrappers / logic already unit-tested in Task 1) — consistent with the repo's frontend test depth and the spec's "pure helpers only, no e2e" directive.

**Type consistency:** `Scope` union defined once (Task 1), re-exported from `types/index.ts`, and reused for group scope multi-selects (Task 6). `deriveProjectGates(scopes) → ProjectGates` field names (`canEditChecks`/`canTriggerRuns`/`canEditSchedules`/`canEditEnvironments`/`canEditAlerts`/`canManageTeams`/`canReadMembers`/`readOnly`) match exactly between Task 1's implementation, its test, and Task 4's consumption. `ProjectMember` re-shape (Task 3) is consumed only by Task 5's list render (no role column) — the old `role`/`status` fields are gone repo-wide. `isSuperadmin` (Task 2) is the single flag consumed by Tasks 4 (delete project), 5 (invite group field), 6 (route guard). Client method names in Task 3 match their Task 5/6 call sites.

**Ordering:** 1 (types + pure helper, foundational) → 2 (auth flag) → 3 (client + member/admin types) → 4 (page gating, needs 1+2+3) → 5 (Members tab, needs 3+4; Tasks 4 and 5 may land in one branch since the page only fully compiles with both) → 6 (Access console, needs 2+3) → 7 (router + verify, needs 6's page import path settled and 2.4's `AcceptInvitePage`). Recommended order = task number order. External dependencies flagged: `GET /projects/:id` emitting `currentUserScopes` (Global Constraints), the 2.3/2.4 endpoints (Task 3), and `AcceptInvitePage` from 2.4 (Task 7 Step 1).
