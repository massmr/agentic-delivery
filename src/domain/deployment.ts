export type DeploymentProvider = 'railway';

export type DeploymentEnvironment = 'staging' | 'production';

export type DeploymentStatus = 'pending' | 'deploying' | 'success' | 'failed' | 'cancelled';

export type DeploymentVerificationMode = 'railway_mcp' | 'http_smoke' | 'github_only' | 'none';

export interface DeploymentVerificationConfig {
  readonly mode: DeploymentVerificationMode;
  readonly smokeUrls: readonly string[];
}

export interface RailwayDeploymentMapping {
  readonly provider: 'railway';
  readonly projectId?: string | undefined;
  readonly environmentId?: string | undefined;
  readonly serviceId?: string | undefined;
  readonly branch: string;
  readonly verification: DeploymentVerificationConfig;
}

export interface DeploymentRef {
  readonly provider: DeploymentProvider;
  readonly projectId: string;
  readonly environmentId?: string | undefined;
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
  readonly mapping?: RailwayDeploymentMapping | undefined;
  readonly status: DeploymentStatus;
  readonly branch: string;
  readonly commitSha: string;
  readonly serviceUrl: string;
  readonly smokeChecks: readonly SmokeCheckResult[];
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly summary: string;
}
