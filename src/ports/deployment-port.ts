import type { DeploymentEnvironment, DeploymentRef, DeploymentResult, RailwayDeploymentMapping, RepositoryRef } from '../domain/index.js';

export interface WaitForDeploymentInput {
  readonly repository: RepositoryRef;
  readonly branch: string;
  readonly commitSha: string;
  readonly environment: DeploymentEnvironment;
  readonly mapping?: RailwayDeploymentMapping | undefined;
}

export interface ReadDeploymentInput {
  readonly ref: DeploymentRef;
  readonly mapping?: RailwayDeploymentMapping | undefined;
}

export interface ServiceUrlInput {
  readonly ref: DeploymentRef;
  readonly mapping?: RailwayDeploymentMapping | undefined;
}

export interface DeploymentPort {
  waitForDeployment(input: WaitForDeploymentInput): Promise<DeploymentResult>;
  readDeployment(input: ReadDeploymentInput): Promise<DeploymentResult>;
  getServiceUrl(input: ServiceUrlInput): Promise<string>;
}
