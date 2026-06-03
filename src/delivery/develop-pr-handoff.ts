import type { DeliveryRunStateRecord, DeliveryTicket, RepositoryConfig } from '../domain/index.js';
import type { GitHubConnector } from '../connectors/github/index.js';
import { buildDevelopPullRequestBody } from '../connectors/github/index.js';
import type { LocalGitAdapter } from '../git/index.js';
import type { RunStateStore } from '../state/index.js';
import { recordBranchCreated, recordBranchPushed, recordPullRequestOpened } from '../state/index.js';

export interface DevelopPullRequestHandoffInput {
  readonly state: DeliveryRunStateRecord;
  readonly ticket: DeliveryTicket;
  readonly repository: RepositoryConfig;
  readonly branchName: string;
  readonly git: LocalGitAdapter;
  readonly github: GitHubConnector;
  readonly stateStore: RunStateStore;
  readonly now?: () => Date;
}

export async function runDevelopPullRequestHandoff(input: DevelopPullRequestHandoffInput): Promise<DeliveryRunStateRecord> {
  const now = input.now ?? (() => new Date());
  const branch = await input.git.createBranch({
    repository: input.repository.ref,
    localPath: input.repository.localPath,
    branchName: input.branchName,
    baseBranch: input.repository.branchPolicy.stagingTarget
  });
  const branchCreatedState = recordBranchCreated(input.state, branch, now().toISOString());

  await input.stateStore.write(branchCreatedState);
  assertReadyForDevelopPullRequest(input.state);

  await input.github.createBranch({ repository: input.repository.ref, branch });

  const pushedBranch = await input.github.pushBranch({ repository: input.repository.ref, branch });
  const pushedState = recordBranchPushed(branchCreatedState, pushedBranch, now().toISOString());

  await input.stateStore.write(pushedState);

  const latestQualityReport = requireLatestPassedRequiredQualityReport(input.state);
  const pullRequest = await input.github.openPullRequest({
    repository: input.repository.ref,
    title: `${input.ticket.ref.key} ${input.ticket.summary}`,
    body: buildDevelopPullRequestBody({
      ticket: input.ticket,
      analysis: input.state.ticketAnalysis,
      runId: input.state.runId,
      repository: input.repository.ref,
      branch: pushedBranch,
      qualityReport: latestQualityReport
    }),
    sourceBranch: pushedBranch.name,
    targetBranch: input.repository.branchPolicy.stagingTarget
  });
  const pullRequestState = recordPullRequestOpened(pushedState, pullRequest, now().toISOString());

  await input.stateStore.write(pullRequestState);

  return pullRequestState;
}

function assertReadyForDevelopPullRequest(state: DeliveryRunStateRecord): void {
  if (state.state !== 'LOCAL_CHECKS_PASSED') {
    throw new Error(`Develop PR handoff requires LOCAL_CHECKS_PASSED state; current state is ${state.state}.`);
  }

  requireLatestPassedRequiredQualityReport(state);
}

function requireLatestPassedRequiredQualityReport(state: DeliveryRunStateRecord): DeliveryRunStateRecord['qualityReports'][number] {
  const latestQualityReport = state.qualityReports[state.qualityReports.length - 1];

  if (latestQualityReport === undefined) {
    throw new Error('Develop PR handoff requires a quality report before push or PR creation.');
  }

  const failedRequiredGate = latestQualityReport.required.find((result) => result.status !== 'passed');

  if (latestQualityReport.status !== 'passed' || failedRequiredGate !== undefined) {
    throw new Error('Develop PR handoff requires the latest required quality report to pass before push or PR creation.');
  }

  return latestQualityReport;
}
