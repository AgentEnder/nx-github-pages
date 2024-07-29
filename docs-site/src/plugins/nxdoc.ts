import { LoadContext } from '@docusaurus/types';
import { workspaceRoot } from '@nx/devkit';
import { execSync } from 'node:child_process';

export async function NxDocPlugin(context: LoadContext) {
  execSync('npx nx g generate-docs --outputDirectory docs-site/docs', {
    cwd: workspaceRoot,
  });

  return {
    // a unique name for this plugin
    name: 'nxdoc',
  };
}
