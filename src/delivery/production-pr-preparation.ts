import type { GitHubConnector } from '../connectors/github/index.js';
import { buildProductionPullRequestBody } from '../connectors/github/index.js';
import type { DeliveryRunStateRecord, DeliveryTicket, PullRequestRef, RepositoryConfig } from '../domain/index.js';
import type { RunStateStore } from '../state/index.js';
import { assertProductionPullRequestReady, recordProductionPullRequestOpened } from '../state/index.js';

export interface RunProductionPullRequestPreparationInput {
  readonly state: DeliveryRunStateRecord;
  readonly ticket: DeliveryTicket;
  readonly repository: RepositoryConfig;
  readonly github: GitHubConnector;
  readonly stateStore: RunStateStore;
  readonly now?: () => Date;
}

export async function runProductionPullRequestPreparation(input: RunProductionPullRequestPreparationInput): Promise<DeliveryRunStateRecord> {
  assertProductionPullRequestReady(input.state);

  const now = input.now ?? (() => new Date());
  const developPullRequest = requireDevelopPullRequest(input.state, input.repository);
  const stagingDeployment = requireLatestStagingDeployment(input.state);
  const productionTarget = input.repository.branchPolicy.productionTarget;
  const sourceBranch = input.repository.branchPolicy.stagingTarget;
  const pullRequest = await input.github.openPullRequest({
    repository: input.repository.ref,
    title: `${input.ticket.ref.key} Production approval`,
    body: buildProductionPullRequestBody({
      ticket: input.ticket,
      analysis: input.state.ticketAnalysis,
      runId: input.state.runId,
      repository: input.repository.ref,
      developPullRequest,
      stagingDeployment,
      sourceBranch,
      targetBranch: productionTarget
    }),
    sourceBranch,
    targetBranch: productionTarget
  });
  const finalState = recordProductionPullRequestOpened(input.state, pullRequest, now().toISOString());

  await input.stateStore.write(finalState);

  return finalState;
}

function requireDevelopPullRequest(state: DeliveryRunStateRecord, repository: RepositoryConfig): PullRequestRef {
  const pullRequest = state.pullRequests.find(
    (candidate) =>
      candidate.repositoryOwner === repository.ref.owner &&
      candidate.repositoryName === repository.ref.name &&
      candidate.targetBranch === repository.branchPolicy.stagingTarget
  );

  if (pullRequest === undefined) {
    throw new Error('Production PR preparation requires an open develop pull request in run state.');
  }

  return pullRequest;
}

function requireLatestStagingDeployment(state: DeliveryRunStateRecord): DeliveryRunStateRecord['stagingDeployments'][number] {
  const deployment = state.stagingDeployments[state.stagingDeployments.length - 1];

  if (deployment === undefined) {
    throw new Error('Production PR preparation requires a staging deployment in run state.');
  }

  return deployment;
}
