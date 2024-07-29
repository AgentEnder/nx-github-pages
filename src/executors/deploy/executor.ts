import { ExecutorContext, logger } from '@nx/devkit';

import { stat, writeFileSync } from 'fs';
import { join } from 'path';

import { DeployExecutorSchema } from './schema';

import { findDefaultBuildDirectory } from '../../utils/find-default-build-directory';
import { exec } from '../../utils/exec';
import { findDefaultRemote } from '../../utils/find-default-remote';

async function normalizeOptions(
  options: DeployExecutorSchema,
  context: ExecutorContext
): Promise<
  DeployExecutorSchema & {
    remote: string;
    directory: string;
  }
> {
  const remote = options.remote ?? (await findDefaultRemote(context.root));
  if (!remote) {
    throw new Error(
      'No remote found. Please specify a remote url in the executor options.'
    );
  }

  return {
    ...options,
    remote: normalizeRemote(remote),
    directory: options.directory ?? findDefaultBuildDirectory(context),
  };
}

async function exists(path: string) {
  return new Promise((resolve) => {
    stat(path, (err) => resolve(err === null));
  });
}

function normalizeRemote(remote: string): string {
  const envToken = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (envToken) {
    if (remote.startsWith('git@')) {
      logger.warn(
        'Using SSH remotes to deploy to github pages is not currently supported. Transforming to HTTPS'
      );
      remote = remote.replace('git@', `https://`);
      logger.info('Transformed remote to HTTPS: ' + remote);
    }
    if (remote.startsWith('https://')) {
      if (!/:.*@/.test(remote)) {
        return remote.replace(
          'https://',
          `https://github-actions:${envToken}@`
        );
      }
    }
  }
  return remote;
}

export default async function deployExecutor(
  raw: DeployExecutorSchema,
  context: ExecutorContext
) {
  const options = await normalizeOptions(raw, context);

  const directory = join(context.root, options.directory);

  if (!(await exists(directory))) {
    logger.error(`Output directory does not exist! ${directory}`);
    return {
      success: false,
    };
  }

  if (options.CNAME) {
    logger.info(`Creating CNAME file for ${options.CNAME} in ${directory}`);
    writeFileSync(join(directory, 'CNAME'), options.CNAME);
  }

  if (!(await exists(join(directory, '.git')))) {
    logger.info(
      `Git repository not found, initializing a blank repository ${directory}`
    );
    await exec('git init', { cwd: directory });
  }

  logger.info('Setting up git remote');

  try {
    await exec(`git remote add ${options.remoteName} "${options.remote}"`, {
      cwd: directory,
    });
  } catch {
    await exec(`git remote set-url ${options.remoteName} ${options.remote}`, {
      cwd: directory,
    });
  }

  logger.info('Setting up git remote -- COMPLETE');
  logger.info('Authoring Commit');

  await exec(`git add .`, { cwd: directory });
  const stagedFiles = await exec(`git diff --name-only --cached`, {
    cwd: directory,
    stdio: 'ignore',
  });
  if (stagedFiles.split('\n').filter((l) => !!l.trim()).length === 0) {
    logger.info('Authoring Commit -- SKIPPED (no changes)');
  } else {
    await exec(` git commit -m "${options.commitMessage}"`, {
      cwd: directory,
    });

    logger.info('Authoring Commit -- COMPLETE');
  }
  try {
    await exec(`git checkout -b gh-pages`, { cwd: directory });
  } catch {
    logger.warn('Resetting gh-pages branch, as it already exists.');
    await exec(`git checkout -B gh-pages`, { cwd: directory });
  }
  if (options.syncWithBaseBranch) {
    const baseBranch = options.baseBranch;
    await exec(`git fetch ${options.remoteName} ${baseBranch}`, {
      cwd: directory,
    });
    const syncStrategy = options.syncStrategy;
    const command = `git ${syncStrategy} ${
      options.remoteName
    }/${baseBranch} ${options.syncGitOptions.join(' ')}`;
    logger.info('Syncing with base branch: ' + command);
    await exec(command, {
      cwd: directory,
    });
  }
  logger.info('Pushing to GH Pages');
  try {
    await exec(`git push -f --set-upstream ${options.remoteName} gh-pages`, {
      cwd: directory,
    });
    logger.info('Pushing to GH Pages -- COMPLETE');
  } catch (error: unknown) {
    logger.info(
      '[hint]: You may need to set GH_TOKEN or GITHUB_TOKEN to have write access to the repository'
    );
    logger.error('Pushing to GH Pages -- FAILED');
    return {
      success: false,
    };
  }

  return {
    success: true,
  };
}
