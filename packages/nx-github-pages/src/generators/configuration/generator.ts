import {
  addProjectConfiguration,
  createProjectGraphAsync,
  readProjectConfiguration,
  TargetConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';

import { prompt } from 'enquirer';

import { DeployExecutorSchema } from '../../executors/deploy/schema';
import { findDefaultBuildDirectory } from '../../utils/find-default-build-directory';
import { findDefaultRemote } from '../../utils/find-default-remote';

import { ConfigurationGeneratorSchema } from './schema';

export async function configurationGenerator(
  tree: Tree,
  options: ConfigurationGeneratorSchema
) {
  const graph = await createProjectGraphAsync();
  const project = readProjectConfiguration(tree, options.project);
  const hasProjectJson = tree.exists(`${project.root}/project.json`);

  const targetDefinition: TargetConfiguration<Partial<DeployExecutorSchema>> = {
    executor: `nx-github-pages:deploy`,
    options: {
      ...(options.user ? { user: options.user } : {}),
      ...(options.preview
        ? {
            preview: {
              ...(options.previewUrl ? { url: options.previewUrl } : {}),
            },
            syncWithBaseBranch: true,
          }
        : {}),
    },
  };

  try {
    findDefaultBuildDirectory({
      projectName: options.project,
      projectGraph: graph,
    });
    targetDefinition.dependsOn = ['build'];
  } catch {
    if (process.stdout.isTTY && process.env.NODE_ENV !== 'test') {
      targetDefinition.options.directory = await prompt<{ directory: string }>({
        type: 'input',
        message:
          'Where are the build artifacts that should be deployed output?',
        name: 'directory',
      }).then((answer) => answer.directory);
    }
  }

  let defaultRemote: string | undefined;
  try {
    defaultRemote = await findDefaultRemote(tree.root);
  } catch {
    // its fine
  }
  if (
    !defaultRemote &&
    process.stdout.isTTY &&
    process.env.NODE_ENV !== 'test'
  ) {
    targetDefinition.options.remote = await prompt<{ remote: string }>({
      type: 'input',
      message: 'What is the remote URL to deploy to?',
      name: 'remote',
    }).then((answer) => answer.remote);
  }

  const extraTargets: Record<string, TargetConfiguration> = {};
  if (options.addCleanupTarget) {
    extraTargets['cleanup-previews'] = {
      executor: 'nx-github-pages:cleanup-preview',
      options: {},
    };
  }

  const newTargets = {
    ...project.targets,
    [options.targetName]: targetDefinition,
    ...extraTargets,
  };

  if (hasProjectJson) {
    updateProjectConfiguration(tree, options.project, {
      ...project,
      targets: newTargets,
    });
  } else {
    // For package.json-inferred projects (Nx 22+), write a project.json
    // rather than mutating the package.json `nx` block. The Nx daemon picks
    // up project.json files via its file watcher; mid-session edits to the
    // package.json nx block are not as reliably reflected.
    addProjectConfiguration(tree, options.project, {
      name: options.project,
      root: project.root,
      targets: newTargets,
    });
  }

  // Return a post-flush callback so the daemon only gets nudged after our
  // changes actually hit disk. Without this, the next `nx deploy` in the
  // same session can still resolve the task graph (via dependsOn) but fail
  // with "Cannot find target 'deploy'" when the per-task child process
  // reads the cached project graph.
  return async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { daemonClient } = require('nx/src/daemon/client/client');
      await daemonClient.stop();
    } catch {
      // Daemon may not be running or the internal path may have moved —
      // either way we'd rather let the generator succeed.
    }
  };
}

export default configurationGenerator;
