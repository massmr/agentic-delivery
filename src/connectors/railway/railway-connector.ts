import type { DeploymentEnvironment, DeploymentRef, DeploymentResult, RepositoryRef } from '../../domain/index.js';

export interface WaitForDeploymentInput {
  readonly repository: RepositoryRef;
  readonly branch: string;
  readonly commitSha: string;
  readonly environment: DeploymentEnvironment;
}

export interface ReadDeploymentInput {
  readonly ref: DeploymentRef;
}

export interface ServiceUrlInput {
  readonly ref: DeploymentRef;
}

export interface RailwayConnector {
  waitForDeployment(input: WaitForDeploymentInput): Promise<DeploymentResult>;
  readDeployment(input: ReadDeploymentInput): Promise<DeploymentResult>;
  getServiceUrl(input: ServiceUrlInput): Promise<string>;
}
