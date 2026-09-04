/**
 * Mint EDITOR and VIEWER tokens for dogfood acceptance gate (Task 9).
 * Uses existing project: PROJECT_ID = cmt2hjnu20000ae04oohhjxw4
 *
 * Run:
 *   cd backend && pnpm exec dotenv -e ../.env -- tsx scripts/mint-dogfood-tokens.ts
 */

import crypto from 'node:crypto';
import prisma from '../src/prisma';
import { hashApiToken } from '../src/utils/api-token';

const PROJECT_ID = 'cmt2hjnu20000ae04oohhjxw4';

function makeRaw(): string {
  return 'sia_' + crypto.randomBytes(20).toString('hex');
}

async function mintToken(userId: string, label: string): Promise<string> {
  const raw = makeRaw();
  await prisma.apiToken.create({
    data: { name: `dogfood-${label}`, tokenHash: hashApiToken(raw), prefix: raw.slice(0, 12), userId }
  });
  return raw;
}

async function grantAccess(userId: string, groupName: 'EDITOR' | 'VIEWER'): Promise<void> {
  const group = await prisma.group.findUniqueOrThrow({ where: { name: groupName } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId: group.id } },
    update: {},
    create: { userId, groupId: group.id }
  });
  // Create a team attached to the project with this user as a member.
  // Use a unique name to avoid conflicts with existing harness teams.
  const teamName = `dogfood-${groupName.toLowerCase()}-${Date.now()}`;
  await prisma.team.create({
    data: {
      name: teamName,
      projects: { create: { projectId: PROJECT_ID } },
      members: { create: { userId } }
    }
  });
}

async function main() {
  const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  // EDITOR user
  const editor = await prisma.user.create({
    data: { email: `dogfood-editor-${uniq()}@example.com`, passwordHash: 'x' }
  });
  await grantAccess(editor.id, 'EDITOR');
  const editorToken = await mintToken(editor.id, 'editor');

  // VIEWER user
  const viewer = await prisma.user.create({
    data: { email: `dogfood-viewer-${uniq()}@example.com`, passwordHash: 'x' }
  });
  await grantAccess(viewer.id, 'VIEWER');
  const viewerToken = await mintToken(viewer.id, 'viewer');

  console.log('EDITOR_TOKEN=' + editorToken);
  console.log('VIEWER_TOKEN=' + viewerToken);
  console.log('');
  console.log('export SIA_MCP_TOKEN=' + editorToken);
  console.log('export DOGFOOD_PROJECT_ID=' + PROJECT_ID);
  console.log('export DOGFOOD_TEST_ID=cmt2rn0rb0005qk6qttvbz7uv');
  console.log('export DOGFOOD_ENV_ID=cmtir9kh90001pj7ec5p9pmrp');
  console.log('');
  console.log('VIEWER (for negative check):');
  console.log('export SIA_MCP_TOKEN=' + viewerToken);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
