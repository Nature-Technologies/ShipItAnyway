// User-supplied assertion patterns (assertURL/assertTitle non-exact) are compiled to RegExp and
// matched against page URL/title. A catastrophic-backtracking pattern (e.g. "(a+)+$") blocks the
// worker's event loop synchronously — Playwright's own timeout can't fire — DoSing all tenants on
// the shared worker pool. This guard rejects oversized patterns and the classic nested-quantifier /
// quantified-overlapping-alternation ReDoS signatures before compiling.
//
// ponytail: heuristic (catches the common catastrophic forms, not every possible one). Upgrade path
// if this proves insufficient: compile user patterns with re2 (linear-time) instead of RegExp.

const MAX_PATTERN_LENGTH = 500;

// A single-level group that contains a quantifier, immediately followed by an outer quantifier:
// (a+)+  (a*)*  (\d+){2,}  (.*)+  etc.
const NESTED_QUANTIFIER = /\([^()]*[*+?}][^()]*\)[*+{]/;
// A quantified alternation, the (a|a)* overlap family: (a|ab)*  (x|x)+
const QUANTIFIED_ALTERNATION = /\([^()]*\|[^()]*\)[*+]/;

export function assertSafeUserRegex(source: string): void {
  if (source.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern too long (max ${MAX_PATTERN_LENGTH} chars)`);
  }
  if (NESTED_QUANTIFIER.test(source) || QUANTIFIED_ALTERNATION.test(source)) {
    throw new Error('Pattern rejected: potentially catastrophic backtracking (nested quantifier)');
  }
}

export function compileUserRegExp(source: string, flags?: string): RegExp {
  assertSafeUserRegex(source);
  return new RegExp(source, flags);
}
