import crypto from 'node:crypto';
import { Scope } from '@prisma/client';
import prisma from '../prisma';

export function hashApiToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function resolveApiToken(
  authHeader?: string
): Promise<{ userId: string; email: string; scopes: Scope[] } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const raw = authHeader.slice('Bearer '.length).trim();
  if (!raw.startsWith('sia_')) return null;

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: { user: { select: { id: true, email: true } } }
  });
  if (!token || token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt <= new Date()) return null;

  await prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { userId: token.user.id, email: token.user.email, scopes: token.scopes };
}
