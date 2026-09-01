/*
  Adds the Invite model, migrates PENDING ProjectMember bridge rows into Invite, then drops
  ProjectMember + ProjectMemberStatus. Reordered from the Prisma-generated draft so the data
  migration runs while both tables exist.
*/
-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "groupId" TEXT,
    "teamId" TEXT,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "Invite_status_idx" ON "Invite"("status");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate PENDING ProjectMember bridge rows (2.2 columns invitedGroupId/invitedTeamId) into Invite.
-- ponytail: migrated invites carry an unusable placeholder token (nothing was emailed) — they exist
-- only to preserve the record; upgrade path is re-issue via POST /invites.
INSERT INTO "Invite" ("id","email","tokenHash","status","groupId","teamId","invitedById","expiresAt","createdAt")
SELECT gen_random_uuid()::text,
       pm."email",
       encode(sha256((gen_random_uuid()::text)::bytea), 'hex'),
       'PENDING',
       pm."invitedGroupId",
       pm."invitedTeamId",
       (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1),
       now() + interval '7 days',
       now()
FROM "ProjectMember" pm
WHERE pm."status" = 'PENDING'
  AND EXISTS (SELECT 1 FROM "User");

-- DropForeignKey
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_userId_fkey";

-- DropTable
DROP TABLE "ProjectMember";

-- DropEnum
DROP TYPE "ProjectMemberStatus";
