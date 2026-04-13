export interface CleanupPreviewExecutorSchema {
  remote?: string;
  remoteName: string;
  baseBranch: string;
  pathPrefix: string;
  maxAgeDays: number;
  all: boolean;
  updatePrComments: boolean;
  commitMessage: string;
  user?: {
    name: string;
    email: string;
  };
}
