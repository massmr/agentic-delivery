import type { QualityGateDefinition } from './quality.js';

export type RepositoryProvider = 'github';

export type RepositoryRole = 'application' | 'service' | 'library' | 'infrastructure';

export interface RepositoryRef {
  readonly provider: RepositoryProvider;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly url: string;
}

export interface BranchPolicy {
  readonly workingBranchPrefix: string;
  readonly stagingTarget: 'develop';
  readonly productionTarget: 'main';
}

export interface RepositoryConfig {
  readonly ref: RepositoryRef;
  readonly role: RepositoryRole;
  readonly localPath: string;
  readonly branchPolicy: BranchPolicy;
  readonly qualityGates: readonly QualityGateDefinition[];
  readonly stagingSmokeUrls: readonly string[];
}

export interface RepositoryMatch {
  readonly repository: RepositoryRef;
  readonly confidence: number;
  readonly reasoning: string;
}
