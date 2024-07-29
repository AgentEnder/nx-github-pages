export interface ConfigurationGeneratorSchema {
  project: string;
  targetName: string;
  user?: {
    email: string;
    name: string;
  };
}
