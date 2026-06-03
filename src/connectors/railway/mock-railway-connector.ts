import type { DeploymentResult, DeploymentStatus } from '../../domain/index.js';
import type { RailwayConnector, ReadDeploymentInput, ServiceUrlInput, WaitForDeploymentInput } from './railway-connector.js';

export interface MockRailwayConnectorOptions {
  readonly status?: DeploymentStatus;
  readonly serviceUrl?: string;
  readonly summary?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export class MockRailwayConnector implements RailwayConnector {
  private readonly deployments = new Map<string, DeploymentResult>();

  constructor(private readonly options: MockRailwayConnectorOptions = {}) {}

  async waitForDeployment(input: WaitForDeploymentInput): Promise<DeploymentResult> {
    const deploymentId = `mock-${stableSlug(`${input.repository.owner}-${input.repository.name}-${input.environment}-${input.branch}-${input.commitSha}`)}`;
    const serviceUrl = this.options.serviceUrl ?? `https://${input.repository.name}-${input.environment}.mock-railway.local`;
    const status = this.options.status ?? 'success';
    const result: DeploymentResult = {
      ref: {
        provider: 'railway',
        projectId: `mock-project-${stableSlug(input.repository.owner)}`,
        serviceId: `mock-service-${stableSlug(input.repository.name)}`,
        deploymentId,
        environment: input.environment
      },
      status,
      branch: input.branch,
      commitSha: input.commitSha,
      serviceUrl,
      smokeChecks: [],
      startedAt: this.options.startedAt ?? '2026-06-03T10:30:00.000Z',
      ...(status === 'pending' || status === 'deploying' ? {} : { finishedAt: this.options.finishedAt ?? '2026-06-03T10:31:00.000Z' }),
      summary: this.options.summary ?? `Mock Railway deployment ${status} for ${input.repository.owner}/${input.repository.name} on ${input.branch}.`
    };

    this.deployments.set(deploymentKey(result), result);
    return result;
  }

  async readDeployment(input: ReadDeploymentInput): Promise<DeploymentResult> {
    const deployment = this.deployments.get(deploymentRefKey(input.ref));

    if (deployment === undefined) {
      throw new Error(`Mock Railway deployment ${input.ref.deploymentId} has not been created.`);
    }

    return deployment;
  }

  async getServiceUrl(input: ServiceUrlInput): Promise<string> {
    const deployment = await this.readDeployment(input);
    return deployment.serviceUrl;
  }
}

function deploymentKey(result: DeploymentResult): string {
  return deploymentRefKey(result.ref);
}

function deploymentRefKey(ref: DeploymentResult['ref']): string {
  return `${ref.projectId}/${ref.serviceId}/${ref.deploymentId}`;
}

function stableSlug(source: string): string {
  const normalized = source.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  return normalized.length === 0 ? 'deployment' : normalized.slice(0, 80);
}
