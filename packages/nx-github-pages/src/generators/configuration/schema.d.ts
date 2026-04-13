export interface ConfigurationGeneratorSchema {
  project: string;
  targetName: string;
  preview?: boolean;
  previewUrl?: string;
  addCleanupTarget?: boolean;
  user?: {
    email: string;
    name: string;
  };
}
