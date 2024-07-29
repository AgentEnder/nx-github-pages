import { ExecSyncOptions, execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ProjectConfiguration, workspaceRoot } from '@nx/devkit';

describe('nx-github-pages', () => {
  let projectDirectory, remote, remoteDirectory: string;

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
    generateReactApp(projectDirectory, 'my-app');

    runCommand(
      'npx nx g nx-github-pages:configuration --project my-app --no-interactive',
      projectDirectory,
      {}
    );

    runCommand('npx nx deploy my-app --no-interactive', projectDirectory, {});

    // Check that the gh-pages branch exists in the remote
    runCommand('git checkout gh-pages', remoteDirectory, {});

    // Check that the build artifacts are in the gh-pages branch...
    // We can't really do a "full e2e" here without pushing a real site
    // to GitHub Pages, but this is a good start.
    checkFilesExist(remoteDirectory, ['index.html']);
  });

  it('should sync via merge sync enabled and deployment already exists', () => {
    // SETUP
    // Create a new app
    generateReactApp(projectDirectory, 'my-app');
    // Create the configuration
    runCommand(
      'npx nx g nx-github-pages:configuration --project my-app --no-interactive',
      projectDirectory,
      {}
    );
    // Initial deployment
    runCommand('npx nx deploy my-app --no-interactive', projectDirectory, {});
    // enable sync settings
    updateJsonFile<ProjectConfiguration>(
      projectDirectory,
      'apps/my-app/project.json',
      (json) => {
        json.targets.deploy.options.syncWithBaseBranch = true;
        return json;
      }
    );
    // Update the app
    updateFile(projectDirectory, 'apps/my-app/src/index.html', (content) =>
      content.replace(
        '<div id="root"></div>',
        '<h1>Updated</h1><div id="root"></div>'
      )
    );

    // TEST
    // Deploy the updated app
    runCommand('npx nx deploy my-app --no-interactive', projectDirectory, {});

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
    `npx --yes create-nx-workspace@latest ${projectName} --preset apps --nxCloud=skip --no-interactive`,
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

function generateReactApp(projectDirectory: string, projectName: string) {
  runCommand(
    `npx nx g @nx/react:app ${projectName} --directory apps/${projectName} --projectNameAndRootFormat=as-provided --e2eTestRunner none --unitTestRunner none --linter none --no-interactive`,
    projectDirectory,
    {}
  );
}
