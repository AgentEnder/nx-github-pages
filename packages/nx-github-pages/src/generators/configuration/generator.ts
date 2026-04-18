import {
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

  // readProjectConfiguration works for both project.json-backed projects and
  // package.json-inferred ones (Nx 22+); updateProjectConfiguration writes
  // back to whichever file the project is defined in.
  const project = readProjectConfiguration(tree, options.project);

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

  updateProjectConfiguration(tree, options.project, {
    ...project,
    targets: {
      ...project.targets,
      [options.targetName]: targetDefinition,
      ...extraTargets,
    },
  });
}

export default configurationGenerator;
