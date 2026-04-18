# nx-github-pages:configuration

## Options

### <span className="required">project</span>

- (string): The project that the target should be added to.

### user

- (object): User information to use when authoring deployment commit

### targetName

- (string): The name of the target to add.

### preview

- (boolean): Configure the deploy target for PR preview deployments. The executor auto-detects pull request context at runtime, so the same `deploy` target publishes a normal release outside of PRs and a `pr/&lt;N&gt;` preview when running in a PR.

### previewUrl

- (string): Base URL where previews will be hosted (used to build the PR comment link). Only applied when `preview` is true.

### addCleanupTarget

- (boolean): Also add a `cleanup-previews` target that removes stale PR preview deployments.
