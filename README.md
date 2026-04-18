# Nx Github Pages

This project was generated using [Nx](https://nx.dev).

A simple Nx plugin to enable deploying a static project to Github Pages.

> [!NOTE]  
> This plugin was formerly published as @nx-dotnet/nx-ghpages. It was moved due to not being relevant to .NET and to decouple the releases. To view previous versions and changelogs checkout the [nx-dotnet repo](https://github.com/nx-dotnet/nx-dotnet)

## Installation

To install the plugin, run:

```bash
nx add nx-github-pages
```

## Usage

Pick a project to deploy and run:

```bash
nx g nx-github-pages:configuration --project=<project-name>
```

After the configuration is generated, you can deploy the project by running:

```bash
nx run <project-name>:deploy
```

## Pull Request Preview Deployments

The `deploy` executor can also publish a pull request preview into a subdirectory of your `gh-pages` branch (e.g. `https://<you>.github.io/<repo>/pr/123/`) and post an updating comment on the pull request with the preview URL. The same `deploy` target handles both modes — it auto-detects a PR context from the environment (`GITHUB_REF=refs/pull/<N>/merge` or `PR_NUMBER`) and switches to preview mode when one is present. A companion `cleanup-preview` executor removes stale previews on a schedule.

### Generate a preview-enabled target

```bash
nx g nx-github-pages:configuration \
  --project=<project-name> \
  --preview \
  --previewUrl=https://<you>.github.io/<repo> \
  --addCleanupTarget
```

This creates two things on the project:

```jsonc
{
  "deploy": {
    "executor": "nx-github-pages:deploy",
    "options": {
      "preview": { "url": "https://<you>.github.io/<repo>" },
      "syncWithBaseBranch": true
      /* ...any other deploy options... */
    }
  },
  "cleanup-previews": {
    "executor": "nx-github-pages:cleanup-preview",
    "options": {}
  }
}
```

`syncWithBaseBranch` is enabled when `--preview` is passed so that non-PR deploys merge into `gh-pages` rather than force-pushing — that preserves the `pr/*` subdirectories published by previous preview runs.

### Preview executor options

All standard `deploy` options still apply. Preview-specific options live under a `preview` object:

| Option                | Default                                                    | Description                                                                     |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `preview.pathPrefix`  | `pr/${PR_NUMBER ?? GITHUB_SHA}`                            | Subdirectory on the target branch to deploy into.                               |
| `preview.url`         | Derived from `CNAME` or `https://<owner>.github.io/<repo>` | Base URL used in the PR comment. The `pathPrefix` is appended automatically.    |
| `preview.comment`     | `true`                                                     | Whether to upsert a PR comment with the preview link via the GitHub REST API.   |

When the executor detects a PR context, it switches into preview mode: it **clones** the target branch, copies the build output into `<pathPrefix>/`, and pushes without force — so sibling PR folders are preserved. Outside of a PR (e.g. a push to `main`), the same target runs a standard deploy instead.

### ⚠️ Your build MUST use a matching base URL

Since the preview is served from a subdirectory, your framework needs to know about that subdirectory _at build time_, or every asset will 404 after deploy. The plugin **enforces this** by scanning the build output for references to the path prefix before pushing. If the check fails you'll get a descriptive error pointing at the right base URL flag for your framework.

Pass the prefix to the build step as an environment variable and consume it in your framework config:

```bash
PATH_PREFIX="/pr/${PR_NUMBER:-$GITHUB_SHA}"

# Vite
npx nx build my-app -- --base="$PATH_PREFIX/"

# Next.js (in next.config.js: basePath: process.env.NEXT_BASE_PATH)
NEXT_BASE_PATH="$PATH_PREFIX" npx nx build my-app

# Angular
npx nx build my-app -- --base-href="$PATH_PREFIX/"

# Astro
npx nx build my-app -- --base="$PATH_PREFIX"
```

Then deploy as usual — preview mode is selected automatically when `GITHUB_REF`/`PR_NUMBER` indicate a pull request:

```bash
npx nx deploy my-app
```

If you serve previews through a CDN rewrite or some other scheme where the prefix legitimately does not appear in the built files, bypass the check with `NX_GITHUB_PAGES_SKIP_BASE_URL_CHECK=true`.

### Required environment

The executor auto-detects context from standard GitHub Actions environment variables:

| Variable            | Source                       | Purpose                                           |
| ------------------- | ---------------------------- | ------------------------------------------------- |
| `GITHUB_REPOSITORY` | Actions runner               | Owner/repo for the PR comment.                    |
| `GITHUB_REF`        | Actions runner               | Extracts the PR number from `refs/pull/<N>/merge`. Presence of a PR number activates preview mode. |
| `PR_NUMBER`         | Set it yourself              | Fallback for PR number; used in `pathPrefix`. Presence activates preview mode. |
| `GITHUB_SHA`        | Actions runner               | Included in the PR comment; fallback path prefix. |
| `GH_TOKEN`          | `secrets.GITHUB_TOKEN` or PAT | Auth for `git push` **and** the Octokit comment.  |

For the PR comment to work, install `@octokit/rest` in your workspace. It's declared as an optional peer dependency of the plugin:

```bash
npm install --save-dev @octokit/rest
```

### Example GitHub Actions workflow

```yaml
name: PR Preview
on:
  pull_request:
    branches: [main]

jobs:
  preview:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Build with preview base URL
        run: npx nx build my-app -- --base="$PATH_PREFIX/"
        env:
          PATH_PREFIX: /pr/${{ github.event.number }}

      - name: Deploy preview
        run: npx nx deploy my-app
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.number }}
```

### Cleaning up stale previews

Add a scheduled workflow that runs the `cleanup-preview` executor. It clones the deployment branch, removes `pr/*` directories older than `maxAgeDays` (default `7`), and updates each corresponding PR comment to say the preview has been cleaned up.

```yaml
name: Cleanup PR Previews
on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:
    inputs:
      all:
        description: 'Cleanup every preview regardless of age'
        type: boolean
        default: false

jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx nx run my-app:cleanup-previews ${{ inputs.all && '--all' || '' }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`cleanup-preview` options: `remote`, `baseBranch` (default `gh-pages`), `pathPrefix` (default `pr`), `maxAgeDays` (default `7`), `all` (default `false`), `updatePrComments` (default `true`).
