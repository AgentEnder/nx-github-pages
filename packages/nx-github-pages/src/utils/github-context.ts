import { Context } from '@actions/github/lib/context';

export interface GitHubContext {
  owner: string;
  repo: string;
  prNumber?: number;
  sha?: string;
}

export function getPullRequestNumber(): number | undefined {
  const ctx = new Context();
  const payloadPr = ctx.payload.pull_request?.number;
  if (typeof payloadPr === 'number' && !Number.isNaN(payloadPr)) {
    return payloadPr;
  }
  const refMatch = ctx.ref?.match(/^refs\/pull\/(\d+)\//);
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
  const ctx = new Context();
  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = ctx.repo);
  } catch {
    // context.repo throws when GITHUB_REPOSITORY is unset and no repo info is
    // present on the payload. Treat that as "no context" instead of surfacing
    // the error.
    return null;
  }
  return {
    owner,
    repo,
    prNumber: getPullRequestNumber(),
    sha: ctx.sha || undefined,
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
