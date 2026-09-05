import type { Locator, Page } from 'playwright';

const ALLOWED_LOCATOR_METHODS = new Set([
  'getByRole',
  'getByLabel',
  'getByText',
  'getByPlaceholder',
  'getByTestId',
  'getByTitle',
  'locator',
  'getByAltText'
]);

// Kept for callers that only need the yes/no gate (e.g. candidate filtering).
const ALLOWED_LOCATOR_PREFIXES = [...ALLOWED_LOCATOR_METHODS].map((m) => `page.${m}(`);

const MALFORMED_PAGE_LOCATOR_PREFIX = /^page\d+\./;

export function isSafeLocator(selector: string): boolean {
  const normalized = selector.trim();
  return ALLOWED_LOCATOR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

type LocatorArg = string | number | boolean | { [key: string]: string | number | boolean };

// Strict recursive-descent parser for the tiny expression grammar our locators use:
//   page.<method>( <arg> (, <arg>)* )   where <arg> = string | number | boolean | { ident|string : primitive , ... }
// It never evaluates code. Anything outside the grammar (function calls, identifiers as values,
// member access, etc.) throws — this replaces a former eval() that allowed arbitrary RCE.
function parseLocatorCall(input: string): { method: string; args: LocatorArg[] } {
  const head = input.match(/^page\.([A-Za-z]+)\(/);
  if (!head) throw new Error(`Unsafe locator rejected: "${input.slice(0, 50)}"`);
  const method = head[1];
  if (!ALLOWED_LOCATOR_METHODS.has(method)) {
    throw new Error(`Unsafe locator rejected: "${input.slice(0, 50)}"`);
  }

  let i = head[0].length;
  const fail = (): never => {
    throw new Error(`Unsafe locator rejected: "${input.slice(0, 50)}"`);
  };
  const skipWs = () => {
    while (i < input.length && /\s/.test(input[i])) i++;
  };

  function parseString(): string {
    const quote = input[i++];
    let out = '';
    while (i < input.length) {
      const ch = input[i++];
      if (ch === '\\') {
        const next = input[i++];
        // Preserve the few escapes our generator emits; pass others through literally.
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        continue;
      }
      if (ch === quote) return out;
      out += ch;
    }
    return fail();
  }

  function parseNumber(): number {
    const start = i;
    if (input[i] === '-') i++;
    while (i < input.length && /[0-9.]/.test(input[i])) i++;
    const raw = input.slice(start, i);
    const n = Number(raw);
    if (raw === '' || Number.isNaN(n)) return fail();
    return n;
  }

  function parseKey(): string {
    if (input[i] === "'" || input[i] === '"' || input[i] === '`') return parseString();
    const m = input.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!m) return fail();
    i += m[0].length;
    return m[0];
  }

  function parsePrimitive(): string | number | boolean {
    skipWs();
    const ch = input[i];
    if (ch === "'" || ch === '"' || ch === '`') return parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    if (input.startsWith('true', i)) { i += 4; return true; }
    if (input.startsWith('false', i)) { i += 5; return false; }
    return fail();
  }

  function parseObject(): { [key: string]: string | number | boolean } {
    i++; // consume '{'
    const obj: { [key: string]: string | number | boolean } = {};
    skipWs();
    if (input[i] === '}') { i++; return obj; }
    for (;;) {
      skipWs();
      const key = parseKey();
      skipWs();
      if (input[i++] !== ':') fail();
      obj[key] = parsePrimitive();
      skipWs();
      const sep = input[i++];
      if (sep === '}') return obj;
      if (sep !== ',') fail();
    }
  }

  function parseArg(): LocatorArg {
    skipWs();
    if (input[i] === '{') return parseObject();
    return parsePrimitive();
  }

  const args: LocatorArg[] = [];
  skipWs();
  if (input[i] === ')') {
    i++;
  } else {
    for (;;) {
      args.push(parseArg());
      skipWs();
      const sep = input[i++];
      if (sep === ')') break;
      if (sep !== ',') fail();
    }
  }
  skipWs();
  if (i !== input.length) fail(); // trailing junk (e.g. chained calls) → reject
  return { method, args };
}

export function resolveLocator(page: Page, selector: string): Locator {
  const normalized = selector.trim();
  if (MALFORMED_PAGE_LOCATOR_PREFIX.test(normalized)) {
    throw new Error(
      `Malformed locator rejected: "${normalized.slice(0, 80)}". Use "page." for Playwright locators, not "page1." or other variants.`
    );
  }

  if (normalized.startsWith('page.')) {
    const { method, args } = parseLocatorCall(normalized);
    const fn = (page as unknown as Record<string, (...a: unknown[]) => Locator>)[method];
    if (typeof fn !== 'function') {
      throw new Error(`Unsafe locator rejected: "${normalized.slice(0, 50)}"`);
    }
    return fn.apply(page, args as unknown[]);
  }

  return page.locator(normalized);
}
