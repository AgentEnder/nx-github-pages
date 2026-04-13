export interface GitHubContext {
  owner: string;
  repo: string;
  prNumber?: number;
  sha?: string;
}

export function getGitHubContext(): GitHubContext | null {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes('/')) {
    return null;
  }
  const [owner, repo] = repository.split('/');

  let prNumber: number | undefined;
  const refName = process.env.GITHUB_REF ?? '';
  const prMatch = refName.match(/^refs\/pull\/(\d+)\//);
  if (prMatch) {
    prNumber = Number(prMatch[1]);
  } else if (process.env.PR_NUMBER) {
    const parsed = Number(process.env.PR_NUMBER);
    if (!Number.isNaN(parsed)) {
      prNumber = parsed;
    }
  }

  return {
    owner,
    repo,
    prNumber,
    sha: process.env.GITHUB_SHA,
  };
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
