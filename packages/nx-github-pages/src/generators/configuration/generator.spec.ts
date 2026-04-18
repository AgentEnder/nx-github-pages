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

  it('adds the deploy target to a package.json-inferred project (Nx 22+)', async () => {
    // Simulate an app whose project config lives in package.json (no project.json).
    tree.write(
      'apps/app/package.json',
      JSON.stringify({ name: '@org/app', nx: {} }, null, 2)
    );

    await configurationGenerator(tree, {
      project: '@org/app',
      targetName: 'deploy',
    });

    // The target must be present on the read-back configuration — regardless of
    // whether it landed in project.json or package.json's nx block, `nx deploy
    // @org/app` needs to resolve it.
    const config = readProjectConfiguration(tree, '@org/app');
    expect(config.targets?.deploy).toEqual(
      expect.objectContaining({ executor: 'nx-github-pages:deploy' })
    );

    // And it should not have stomped the project.json/package.json of a
    // project with a similar directory-derived name.
    expect(tree.exists('apps/app/project.json')).toBe(false);
    const pkg = JSON.parse(tree.read('apps/app/package.json', 'utf-8') ?? '{}');
    expect(pkg.nx?.targets?.deploy?.executor).toBe('nx-github-pages:deploy');
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
