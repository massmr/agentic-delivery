import type { RailwayConnector } from '../connectors/railway/index.js';
import type { SmokeUrlVerifier } from '../deployment/index.js';
import type { DeliveryRunStateRecord, DeploymentResult, RepositoryConfig } from '../domain/index.js';
import type { MarkdownReportWriter } from '../reports/index.js';
import type { RunStateStore } from '../state/index.js';
import { recordStagingDeploying, recordStagingFailed, recordStagingVerified } from '../state/index.js';

export interface RunStagingVerificationInput {
  readonly state: DeliveryRunStateRecord;
  readonly repository: RepositoryConfig;
  readonly branch: string;
  readonly commitSha: string;
  readonly railway: RailwayConnector;
  readonly smokeVerifier: SmokeUrlVerifier;
  readonly stateStore: RunStateStore;
  readonly reportWriter: MarkdownReportWriter;
  readonly now?: () => Date;
}

export async function runStagingVerification(input: RunStagingVerificationInput): Promise<DeliveryRunStateRecord> {
  if (input.state.state !== 'DEVELOP_CHECKS_PASSED') {
    throw new Error(`Staging verification requires DEVELOP_CHECKS_PASSED state; current state is ${input.state.state}.`);
  }

  const now = input.now ?? (() => new Date());
  const deployingState = recordStagingDeploying(input.state, now().toISOString());
  await input.stateStore.write(deployingState);

  let verifiedDeployment: DeploymentResult;
  let failureReason: string | undefined;

  try {
    const deployment = await input.railway.waitForDeployment({
      repository: input.repository.ref,
      branch: input.branch,
      commitSha: input.commitSha,
      environment: 'staging'
    });
    if (deployment.status !== 'success') {
      verifiedDeployment = normalizeUnavailableServiceUrl(deployment);
      failureReason = buildStagingFailureReason(verifiedDeployment);
    } else {
      const serviceUrl = assertValidStagingServiceUrl(hasUsableServiceUrl(deployment) ? deployment.serviceUrl : await input.railway.getServiceUrl({ ref: deployment.ref }));
      const smokeChecks = await input.smokeVerifier.verify({ serviceUrl, urls: input.repository.stagingSmokeUrls });

      verifiedDeployment = {
        ...deployment,
        serviceUrl,
        smokeChecks
      };
      failureReason = smokeChecks.every((check) => check.status !== 'failed')
        ? undefined
        : buildStagingFailureReason(verifiedDeployment);
    }
  } catch (error) {
    verifiedDeployment = createFailedStagingDeployment(input, String(readErrorMessage(error)), now().toISOString());
    failureReason = `Railway staging verification failed: ${readErrorMessage(error)}`;
  }

  const finalState = failureReason === undefined
    ? recordStagingVerified(deployingState, verifiedDeployment, now().toISOString())
    : recordStagingFailed(deployingState, verifiedDeployment, failureReason, now().toISOString());

  await input.stateStore.write(finalState);
  await input.reportWriter.writeStaging(finalState.ticket.key, finalState.runId, verifiedDeployment, finalState.failure);

  return finalState;
}

function hasUsableServiceUrl(deployment: DeploymentResult): boolean {
  return typeof deployment.serviceUrl === 'string' && deployment.serviceUrl.trim().length > 0 && deployment.serviceUrl !== 'unavailable';
}

function buildStagingFailureReason(deployment: DeploymentResult): string {
  if (deployment.status !== 'success') {
    return `Railway staging deployment ${deployment.ref.deploymentId} finished with status ${deployment.status}. ${deployment.summary}`;
  }

  const failedChecks = deployment.smokeChecks.filter((check) => check.status === 'failed');
  const failedUrls = failedChecks.map((check) => check.url).join(', ');
  return `Staging smoke verification failed for ${failedChecks.length} URL(s): ${failedUrls}.`;
}

function assertValidStagingServiceUrl(serviceUrl: string): string {
  const url = parseUrl(serviceUrl);

  if (url !== undefined && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return serviceUrl;
  }

  throw new Error('Railway staging deployment service URL must be an HTTP(S) URL.');
}

function normalizeUnavailableServiceUrl(deployment: DeploymentResult): DeploymentResult {
  if (typeof deployment.serviceUrl === 'string' && deployment.serviceUrl.trim().length > 0) {
    return deployment;
  }

  return {
    ...deployment,
    serviceUrl: 'unavailable',
    smokeChecks: []
  };
}

function parseUrl(serviceUrl: string): URL | undefined {
  try {
    return new URL(serviceUrl);
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
}

function createFailedStagingDeployment(input: RunStagingVerificationInput, summary: string, occurredAt: string): DeploymentResult {
  return {
    ref: {
      provider: 'railway',
      projectId: 'unavailable',
      serviceId: 'unavailable',
      deploymentId: `unavailable-${input.repository.ref.owner}-${input.repository.ref.name}-${input.branch}-${input.commitSha}`,
      environment: 'staging'
    },
    status: 'failed',
    branch: input.branch,
    commitSha: input.commitSha,
    serviceUrl: 'unavailable',
    smokeChecks: [],
    startedAt: occurredAt,
    finishedAt: occurredAt,
    summary
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
