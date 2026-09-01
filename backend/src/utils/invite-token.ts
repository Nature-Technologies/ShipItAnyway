import { createHash, randomBytes } from 'node:crypto';

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url'); // ≥256-bit CSPRNG
  return { raw, hash: hashInviteToken(raw) };
}
