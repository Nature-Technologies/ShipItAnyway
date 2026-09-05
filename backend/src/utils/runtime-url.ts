function isLocalhostHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

// Only these schemes may be navigated to. Blocks file:/chrome:/view-source: etc., which the
// server-side browser would otherwise use to read local files (SSRF/local-file-read). `data:` is
// inline content (no fetch) and is used by test fixtures, so it stays allowed. Note: this does NOT
// stop SSRF to internal IPs/metadata over http(s) — the worker must additionally run with locked-down
// network egress in production.
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'data:']);

export function resolveBrowserUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl; // relative/templated URL — leave for the caller/browser to handle
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http, https and data URLs are allowed`);
  }

  const internalUrl = process.env.FRONTEND_INTERNAL_URL;
  if (internalUrl && parsed.protocol !== 'data:' && isLocalhostHost(parsed.hostname)) {
    const internal = new URL(internalUrl);
    internal.pathname = parsed.pathname;
    internal.search = parsed.search;
    internal.hash = parsed.hash;
    return internal.toString();
  }

  return rawUrl;
}
