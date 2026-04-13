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
    generateReactApp(projectDirectory, appName);
    const nxProjectName = getNxProjectName(projectDirectory, appName);

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

  it('should deploy a preview into a pr/<id> subdirectory and be cleaned up', () => {
    const appName = 'my-app';
    generateReactApp(projectDirectory, appName);
    const nxProjectName = getNxProjectName(projectDirectory, appName);

    // Patch the generated Vite config so `base` reads from a BASE_URL env
    // var at build time. This is how consumers wire the preview path prefix
    // into their framework, and it lets the plugin's base URL check find
    // "/pr/42/" references in the actual built output.
    patchViteConfigWithBaseUrl(projectDirectory, appName);

    runCommand(
      `npx nx g nx-github-pages:configuration --project ${nxProjectName} --preview --previewUrl https://example.github.io/test --addCleanupTarget --user.name deployment-bot --user.email deployment@testing.com --no-interactive`,
      projectDirectory,
      {}
    );

    const previewEnv = {
      PR_NUMBER: '42',
      GITHUB_SHA: 'deadbeefcafebabe1234567890abcdef12345678',
      GITHUB_REPOSITORY: 'agentender/test-repo',
      BASE_URL: '/pr/42/',
    };

    runCommand(
      `npx nx deploy ${nxProjectName} -c preview --no-interactive`,
      projectDirectory,
      { env: { ...process.env, ...previewEnv } }
    );

    // Assert the preview landed in pr/42 on the gh-pages branch.
    runCommand('git checkout gh-pages', remoteDirectory, {});
    checkFilesExist(remoteDirectory, ['pr/42/index.html']);
    // And that the built index.html actually carries the preview base URL —
    // this is what the plugin's base URL safeguard is enforcing.
    expect(
      readFileSync(join(remoteDirectory, 'pr/42/index.html'), 'utf-8')
    ).toContain('/pr/42/');

    // Now run cleanup --all and verify the pr/42 directory is removed.
    // The remote is configured with `receive.denyCurrentBranch=updateInstead`,
    // so the cleanup push refreshes the remote's work tree in place — we can
    // read the file state directly without another checkout.
    runCommand(
      `npx nx run ${nxProjectName}:cleanup-previews --all --no-interactive`,
      projectDirectory,
      { env: { ...process.env, ...previewEnv } }
    );

    expect(existsSync(join(remoteDirectory, 'pr/42/index.html'))).toBe(false);
  });

  it('should fail the preview deploy when the build output lacks the path prefix', () => {
    const appName = 'my-app';
    generateReactApp(projectDirectory, appName);
    const nxProjectName = getNxProjectName(projectDirectory, appName);

    runCommand(
      `npx nx g nx-github-pages:configuration --project ${nxProjectName} --preview --user.name deployment-bot --user.email deployment@testing.com --no-interactive`,
      projectDirectory,
      {}
    );

    const previewEnv = {
      PR_NUMBER: '7',
      GITHUB_SHA: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      GITHUB_REPOSITORY: 'agentender/test-repo',
    };

    let caught: { status: number; stderr: string; stdout: string } | null =
      null;
    try {
      execSync(
        `npx nx deploy ${nxProjectName} -c preview --no-interactive`,
        {
          cwd: projectDirectory,
          stdio: 'pipe',
          env: { ...process.env, ...previewEnv },
        }
      );
    } catch (err) {
      const e = err as {
        status: number;
        stderr: Buffer;
        stdout: Buffer;
      };
      caught = {
        status: e.status,
        stderr: e.stderr?.toString() ?? '',
        stdout: e.stdout?.toString() ?? '',
      };
    }

    if (!caught) {
      throw new Error('Expected preview deploy to fail, but it succeeded.');
    }
    expect(caught.status).not.toBe(0);
    const combined = caught.stderr + caught.stdout;
    expect(combined).toMatch(/base URL check failed/i);
    expect(combined).toMatch(/NX_GITHUB_PAGES_SKIP_BASE_URL_CHECK/);
  });

  it('should sync via merge sync enabled and deployment already exists', () => {
    const appName = 'my-app';

    // SETUP
    // Create a new app
    generateReactApp(projectDirectory, appName);
    const nxProjectName = getNxProjectName(projectDirectory, appName);
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

  // The test remote is a non-bare repo. When a test checks out `gh-pages` in
  // the work tree (to assert deployed files exist) and then a subsequent step
  // pushes back to `gh-pages` on the same remote, git refuses by default with
  // `denyCurrentBranch`. `updateInstead` lets the push succeed and also
  // refreshes the work tree so later assertions see the latest state.
  execSync('git config receive.denyCurrentBranch updateInstead', {
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
  const appPackageJson = join(projectDirectory, `apps/${appName}/package.json`);
  if (existsSync(appPackageJson)) {
    const name = JSON.parse(readFileSync(appPackageJson, 'utf-8'))
      .name as string | undefined;
    if (name) return name;
  }

  const appProjectJson = join(projectDirectory, `apps/${appName}/project.json`);
  if (existsSync(appProjectJson)) {
    const name = JSON.parse(readFileSync(appProjectJson, 'utf-8'))
      .name as string | undefined;
    if (name) return name;
  }

  return appName;
}

/**
 * Patch the Vite config of a freshly generated @nx/react app so the `base`
 * option is read from `process.env.BASE_URL` at build time. The plugin's
 * base URL check then has something real to find in the build output when
 * we run a preview deploy.
 *
 * Handles both the function-form `defineConfig(() => ({...}))` and the
 * object-form `defineConfig({...})` that different Nx versions emit.
 */
function patchViteConfigWithBaseUrl(
  projectDirectory: string,
  appName: string
): void {
  const candidates = [
    `apps/${appName}/vite.config.ts`,
    `apps/${appName}/vite.config.mts`,
    `apps/${appName}/vite.config.js`,
  ];
  const configPath = candidates.find((p) =>
    existsSync(join(projectDirectory, p))
  );
  if (!configPath) {
    throw new Error(
      `Could not find a vite.config file under apps/${appName} — tried: ${candidates.join(', ')}`
    );
  }

  updateFile(projectDirectory, configPath, (content) => {
    // The `root:` field is a stable landmark emitted by every recent
    // @nx/react Vite config generator. Its value is either `__dirname`
    // (older CJS templates) or `import.meta.dirname` (newer ESM templates).
    // Insert `base` immediately before it.
    const rootLine = /^(\s*)root:\s*(?:__dirname|import\.meta\.dirname),/m;
    if (!rootLine.test(content)) {
      throw new Error(
        `Unexpected vite.config shape — no 'root:' landmark found in ${configPath}`
      );
    }
    return content.replace(
      rootLine,
      (match, indent) =>
        `${indent}base: process.env.BASE_URL ?? '/',\n${match}`
    );
  });
}

function generateReactApp(projectDirectory: string, projectName: string) {
  runCommand(
    `npx nx g @nx/react:app ${projectName} --directory apps/${projectName} --projectNameAndRootFormat=as-provided --e2eTestRunner none --unitTestRunner none --linter none --no-interactive`,
    projectDirectory,
    {}
  );
}
