import {
  addProjectConfiguration,
  createProjectGraphAsync,
  ProjectGraph,
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

async function getProjectConfiguration(
  project: string,
  tree: Tree,
  graph: ProjectGraph
) {
  try {
    return { onDisk: true, project: readProjectConfiguration(tree, project) };
  } catch {
    // continue
  }

  const projectNode = graph.nodes[project];
  if (!projectNode) {
    throw new Error(`Project configuration not found for ${project}`);
  }
  return { onDisk: false, project: projectNode.data };
}

export async function configurationGenerator(
  tree: Tree,
  options: ConfigurationGeneratorSchema
) {
  const graph = await createProjectGraphAsync();

  const { onDisk, project } = await getProjectConfiguration(
    options.project,
    tree,
    graph
  );

  const targetDefinition: TargetConfiguration<Partial<DeployExecutorSchema>> = {
    executor: `nx-github-pages:deploy`,
    options: {
      ...(options.user ? { user: options.user } : {}),
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

  if (!onDisk) {
    addProjectConfiguration(tree, options.project, {
      root: project.root,
      targets: {
        [options.targetName]: targetDefinition,
      },
    });
  } else {
    updateProjectConfiguration(tree, options.project, {
      ...project,
      targets: {
        ...project.targets,
        [options.targetName]: targetDefinition,
      },
    });
  }
}

export default configurationGenerator;
