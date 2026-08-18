import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { config as loadEnv } from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { FALLBACK_ADMIN_EMAIL } from '../src/constants/admin';

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

async function seedProjectOwners(userId: string) {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      members: {
        where: {
          status: 'ACTIVE'
        },
        select: {
          id: true
        }
      }
    }
  });

  for (const project of projects) {
    if (project.members.length > 0) continue;

    await prisma.projectMember.create({
        data: {
          projectId: project.id,
          userId,
          email: process.env.ADMIN_EMAIL ?? FALLBACK_ADMIN_EMAIL,
          role: 'OWNER',
          status: 'ACTIVE'
        }
      });
  }
}

async function main() {
  const defaultEmail = process.env.ADMIN_EMAIL ?? FALLBACK_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD ?? 'changeme';
  const adminEmails = unique([defaultEmail, FALLBACK_ADMIN_EMAIL]);

  for (const email of adminEmails) {
    await seedAdminUser(email, password);
  }

  console.log(`[Seed] Admin users: ${adminEmails.join(', ')}`);

  const ownerUser = await prisma.user.findUnique({
    where: { email: defaultEmail }
  });

  if (ownerUser) {
    await seedProjectOwners(ownerUser.id);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
