import type { RailwayConnector } from '../connectors/railway/index.js';
import type { SmokeUrlVerifier } from '../deployment/index.js';
import type { DeliveryRunStateRecord, DeploymentResult, RailwayDeploymentMapping, RepositoryConfig } from '../domain/index.js';
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
  const mapping = input.repository.stagingDeployment;

  try {
    if (mapping === undefined) {
      throw new Error('No staging deployment mapping is configured for this repository. Configure repos.deployments.<repo>.staging or set verification.mode to none/github_only explicitly.');
    }

    if (mapping.verification.mode === 'none' || mapping.verification.mode === 'github_only') {
      verifiedDeployment = createSkippedStagingDeployment(input, mapping, now().toISOString());
      failureReason = undefined;
    } else if (mapping.verification.mode === 'http_smoke') {
      const smokeChecks = await input.smokeVerifier.verify({ serviceUrl: '', urls: mapping.verification.smokeUrls });
      verifiedDeployment = {
        ...createSkippedStagingDeployment(input, mapping, now().toISOString()),
        smokeChecks,
        summary: 'Verified staging by HTTP smoke URLs from the repository deployment mapping.'
      };
      failureReason = smokeChecks.every((check) => check.status !== 'failed')
        ? undefined
        : buildStagingFailureReason(verifiedDeployment);
    } else {
      assertCompleteRailwayMcpMapping(mapping);
      const deployment = await input.railway.waitForDeployment({
        repository: input.repository.ref,
        branch: mapping.branch,
        commitSha: input.commitSha,
        environment: 'staging',
        mapping
      });
      if (deployment.status !== 'success') {
        verifiedDeployment = normalizeUnavailableServiceUrl(deployment);
        failureReason = buildStagingFailureReason(verifiedDeployment);
      } else {
        const smokeUrls = mapping.verification.smokeUrls;
        const serviceUrl = hasUsableServiceUrl(deployment)
          ? deployment.serviceUrl
          : smokeUrls.length === 0
            ? 'unavailable'
            : await input.railway.getServiceUrl({ ref: deployment.ref, mapping });
        const smokeChecks = smokeUrls.length === 0
          ? []
          : await input.smokeVerifier.verify({ serviceUrl: assertValidStagingServiceUrl(serviceUrl), urls: smokeUrls });

        verifiedDeployment = {
          ...deployment,
          mapping,
          serviceUrl: smokeUrls.length === 0 ? serviceUrl : assertValidStagingServiceUrl(serviceUrl),
          smokeChecks
        };
        failureReason = smokeChecks.every((check) => check.status !== 'failed')
          ? undefined
          : buildStagingFailureReason(verifiedDeployment);
      }
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

function assertCompleteRailwayMcpMapping(mapping: RailwayDeploymentMapping): void {
  const missing = [
    mapping.projectId === undefined ? 'project_id' : undefined,
    mapping.environmentId === undefined ? 'environment_id' : undefined,
    mapping.serviceId === undefined ? 'service_id' : undefined
  ].filter((field): field is string => field !== undefined);

  if (missing.length > 0) {
    throw new Error(`Railway MCP staging verification requires repository deployment mapping field(s): ${missing.join(', ')}.`);
  }
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
  const mapping = input.repository.stagingDeployment;
  return {
    ref: {
      provider: 'railway',
      projectId: mapping?.projectId ?? 'unavailable',
      ...(mapping?.environmentId === undefined ? {} : { environmentId: mapping.environmentId }),
      serviceId: mapping?.serviceId ?? 'unavailable',
      deploymentId: `unavailable-${input.repository.ref.owner}-${input.repository.ref.name}-${input.branch}-${input.commitSha}`,
      environment: 'staging'
    },
    ...(mapping === undefined ? {} : { mapping }),
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

function createSkippedStagingDeployment(input: RunStagingVerificationInput, mapping: RailwayDeploymentMapping | undefined, occurredAt: string): DeploymentResult {
  return {
    ref: {
      provider: 'railway',
      projectId: mapping?.projectId ?? 'not-configured',
      ...(mapping?.environmentId === undefined ? {} : { environmentId: mapping.environmentId }),
      serviceId: mapping?.serviceId ?? 'not-configured',
      deploymentId: `not-configured-${input.repository.ref.owner}-${input.repository.ref.name}-${input.branch}-${input.commitSha}`,
      environment: 'staging'
    },
    ...(mapping === undefined ? {} : { mapping }),
    status: 'success',
    branch: mapping?.branch ?? input.branch,
    commitSha: input.commitSha,
    serviceUrl: 'unavailable',
    smokeChecks: [],
    startedAt: occurredAt,
    finishedAt: occurredAt,
    summary: mapping === undefined
      ? 'No staging deployment mapping is configured for this repository; Railway staging verification was skipped.'
      : `Repository staging verification mode ${mapping.verification.mode} does not require Railway deployment polling.`
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
