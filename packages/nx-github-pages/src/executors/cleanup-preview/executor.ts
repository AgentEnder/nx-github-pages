import { ExecutorContext, logger } from '@nx/devkit';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { exec } from '../../utils/exec';
import { findDefaultRemote } from '../../utils/find-default-remote';
import { parseOwnerRepoFromRemote } from '../../utils/github-context';
import { markPreviewCommentCleaned } from '../../utils/preview-comment';
import { CleanupPreviewExecutorSchema } from './schema';

function normalizeRemote(remote: string): string {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) return remote;
  if (remote.startsWith('git@')) {
    remote = remote.replace('git@', 'https://');
  }
  if (remote.startsWith('https://') && !/:.*@/.test(remote)) {
    return remote.replace('https://', `https://github-actions:${token}@`);
  }
  return remote;
}

async function getLastCommitTimestamp(
  cwd: string,
  path: string
): Promise<number> {
  const out = await exec(
    `git log -n 1 --pretty=format:%at -- "${path}"`,
    { cwd, stdio: 'ignore' }
  );
  const seconds = Number(out.trim());
  if (Number.isNaN(seconds)) return 0;
  return seconds * 1000;
}

export default async function cleanupPreviewExecutor(
  options: CleanupPreviewExecutorSchema,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  const rawRemote =
    options.remote ?? (await findDefaultRemote(context.root).catch(() => ''));
  if (!rawRemote) {
    logger.error(
      'No remote configured — pass `remote` or run inside a git repo with an origin.'
    );
    return { success: false };
  }
  const remote = normalizeRemote(rawRemote);
  const baseBranch = options.baseBranch;
  const pathPrefix = options.pathPrefix.replace(/^\/+|\/+$/g, '');

  const scratch = mkdtempSync(join(tmpdir(), 'nx-ghp-cleanup-'));
  try {
    logger.info(`Cloning ${rawRemote}@${baseBranch}`);
    await exec(
      `git clone --single-branch --branch ${baseBranch} "${remote}" .`,
      { cwd: scratch }
    );

    // Configure git user for the eventual cleanup commit.
    if (options.user) {
      await exec(`git config user.email ${options.user.email}`, {
        cwd: scratch,
      });
      await exec(`git config user.name "${options.user.name}"`, {
        cwd: scratch,
      });
    } else if (
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.GITHUB_ACTOR
    ) {
      await exec(
        `git config user.email ${process.env.GITHUB_ACTOR}@users.noreply.github.com`,
        { cwd: scratch }
      );
      await exec(`git config user.name "${process.env.GITHUB_ACTOR}"`, {
        cwd: scratch,
      });
    }

    const prRoot = join(scratch, pathPrefix);
    if (!existsSync(prRoot)) {
      logger.info(
        `No '${pathPrefix}' directory on ${baseBranch} — nothing to clean up.`
      );
      return { success: true };
    }

    const now = Date.now();
    const maxAgeMs = options.maxAgeDays * 24 * 60 * 60 * 1000;
    const parsedRepo = parseOwnerRepoFromRemote(rawRemote);

    const folders = readdirSync(prRoot);
    const removed: string[] = [];
    for (const folder of folders) {
      const relPath = `${pathPrefix}/${folder}`;
      const lastModified = await getLastCommitTimestamp(scratch, relPath);
      const ageMs = now - lastModified;
      const shouldRemove = options.all || ageMs > maxAgeMs;
      if (!shouldRemove) {
        continue;
      }
      logger.info(
        `Removing ${relPath} (age: ${Math.round(ageMs / (24 * 60 * 60 * 1000))} days)`
      );
      rmSync(join(scratch, relPath), { recursive: true, force: true });
      removed.push(folder);

      if (options.updatePrComments && parsedRepo) {
        const prNumber = Number(folder);
        if (!Number.isNaN(prNumber)) {
          try {
            await markPreviewCommentCleaned(
              parsedRepo.owner,
              parsedRepo.repo,
              prNumber
            );
          } catch (err) {
            logger.warn(
              `Failed to update PR comment for #${prNumber}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }
    }

    if (removed.length === 0) {
      logger.info('No preview deployments matched cleanup criteria.');
      return { success: true };
    }

    await exec(`git add -A`, { cwd: scratch });
    const staged = await exec(`git diff --name-only --cached`, {
      cwd: scratch,
      stdio: 'ignore',
    });
    if (staged.split('\n').filter((l) => l.trim()).length === 0) {
      logger.info('No file changes after removal — skipping commit.');
      return { success: true };
    }

    await exec(`git commit -m "${options.commitMessage}"`, { cwd: scratch });
    try {
      await exec(`git push ${options.remoteName} ${baseBranch}`, {
        cwd: scratch,
      });
    } catch (err) {
      logger.error(
        'Cleanup push failed — ensure GH_TOKEN/GITHUB_TOKEN has write access.'
      );
      throw err;
    }

    logger.info(
      `Cleaned up ${removed.length} preview deployment(s): ${removed.join(', ')}`
    );
    return { success: true };
  } catch (err) {
    logger.error(
      `cleanup-preview failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { success: false };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
