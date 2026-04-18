import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import {
  Tree,
  addProjectConfiguration,
  readProjectConfiguration,
} from '@nx/devkit';

import { configurationGenerator } from './generator';
import { ConfigurationGeneratorSchema } from './schema';

jest.mock('@nx/devkit', () => ({
  ...jest.requireActual('@nx/devkit'),
  createProjectGraphAsync: jest.fn().mockImplementation(() => {
    return {
      nodes: {
        test: {
          data: {
            root: 'apps/test',
          },
        },
        '@org/app': {
          data: {
            root: 'apps/app',
          },
        },
      },
    };
  }),
}));

describe('configuration generator', () => {
  let tree: Tree;
  const options: ConfigurationGeneratorSchema = {
    project: 'test',
    targetName: 'deploy',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'test', {
      root: 'apps/test',
    });
  });

  it('adds the deploy target to a project.json-backed project', async () => {
    await configurationGenerator(tree, options);
    const config = readProjectConfiguration(tree, 'test');
    expect(config.targets?.deploy).toEqual(
      expect.objectContaining({ executor: 'nx-github-pages:deploy' })
    );
  });

  it('writes a project.json for package.json-inferred projects so Nx picks up the new target', async () => {
    // Simulate an app whose project config lives in package.json (no project.json).
    tree.write(
      'apps/app/package.json',
      JSON.stringify({ name: '@org/app', nx: {} }, null, 2)
    );

    await configurationGenerator(tree, {
      project: '@org/app',
      targetName: 'deploy',
    });

    const config = readProjectConfiguration(tree, '@org/app');
    expect(config.targets?.deploy).toEqual(
      expect.objectContaining({ executor: 'nx-github-pages:deploy' })
    );

    // A project.json is written on disk — the Nx daemon invalidates its graph
    // cache on project.json changes, but not on package.json nx-block edits.
    expect(tree.exists('apps/app/project.json')).toBe(true);
    const projectJson = JSON.parse(
      tree.read('apps/app/project.json', 'utf-8') ?? '{}'
    );
    expect(projectJson.name).toBe('@org/app');
    expect(projectJson.targets?.deploy?.executor).toBe('nx-github-pages:deploy');
  });

  it('adds a cleanup-previews target when addCleanupTarget is passed', async () => {
    await configurationGenerator(tree, {
      ...options,
      addCleanupTarget: true,
    });
    const config = readProjectConfiguration(tree, 'test');
    expect(config.targets?.['cleanup-previews']).toEqual(
      expect.objectContaining({ executor: 'nx-github-pages:cleanup-preview' })
    );
  });
});
