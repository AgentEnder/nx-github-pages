export interface DeployExecutorSchema {
  remote?: string;
  directory?: string;
  remoteName: string;
  commitMessage: string;
  baseBranch: string;
  syncWithBaseBranch: boolean;
  syncStrategy: 'rebase' | 'merge';
  syncGitOptions: string[];
  CNAME?: string;
  user?: {
    email: string;
    name: string;
  };
}
