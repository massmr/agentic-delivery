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

  const deployment = await input.railway.waitForDeployment({
    repository: input.repository.ref,
    branch: input.branch,
    commitSha: input.commitSha,
    environment: 'staging'
  });
  const serviceUrl = await input.railway.getServiceUrl({ ref: deployment.ref });
  const smokeChecks = await input.smokeVerifier.verify({ serviceUrl, urls: input.repository.stagingSmokeUrls });
  const verifiedDeployment: DeploymentResult = {
    ...deployment,
    serviceUrl,
    smokeChecks
  };
  const failedSmokeCheck = smokeChecks.find((check) => check.status === 'failed');
  const finalState =
    deployment.status === 'success' && failedSmokeCheck === undefined
      ? recordStagingVerified(deployingState, verifiedDeployment, now().toISOString())
      : recordStagingFailed(deployingState, verifiedDeployment, buildStagingFailureReason(verifiedDeployment), now().toISOString());

  await input.stateStore.write(finalState);
  await input.reportWriter.writeStaging(finalState.ticket.key, finalState.runId, verifiedDeployment, finalState.failure);

  return finalState;
}

function buildStagingFailureReason(deployment: DeploymentResult): string {
  if (deployment.status !== 'success') {
    return `Railway staging deployment ${deployment.ref.deploymentId} finished with status ${deployment.status}. ${deployment.summary}`;
  }

  const failedChecks = deployment.smokeChecks.filter((check) => check.status === 'failed');
  const failedUrls = failedChecks.map((check) => check.url).join(', ');
  return `Staging smoke verification failed for ${failedChecks.length} URL(s): ${failedUrls}.`;
}
