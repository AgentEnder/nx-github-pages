import { ExecSyncOptions, execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ProjectConfiguration, workspaceRoot } from '@nx/devkit';

describe('nx-github-pages', () => {
  let projectDirectory: string;
  let remote: string;
  let remoteDirectory: string;

  // The state of the remote matters for some tests so we
  // are going to reinit everything everytime. This is not the most
  // time efficient way to do this but it is the most reliable.
  beforeEach(() => {
    ({ remote, remoteDirectory } = createTestRemote());
    projectDirectory = createTestProject(remote);

    // The plugin has been built and published to a local registry in the jest globalSetup
    // Install the plugin built with the latest source code into the test repo
    installDependencies(
      projectDirectory,
      {},
      {
        'nx-github-pages': 'e2e',
        '@nx/react': 'latest',
      }
    );
  });

  it('should deploy to gh-pages branch of remote', () => {
    const appName = 'my-app';
    const nxProjectName = getNxProjectName(projectDirectory, appName);
    generateReactApp(projectDirectory, appName);

    runCommand(
      `npx nx g nx-github-pages:configuration --project ${nxProjectName} --user.name deployment-bot --user.email deployment@testing.com --no-interactive`,
      projectDirectory,
      {}
    );

    runCommand(
      `npx nx deploy ${nxProjectName} --no-interactive`,
      projectDirectory,
      {}
    );

    // Check that the gh-pages branch exists in the remote
    runCommand('git checkout gh-pages', remoteDirectory, {});

    // Check that the build artifacts are in the gh-pages branch...
    // We can't really do a "full e2e" here without pushing a real site
    // to GitHub Pages, but this is a good start.
    checkFilesExist(remoteDirectory, ['index.html']);
  });

  it('should sync via merge sync enabled and deployment already exists', () => {
    const appName = 'my-app';
    const nxProjectName = getNxProjectName(projectDirectory, appName);

    // SETUP
    // Create a new app
    generateReactApp(projectDirectory, appName);
    // Create the configuration
    runCommand(
      `npx nx g nx-github-pages:configuration --user.name deployment-bot --user.email deployment@testing.com --project ${nxProjectName} --no-interactive`,
      projectDirectory,
      {}
    );
    // Initial deployment
    runCommand(
      `npx nx deploy ${nxProjectName} --no-interactive`,
      projectDirectory,
      {}
    );
    // enable sync settings — Nx 22+ stores project config in package.json under "nx"
    const projectConfigPath = existsSync(
      join(projectDirectory, `apps/${appName}/project.json`)
    )
      ? `apps/${appName}/project.json`
      : `apps/${appName}/package.json`;
    const isPackageJson = projectConfigPath.endsWith('package.json');

    if (isPackageJson) {
      updateJsonFile<{ nx: ProjectConfiguration }>(
        projectDirectory,
        projectConfigPath,
        (json) => {
          json.nx.targets.deploy.options.syncWithBaseBranch = true;
          json.nx.targets.deploy.options.syncGitOptions = [
            '--allow-unrelated-histories',
            '-s ours',
          ];
          return json;
        }
      );
    } else {
      updateJsonFile<ProjectConfiguration>(
        projectDirectory,
        projectConfigPath,
        (json) => {
          json.targets.deploy.options.syncWithBaseBranch = true;
          json.targets.deploy.options.syncGitOptions = [
            '--allow-unrelated-histories',
            '-s ours',
          ];
          return json;
        }
      );
    }
    // Update the app — Nx 22+ with Vite puts index.html at the app root
    const indexHtmlPath = existsSync(
      join(projectDirectory, `apps/${appName}/index.html`)
    )
      ? `apps/${appName}/index.html`
      : `apps/${appName}/src/index.html`;
    updateFile(projectDirectory, indexHtmlPath, (content) =>
      content.replace(
        '<div id="root"></div>',
        '<h1>Updated</h1><div id="root"></div>'
      )
    );

    // TEST
    // Deploy the updated app
    runCommand(
      `npx nx deploy ${nxProjectName} --no-interactive`,
      projectDirectory,
      {}
    );

    // ASSERT
    // Check that the gh-pages branch exists in the remote
    runCommand('git checkout gh-pages', remoteDirectory, {});

    // Check that the build artifacts are in the gh-pages branch...
    checkFilesExist(remoteDirectory, ['index.html']);
    expect(
      readFileSync(join(remoteDirectory, 'index.html'), 'utf-8')
    ).toContain('<h1>Updated</h1>');
  });
});

/**
 * Creates a test project with create-nx-workspace and installs the plugin
 * @returns The directory where the test project was created
 */
function createTestProject(remote: string) {
  const projectName = 'test-project';
  const projectDirectory = join(workspaceRoot, 'tmp', 'e2e', projectName);

  // Ensure projectDirectory is empty
  rmSync(projectDirectory, {
    recursive: true,
    force: true,
  });
  mkdirSync(dirname(projectDirectory), {
    recursive: true,
  });

  execSync(
    `npx --yes create-nx-workspace@latest ${projectName} --preset apps --nxCloud=skip --skipGit --no-interactive`,
    {
      cwd: dirname(projectDirectory),
      stdio: 'inherit',
      env: process.env,
    }
  );
  console.log(`Created test project in "${projectDirectory}"`);

  runCommand(`git init`, projectDirectory, {});
  runCommand(`git remote add origin ${remote}`, projectDirectory, {});

  return projectDirectory;
}

function createTestRemote() {
  const remoteDirectory = join(workspaceRoot, 'tmp', 'e2e', 'test-remote');

  // Ensure remoteDirectory is empty
  rmSync(remoteDirectory, {
    recursive: true,
    force: true,
  });
  mkdirSync(remoteDirectory, {
    recursive: true,
  });

  execSync('git init', {
    cwd: remoteDirectory,
    stdio: 'inherit',
  });

  return { remote: join(resolve(remoteDirectory), '.git'), remoteDirectory };
}

function installDependencies(
  projectDirectory: string,
  dependencies: { [name: string]: string },
  devDependencies: { [name: string]: string }
) {
  if (Object.keys(dependencies).length > 0) {
    execSync(
      `npm install ${Object.entries(dependencies)
        .map(([name, version]) => `${name}@${version}`)
        .join(' ')}`,
      {
        cwd: projectDirectory,
        stdio: 'inherit',
        env: process.env,
      }
    );
  }

  if (Object.keys(devDependencies).length > 0) {
    execSync(
      `npm install ${Object.entries(devDependencies)
        .map(([name, version]) => `${name}@${version}`)
        .join(' ')} --save-dev`,
      {
        cwd: projectDirectory,
        stdio: 'inherit',
        env: process.env,
      }
    );
  }
}

function runCommand(
  command: string,
  testProjectDirectory: string,
  options: Omit<ExecSyncOptions, 'cwd'>
) {
  return execSync(command, {
    cwd: testProjectDirectory,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

function checkFilesExist(directory: string, files: string[]) {
  files.forEach((file) => {
    expect(existsSync(join(directory, file))).toBe(true);
  });
}

function updateFile(
  directory: string,
  file: string,
  updater: (content: string) => string
) {
  const content = readFileSync(join(directory, file), 'utf-8');
  writeFileSync(join(directory, file), updater(content));
}

function updateJsonFile<T>(
  directory: string,
  file: string,
  updater: (json: T) => T
) {
  updateFile(directory, file, (content) => {
    return JSON.stringify(updater(JSON.parse(content)), null, 2);
  });
}

function getNxProjectName(
  projectDirectory: string,
  appName: string
): string {
  const pkgJson = JSON.parse(
    readFileSync(join(projectDirectory, 'package.json'), 'utf-8')
  );
  const scopeMatch = (pkgJson.name as string)?.match(/^(@[^/]+)\//);
  return scopeMatch ? `${scopeMatch[1]}/${appName}` : appName;
}

function generateReactApp(projectDirectory: string, projectName: string) {
  runCommand(
    `npx nx g @nx/react:app ${projectName} --directory apps/${projectName} --projectNameAndRootFormat=as-provided --e2eTestRunner none --unitTestRunner none --linter none --no-interactive`,
    projectDirectory,
    {}
  );
}
