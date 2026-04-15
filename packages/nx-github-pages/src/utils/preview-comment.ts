import { logger } from '@nx/devkit';

const PREVIEW_MARKER = '<!-- nx-github-pages:preview-deployment -->';

export interface PreviewCommentInput {
  owner: string;
  repo: string;
  prNumber: number;
  url: string;
  sha?: string;
}

function renderBody(input: PreviewCommentInput): string {
  const rows = [
    ['URL', `[${input.url}](${input.url})`],
    ['Commit', input.sha ? `\`${input.sha}\`` : '—'],
    ['Deployed at', new Date().toISOString()],
  ];
  const table = [
    '|   |   |',
    '| - | - |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ].join('\n');
  return [
    PREVIEW_MARKER,
    '# Preview Deployment',
    'Thanks for contributing to this PR 🎉',
    '',
    table,
  ].join('\n');
}

function renderCleanupBody(): string {
  return [
    PREVIEW_MARKER,
    '# Preview Deployment',
    '',
    'Preview deployment has been cleaned up. Push a new commit to re-deploy.',
  ].join('\n');
}

async function loadOctokit(): Promise<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { Octokit: new (opts: { auth?: string }) => any } | null
> {
  try {
    // Resolved at runtime — @octokit/rest is a peer/optional dep of the plugin.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@octokit/rest');
  } catch {
    logger.warn(
      'Failed to load @octokit/rest — install it as a dependency of your workspace to enable PR preview comments.'
    );
    return null;
  }
}

function getToken(): string | undefined {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
}

async function findPreviewComment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  owner: string,
  repo: string,
  prNumber: number
) {
  const { data } = await client.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  return data.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) =>
      c.body?.includes(PREVIEW_MARKER) ||
      c.body?.toLowerCase().includes('preview deployment')
  );
}

export async function upsertPreviewComment(
  input: PreviewCommentInput
): Promise<void> {
  const token = getToken();
  if (!token) {
    logger.warn(
      'No GH_TOKEN/GITHUB_TOKEN found — skipping preview deployment PR comment.'
    );
    return;
  }
  const mod = await loadOctokit();
  if (!mod) return;

  const client = new mod.Octokit({ auth: token });
  const body = renderBody(input);

  const existing = await findPreviewComment(
    client,
    input.owner,
    input.repo,
    input.prNumber
  );
  if (existing) {
    await client.rest.issues.updateComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: existing.id,
      body,
    });
    logger.info(`Updated preview deployment comment on PR #${input.prNumber}`);
  } else {
    await client.rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.prNumber,
      body,
    });
    logger.info(`Created preview deployment comment on PR #${input.prNumber}`);
  }
}

export async function markPreviewCommentCleaned(
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  const token = getToken();
  if (!token) return;
  const mod = await loadOctokit();
  if (!mod) return;
  const client = new mod.Octokit({ auth: token });
  const existing = await findPreviewComment(client, owner, repo, prNumber);
  if (!existing) return;
  await client.rest.issues.updateComment({
    owner,
    repo,
    comment_id: existing.id,
    body: renderCleanupBody(),
  });
}
