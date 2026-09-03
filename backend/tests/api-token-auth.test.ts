import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import prisma from '../src/prisma';
import { hashApiToken, resolveApiToken } from '../src/utils/api-token';

const uniq = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test('resolveApiToken returns the owning user for a valid token and bumps lastUsedAt', async () => {
  const user = await prisma.user.create({
    data: { email: `svc-${uniq()}@example.com`, passwordHash: 'x', isServiceAccount: true }
  });
  const raw = `sia_${crypto.randomBytes(20).toString('hex')}`;
  await prisma.apiToken.create({
    data: { name: 'ci', tokenHash: hashApiToken(raw), prefix: raw.slice(0, 12), userId: user.id }
  });
  try {
    const resolved = await resolveApiToken(`Bearer ${raw}`);
    assert.ok(resolved);
    assert.equal(resolved!.userId, user.id);
    assert.equal(resolved!.email, user.email);
    const row = await prisma.apiToken.findFirst({ where: { userId: user.id } });
    assert.ok(row!.lastUsedAt);
  } finally {
    await prisma.apiToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test('resolveApiToken rejects revoked, expired, non-sia, and absent headers', async () => {
  const user = await prisma.user.create({
    data: { email: `svc-${uniq()}@example.com`, passwordHash: 'x' }
  });
  const revoked = `sia_${crypto.randomBytes(20).toString('hex')}`;
  const expired = `sia_${crypto.randomBytes(20).toString('hex')}`;
  await prisma.apiToken.create({ data: { name: 'r', tokenHash: hashApiToken(revoked), prefix: revoked.slice(0, 12), userId: user.id, revokedAt: new Date() } });
  await prisma.apiToken.create({ data: { name: 'e', tokenHash: hashApiToken(expired), prefix: expired.slice(0, 12), userId: user.id, expiresAt: new Date(Date.now() - 1000) } });
  try {
    assert.equal(await resolveApiToken(`Bearer ${revoked}`), null);
    assert.equal(await resolveApiToken(`Bearer ${expired}`), null);
    assert.equal(await resolveApiToken('Bearer notasia_token'), null);
    assert.equal(await resolveApiToken(undefined), null);
  } finally {
    await prisma.apiToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
