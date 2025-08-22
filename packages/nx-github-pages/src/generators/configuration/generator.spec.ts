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

  it('should run successfully', async () => {
    await configurationGenerator(tree, options);
    const config = readProjectConfiguration(tree, 'test');
    expect(config).toBeDefined();
  });
});
