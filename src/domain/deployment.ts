export type DeploymentProvider = 'railway';

export type DeploymentEnvironment = 'staging' | 'production';

export type DeploymentStatus = 'pending' | 'deploying' | 'success' | 'failed' | 'cancelled';

export interface DeploymentRef {
  readonly provider: DeploymentProvider;
  readonly projectId: string;
  readonly serviceId: string;
  readonly deploymentId: string;
  readonly environment: DeploymentEnvironment;
}

export interface SmokeCheckResult {
  readonly url: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly statusCode?: number;
  readonly summary: string;
}

export interface DeploymentResult {
  readonly ref: DeploymentRef;
  readonly status: DeploymentStatus;
  readonly branch: string;
  readonly commitSha: string;
  readonly serviceUrl: string;
  readonly smokeChecks: readonly SmokeCheckResult[];
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly summary: string;
}
