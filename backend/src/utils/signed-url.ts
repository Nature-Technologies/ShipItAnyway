import crypto from 'node:crypto';

// Artifacts (Playwright traces + screenshots) can contain secrets/DOM/tokens, but they are consumed
// by <img> tags and by the cross-origin trace viewer (trace.playwright.dev), neither of which can
// send an Authorization header. So we gate them with short-lived signed URLs instead of JWT:
// the authed /runs/:id handler (which already checks runs_read) mints the signed URLs, and the
// static routes verify the signature before serving.

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h — long enough to view a run, short enough to limit leaks

function signingKey(): string {
  // JWT_SECRET is guaranteed present + strong by the startup guard in index.ts.
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error('JWT_SECRET is required to sign artifact URLs');
  return key;
}

function computeSig(pathname: string, exp: number): string {
  return crypto.createHmac('sha256', signingKey()).update(`${pathname}\n${exp}`).digest('hex');
}

// Returns the pathname with `?exp=&sig=` appended. `pathname` must be the exact path the static
// route will serve (e.g. "/api/traces/<id>.zip", "/screenshots/<name>.png"), without a query.
export function signArtifactPath(pathname: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const sig = computeSig(pathname, exp);
  return `${pathname}?exp=${exp}&sig=${sig}`;
}

// Returns just the `?exp=&sig=` query for a given served pathname. Callers append it to the value
// the frontend concatenates into an artifact URL (e.g. a screenshot filename or tracePath), so no
// frontend change is needed: `/screenshots/${name}` becomes `/screenshots/${name}?exp=&sig=`.
export function signedQuery(pathname: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  return `?exp=${exp}&sig=${computeSig(pathname, exp)}`;
}

export function verifyArtifactSig(pathname: string, exp: string | undefined, sig: string | undefined): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = computeSig(pathname, expNum);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
