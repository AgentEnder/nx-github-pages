import { logger } from '@nx/devkit';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { exec } from '../../utils/exec';
import {
  getGitHubContext,
  getPullRequestNumber,
  parseOwnerRepoFromRemote,
} from '../../utils/github-context';
import { upsertPreviewComment } from '../../utils/preview-comment';
import { assertNoRootLinksOutsideBase } from '../../utils/verify-no-root-links';
import { DeployExecutorSchema, PreviewOptions } from './schema';

export interface NormalizedDeployOptions
  extends Omit<DeployExecutorSchema, 'preview'> {
  remote: string;
  directory: string;
}

function resolvePathPrefix(explicit: string | undefined): string {
  if (explicit) {
    return explicit.replace(/^\/+|\/+$/g, '');
  }
  const prNumber = getPullRequestNumber();
  const id = prNumber !== undefined ? String(prNumber) : process.env.GITHUB_SHA;
  if (!id) {
    throw new Error(
      'Unable to determine preview path prefix: set GITHUB_REF (refs/pull/<N>/merge), PR_NUMBER, or GITHUB_SHA, or provide preview.pathPrefix explicitly.'
    );
  }
  return `pr/${id}`;
}

function resolvePreviewUrl(
  preview: PreviewOptions,
  pathPrefix: string,
  options: NormalizedDeployOptions,
  remote: string
): string | null {
  const trimmed = (preview.url ?? '').replace(/\/+$/, '');
  if (trimmed) {
    return `${trimmed}/${pathPrefix}`;
  }
  if (options.CNAME) {
    return `https://${options.CNAME}/${pathPrefix}`;
  }
  const parsed = parseOwnerRepoFromRemote(remote);
  if (parsed) {
    // Default GitHub Pages URL: https://<owner>.github.io/<repo>/<pathPrefix>
    return `https://${parsed.owner}.github.io/${parsed.repo}/${pathPrefix}`;
  }
  return null;
}

function basePathFromPreviewUrl(
  url: string | null,
  pathPrefix: string
): string {
  // When we have a concrete preview URL (custom domain, default gh-pages
  // URL, explicit preview.url), the base path is its pathname — e.g.
  // `/<repo>/<pathPrefix>`. Without one we can still enforce at least
  // `/<pathPrefix>`.
  if (url) {
    try {
      return new URL(url).pathname.replace(/\/+$/, '') || `/${pathPrefix}`;
    } catch {
      /* fall through */
    }
  }
  return `/${pathPrefix}`;
}

async function configureGitUser(
  cwd: string,
  options: NormalizedDeployOptions
): Promise<void> {
  if (options.user) {
    await exec(`git config user.email ${options.user.email}`, { cwd });
    await exec(`git config user.name "${options.user.name}"`, { cwd });
    return;
  }
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_ACTOR &&
    !(await exec('git config user.email', { cwd, stdio: 'ignore' }).catch(
      () => ''
    ))
  ) {
    await exec(
      `git config user.email ${process.env.GITHUB_ACTOR}@users.noreply.github.com`,
      { cwd }
    );
    await exec(`git config user.name "${process.env.GITHUB_ACTOR}"`, { cwd });
  }
}

export async function deployPreview(
  preview: PreviewOptions,
  options: NormalizedDeployOptions,
  sourceDirectory: string
): Promise<{ success: boolean }> {
  const pathPrefix = resolvePathPrefix(preview.pathPrefix);
  const remote = options.remote;
  const baseBranch = options.baseBranch || 'gh-pages';

  logger.info(
    `Preview deploy: pushing to ${remote}@${baseBranch} under '${pathPrefix}'`
  );

  // Fail fast if any rooted link in the build output points outside the
  // preview's base path — those will 404 once served from a subdirectory.
  // The expected base path is derived from the full preview URL when one
  // is available (so e.g. `/<repo>/<pathPrefix>` under the default github.io
  // URL is enforced too), otherwise just `/<pathPrefix>`.
  const previewUrl = resolvePreviewUrl(preview, pathPrefix, options, remote);
  assertNoRootLinksOutsideBase(
    sourceDirectory,
    basePathFromPreviewUrl(previewUrl, pathPrefix)
  );

  const scratch = mkdtempSync(join(tmpdir(), 'nx-ghp-preview-'));
  try {
    // Try to clone the existing base branch. If it doesn't exist yet,
    // initialize an empty one so the first preview still works.
    let hasExistingBranch = true;
    try {
      await exec(
        `git clone --depth 1 --single-branch --branch ${baseBranch} "${remote}" .`,
        { cwd: scratch }
      );
    } catch {
      hasExistingBranch = false;
      logger.info(
        `Base branch '${baseBranch}' not found on remote — initializing a new one.`
      );
      await exec(`git init`, { cwd: scratch });
      await exec(`git checkout -b ${baseBranch}`, { cwd: scratch });
      await exec(`git remote add ${options.remoteName} "${remote}"`, {
        cwd: scratch,
      });
    }

    await configureGitUser(scratch, options);

    // Wipe the target subdirectory so file deletions in the build are
    // reflected in the deployment.
    const targetDir = join(scratch, pathPrefix);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });
    cpSync(sourceDirectory, targetDir, { recursive: true });

    if (options.CNAME) {
      writeFileSync(join(scratch, 'CNAME'), options.CNAME);
    }

    await exec(`git add -A`, { cwd: scratch });
    const staged = await exec(`git diff --name-only --cached`, {
      cwd: scratch,
      stdio: 'ignore',
    });
    if (staged.split('\n').filter((l) => l.trim()).length === 0) {
      logger.info('No changes to deploy — skipping commit & push.');
    } else {
      await exec(`git commit -m "${options.commitMessage} (${pathPrefix})"`, {
        cwd: scratch,
      });
      const pushTarget = hasExistingBranch
        ? `${options.remoteName} ${baseBranch}`
        : `--set-upstream ${options.remoteName} ${baseBranch}`;
      try {
        await exec(`git push ${pushTarget}`, { cwd: scratch });
      } catch (err) {
        logger.error(
          'Preview push failed. Ensure GH_TOKEN/GITHUB_TOKEN has write access to the target repository.'
        );
        throw err;
      }
    }

    // Post/update the PR comment.
    if (preview.comment !== false) {
      const ghContext = getGitHubContext();
      const fallback = parseOwnerRepoFromRemote(remote);
      const owner = ghContext?.owner ?? fallback?.owner;
      const repo = ghContext?.repo ?? fallback?.repo;
      const prNumber = ghContext?.prNumber;
      const url = previewUrl;

      if (!owner || !repo) {
        logger.warn(
          'Skipping PR comment: could not determine owner/repo. Set GITHUB_REPOSITORY or use a github.com remote URL.'
        );
      } else if (!prNumber) {
        logger.warn(
          'Skipping PR comment: no pull request number detected. Set PR_NUMBER or run inside a pull_request workflow.'
        );
      } else if (!url) {
        logger.warn(
          'Skipping PR comment: could not determine preview URL. Set preview.url or CNAME.'
        );
      } else {
        await upsertPreviewComment({
          owner,
          repo,
          prNumber,
          url,
          sha: ghContext?.sha,
        });
      }
    }

    return { success: true };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
