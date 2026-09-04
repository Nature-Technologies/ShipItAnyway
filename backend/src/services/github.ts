export type CommitStatusState = 'pending' | 'success' | 'failure';

export function suiteContext(suiteName: string): string {
  const slug = suiteName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `shipitanyway/${slug || 'suite'}`;
}

export async function postCommitStatus(args: {
  repo: string; sha: string; pat: string;
  state: CommitStatusState; context: string; targetUrl?: string; description?: string;
}): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${args.repo}/statuses/${args.sha}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      state: args.state,
      context: args.context,
      target_url: args.targetUrl,
      description: args.description?.slice(0, 140)
    })
  });
  if (!res.ok) {
    throw new Error(`GitHub status POST failed ${res.status}: ${await res.text()}`);
  }
}
