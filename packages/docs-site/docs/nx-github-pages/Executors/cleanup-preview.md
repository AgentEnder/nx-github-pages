# nx-github-pages:cleanup-preview

## Cleanup Preview Deployments

Remove old preview deployments from the target gh-pages branch and update the associated PR comments.

## Options

### remote

- (string): URL for the git remote containing the preview deployments. Defaults to the project&#39;s origin remote.

### remoteName

- (string): Name of the remote to push to

### baseBranch

- (string): Branch that hosts the deployed site

### pathPrefix

- (string): Top-level directory on the deployment branch that contains per-PR subdirectories

### maxAgeDays

- (number): Delete preview directories whose most recent commit is older than this many days

### all

- (boolean): Delete every preview directory regardless of age

### updatePrComments

- (boolean): Update the preview deployment PR comment for each cleaned directory

### commitMessage

- (string): Commit message used for the cleanup commit

### user

- (object): User information used when authoring the cleanup commit
