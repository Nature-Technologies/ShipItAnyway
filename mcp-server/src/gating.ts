export function groupsForScopes(scopes: string[]): { authoring: boolean; reporting: boolean; execution: boolean } {
  const has = (s: string) => scopes.includes(s);
  return {
    authoring: has('checks:edit'),
    reporting: has('runs:read') || has('checks:read'),
    execution: has('runs:trigger')
  };
}
