-- CreateEnum
CREATE TYPE "Scope" AS ENUM ('runs_read', 'runs_trigger', 'checks_read', 'checks_edit', 'schedules_read', 'schedules_edit', 'environments_read', 'environments_edit', 'environments_reveal_secrets', 'alerts_read', 'alerts_edit', 'members_read', 'teams_manage', 'project_manage', 'project_delete');

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "invitedGroupId" TEXT,
ADD COLUMN     "invitedTeamId" TEXT;

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupScope" (
    "groupId" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,

    CONSTRAINT "GroupScope_pkey" PRIMARY KEY ("groupId","scope")
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamProject" (
    "teamId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "TeamProject_pkey" PRIMARY KEY ("teamId","projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "UserGroup_groupId_idx" ON "UserGroup"("groupId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamProject_projectId_idx" ON "TeamProject"("projectId");

-- AddForeignKey
ALTER TABLE "GroupScope" ADD CONSTRAINT "GroupScope_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroup" ADD CONSTRAINT "UserGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProject" ADD CONSTRAINT "TeamProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamProject" ADD CONSTRAINT "TeamProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Self-seed system groups (INSERT … ON CONFLICT so re-apply is a no-op)
INSERT INTO "Group" ("id","name","isSystem","isGlobal","createdAt") VALUES
  ('grp_viewer','VIEWER',true,false,CURRENT_TIMESTAMP),
  ('grp_editor','EDITOR',true,false,CURRENT_TIMESTAMP),
  ('grp_owner','OWNER',true,false,CURRENT_TIMESTAMP),
  ('grp_superadmin','SUPERADMIN',true,true,CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Group → scopes (must match SYSTEM_GROUPS in backend/src/constants/rbac.ts)
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_viewer', s FROM unnest(ARRAY[
  'runs_read','checks_read','schedules_read','environments_read','alerts_read','members_read'
]::"Scope"[]) AS s
ON CONFLICT DO NOTHING;
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_editor', s FROM unnest(ARRAY[
  'runs_read','checks_read','schedules_read','environments_read','alerts_read','members_read',
  'runs_trigger','checks_edit','schedules_edit','environments_edit','alerts_edit','environments_reveal_secrets'
]::"Scope"[]) AS s
ON CONFLICT DO NOTHING;
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_owner', s FROM unnest(ARRAY[
  'runs_read','checks_read','schedules_read','environments_read','alerts_read','members_read',
  'runs_trigger','checks_edit','schedules_edit','environments_edit','alerts_edit','environments_reveal_secrets',
  'project_manage','project_delete','teams_manage'
]::"Scope"[]) AS s
ON CONFLICT DO NOTHING;
INSERT INTO "GroupScope" ("groupId","scope")
SELECT 'grp_superadmin', s FROM unnest(enum_range(NULL::"Scope")) AS s
ON CONFLICT DO NOTHING;

-- Backfill 1: one Team per Project + TeamProject, with active members as TeamMembers
INSERT INTO "Team" ("id","name","createdAt")
SELECT 'team_' || p."id", p."name" || ' Members', CURRENT_TIMESTAMP
FROM "Project" p
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TeamProject" ("teamId","projectId")
SELECT 'team_' || p."id", p."id" FROM "Project" p
ON CONFLICT DO NOTHING;

INSERT INTO "TeamMember" ("teamId","userId")
SELECT DISTINCT 'team_' || pm."projectId", pm."userId"
FROM "ProjectMember" pm
WHERE pm."status" = 'ACTIVE' AND pm."userId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill 2: each user → the group of their MAX role across all projects (OWNER>EDITOR>VIEWER)
INSERT INTO "UserGroup" ("userId","groupId")
SELECT ranked."userId",
       CASE ranked.max_rank WHEN 3 THEN 'grp_owner' WHEN 2 THEN 'grp_editor' ELSE 'grp_viewer' END
FROM (
  SELECT pm."userId" AS "userId",
         MAX(CASE pm."role" WHEN 'OWNER' THEN 3 WHEN 'EDITOR' THEN 2 ELSE 1 END) AS max_rank
  FROM "ProjectMember" pm
  WHERE pm."status" = 'ACTIVE' AND pm."userId" IS NOT NULL
  GROUP BY pm."userId"
) ranked
ON CONFLICT DO NOTHING;

-- Backfill 3: protected-admin emails present as Users → SUPERADMIN (global).
-- Emails = getProtectedAdminEmails() (ADMIN_EMAIL + FALLBACK_ADMIN_EMAIL 'admin@shipitanyway.app', lower-cased).
INSERT INTO "UserGroup" ("userId","groupId")
SELECT u."id", 'grp_superadmin'
FROM "User" u
WHERE lower(u."email") IN ('admin@shipitanyway.app')
ON CONFLICT DO NOTHING;

-- Backfill 4: record invite intent on PENDING (userId IS NULL) ProjectMember rows
UPDATE "ProjectMember" pm SET
  "invitedTeamId"  = 'team_' || pm."projectId",
  "invitedGroupId" = CASE pm."role" WHEN 'OWNER' THEN 'grp_owner'
                                    WHEN 'EDITOR' THEN 'grp_editor' ELSE 'grp_viewer' END
WHERE pm."userId" IS NULL;
