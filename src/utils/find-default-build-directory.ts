import { ProjectGraph } from '@nx/devkit';

export function findDefaultBuildDirectory(context: {
  projectName?: string;
  projectGraph?: ProjectGraph;
  configurationName?: string;
}) {
  const targetProject = context.projectName;
  if (!targetProject) {
    throw new Error(
      'No target project found. Specify `directory` option manually.'
    );
  }
  const projectConfiguration =
    context.projectGraph?.nodes?.[targetProject]?.data;
  if (!projectConfiguration) {
    throw new Error(
      'Project configuration not found. Specify `directory` option manually.'
    );
  }

  const buildConfigurations = projectConfiguration.targets?.build;
  if (!buildConfigurations) {
    throw new Error(
      'No build configuration found. Specify `directory` option manually.'
    );
  }

  const possibleOutputPaths: string[] = [];
  if (context.configurationName) {
    const configuration =
      buildConfigurations.configurations?.[context.configurationName];
    if (configuration?.outputPath) {
      possibleOutputPaths.push(configuration.outputPath);
    }
  }

  if (buildConfigurations.defaultConfiguration) {
    const configuration =
      buildConfigurations.configurations?.[
        buildConfigurations.defaultConfiguration
      ];
    if (configuration?.outputPath) {
      possibleOutputPaths.push(configuration.outputPath);
    }
  }

  if (buildConfigurations.options?.outputPath) {
    possibleOutputPaths.push(buildConfigurations.options.outputPath);
  }

  const filtered = possibleOutputPaths.filter(Boolean);
  if (filtered.length > 0) {
    return filtered[0];
  }

  const outputs = buildConfigurations.outputs;
  if (outputs?.length === 1) {
    return outputs[0]
      .replace('{workspaceRoot}', '')
      .replace('{projectRoot}', projectConfiguration.root);
  } else if (outputs && outputs.length > 1) {
    throw new Error(
      'Multiple outputs found. Specify `directory` option manually.'
    );
  }

  throw new Error(
    'Unable to determine output directory. Specify `directory` option manually.'
  );
}
