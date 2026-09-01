import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { config as loadEnv } from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { FALLBACK_ADMIN_EMAIL } from '../src/constants/admin';
import { SYSTEM_GROUPS } from '../src/constants/rbac';

const prisma = new PrismaClient();

if (!process.env.DATABASE_URL) {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env')
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const loaded = loadEnv({ path: envPath });
      dotenvExpand.expand(loaded);
      break;
    }
  }
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function seedAdminUser(email: string, password: string) {
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12)
    }
  });
}

export async function seedSystemGroups() {
  for (const spec of SYSTEM_GROUPS) {
    const group = await prisma.group.upsert({
      where: { name: spec.name },
      update: { isSystem: true, isGlobal: spec.isGlobal },
      create: { name: spec.name, isSystem: true, isGlobal: spec.isGlobal }
    });
    // GroupScope set is authoritative for system groups
    await prisma.groupScope.deleteMany({
      where: { groupId: group.id, scope: { notIn: spec.scopes } }
    });
    for (const scope of spec.scopes) {
      await prisma.groupScope.upsert({
        where: { groupId_scope: { groupId: group.id, scope } },
        update: {},
        create: { groupId: group.id, scope }
      });
    }
  }
}

export async function seedAdminSuperGroup(userId: string) {
  const superadmin = await prisma.group.findUniqueOrThrow({ where: { name: 'SUPERADMIN' } });
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId: superadmin.id } },
    update: {},
    create: { userId, groupId: superadmin.id }
  });
}

async function main() {
  const defaultEmail = process.env.ADMIN_EMAIL ?? FALLBACK_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD ?? 'changeme';
  const adminEmails = unique([defaultEmail, FALLBACK_ADMIN_EMAIL]);

  for (const email of adminEmails) {
    await seedAdminUser(email, password);
  }

  console.log(`[Seed] Admin users: ${adminEmails.join(', ')}`);

  await seedSystemGroups();

  const ownerUser = await prisma.user.findUnique({
    where: { email: defaultEmail }
  });

  if (ownerUser) {
    await seedAdminSuperGroup(ownerUser.id);
  }
}

if (/[\\/]seed\.(ts|js)$/.test(process.argv[1] ?? '')) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
