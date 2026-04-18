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
  preview?: PreviewOptions;
  user?: {
    email: string;
    name: string;
  };
}

export interface PreviewOptions {
  url?: string;
  pathPrefix?: string;
  comment?: boolean;
}
