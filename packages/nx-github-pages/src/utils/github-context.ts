export interface GitHubContext {
  owner: string;
  repo: string;
  prNumber?: number;
  sha?: string;
}

export function getPullRequestNumber(): number | undefined {
  const refMatch = (process.env.GITHUB_REF ?? '').match(/^refs\/pull\/(\d+)\//);
  if (refMatch) {
    return Number(refMatch[1]);
  }
  if (process.env.PR_NUMBER) {
    const parsed = Number(process.env.PR_NUMBER);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function getGitHubContext(): GitHubContext | null {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes('/')) {
    return null;
  }
  const [owner, repo] = repository.split('/');

  return {
    owner,
    repo,
    prNumber: getPullRequestNumber(),
    sha: process.env.GITHUB_SHA,
  };
}

export function isPullRequestContext(): boolean {
  return getPullRequestNumber() !== undefined;
}

export function parseOwnerRepoFromRemote(
  remote: string
): { owner: string; repo: string } | null {
  const match = remote.match(
    /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:\/)?$/i
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
