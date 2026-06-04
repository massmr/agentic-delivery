import type { OperationLedger } from '../agent/index.js';
import { InMemoryOperationLedger, JsonOperationLedger } from '../agent/index.js';
import type { GitHubConnector } from '../connectors/github/index.js';
import { buildDevelopPullRequestBody } from '../connectors/github/index.js';
import type { BranchRef, DeliveryRunStateRecord, DeliveryTicket, PullRequestCheckSummary, PullRequestRef, QualityReport, RepositoryConfig } from '../domain/index.js';
import type { LocalGitAdapter } from '../git/index.js';
import type { RunStateStore } from '../state/index.js';
import { recordBranchCreated, recordBranchPushed, recordPullRequestOpened, transitionDeliveryRunState } from '../state/index.js';

export interface DevelopPullRequestHandoffInput {
  readonly state: DeliveryRunStateRecord;
  readonly ticket: DeliveryTicket;
  readonly repository: RepositoryConfig;
  readonly branchName: string;
  readonly git: LocalGitAdapter;
  readonly github: GitHubConnector;
  readonly operationLedger?: OperationLedger | undefined;
  readonly operationLedgerRootPath?: string | undefined;
  readonly stateStore: RunStateStore;
  readonly now?: () => Date;
}

export async function runDevelopPullRequestHandoff(input: DevelopPullRequestHandoffInput): Promise<DeliveryRunStateRecord> {
  const now = input.now ?? (() => new Date());
  const operationLedger = resolveOperationLedger(input);
  const branch = await input.git.createBranch({
    repository: input.repository.ref,
    localPath: input.repository.localPath,
    branchName: input.branchName,
    baseBranch: input.repository.branchPolicy.stagingTarget
  });
  const branchCreatedState = recordBranchCreated(input.state, branch, now().toISOString());

  await input.stateStore.write(branchCreatedState);
  assertReadyForDevelopPullRequest(input.state);

  const latestQualityReport = requireLatestPassedRequiredQualityReport(input.state);
  const codeHostBranch = await createCodeHostBranch({ state: branchCreatedState, input, operationLedger, now, branch });
  const pushedBranch = await pushLocalBranch({ state: branchCreatedState, input, operationLedger, now, branch: codeHostBranch });
  const pushedState = recordBranchPushed(branchCreatedState, pushedBranch, now().toISOString());

  await input.stateStore.write(pushedState);

  const pullRequest = await openDevelopPullRequest({
    state: pushedState,
    input,
    operationLedger,
    now,
    branch: pushedBranch,
    qualityReport: latestQualityReport
  });
  const pullRequestState = recordPullRequestOpened(pushedState, pullRequest, now().toISOString());

  await input.stateStore.write(pullRequestState);

  await commentOnDevelopPullRequest({
    state: pullRequestState,
    input,
    operationLedger,
    now,
    pullRequest,
    qualityReport: latestQualityReport
  });

  const checks = await readDevelopChecks({ state: pullRequestState, input, operationLedger, now, branch: pushedBranch });

  if (checks.status !== 'passed') {
    return pullRequestState;
  }

  const checksPassedState = transitionDeliveryRunState(pullRequestState, 'DEVELOP_CHECKS_PASSED', now().toISOString());
  await input.stateStore.write(checksPassedState);
  return checksPassedState;
}

function resolveOperationLedger(input: DevelopPullRequestHandoffInput): OperationLedger {
  if (input.operationLedger !== undefined) {
    return input.operationLedger;
  }

  if (input.operationLedgerRootPath !== undefined) {
    return new JsonOperationLedger(input.state.ticket.key, input.state.runId, input.operationLedgerRootPath);
  }

  return new InMemoryOperationLedger();
}

interface WorkflowInput {
  readonly state: DeliveryRunStateRecord;
  readonly input: DevelopPullRequestHandoffInput;
  readonly operationLedger: OperationLedger;
  readonly now: () => Date;
}

async function createCodeHostBranch(input: WorkflowInput & { readonly branch: BranchRef }): Promise<BranchRef> {
  const operationInput = { repository: input.input.repository.ref, branch: input.branch };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'createBranch', operationInput));

  if (existing?.result !== undefined) {
    return existing.result as BranchRef;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'createBranch',
    operationInput,
    run: async () => input.input.github.createBranch(operationInput),
    external: (branch) => ({ externalId: branch.name, result: branch })
  });
}

async function pushLocalBranch(input: WorkflowInput & { readonly branch: BranchRef }): Promise<BranchRef> {
  const operationInput = { repository: input.input.repository.ref, branch: input.branch };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'git', 'LocalGitAdapter', 'pushBranch', operationInput));

  if (existing?.result !== undefined) {
    return existing.result as BranchRef;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'git',
    port: 'LocalGitAdapter',
    action: 'pushBranch',
    operationInput,
    run: async () => input.input.git.pushBranch({
      repository: input.input.repository.ref,
      localPath: input.input.repository.localPath,
      branch: input.branch
    }),
    external: (branch) => ({ externalId: branch.name, result: branch })
  });
}

async function openDevelopPullRequest(input: WorkflowInput & { readonly branch: BranchRef; readonly qualityReport: QualityReport }): Promise<PullRequestRef> {
  const operationInput = {
    repository: input.input.repository.ref,
    title: `${input.input.ticket.ref.key} ${input.input.ticket.summary}`,
    body: buildDevelopPullRequestBody({
      ticket: input.input.ticket,
      analysis: input.state.ticketAnalysis,
      runId: input.state.runId,
      repository: input.input.repository.ref,
      branch: input.branch,
      qualityReport: input.qualityReport
    }),
    sourceBranch: input.branch.name,
    targetBranch: input.input.repository.branchPolicy.stagingTarget
  };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'openPullRequest', operationInput));

  if (existing?.result !== undefined) {
    return existing.result as PullRequestRef;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'openPullRequest',
    operationInput,
    run: async () => input.input.github.openPullRequest(operationInput),
    external: (pullRequest) => ({ externalId: String(pullRequest.number), externalUrl: pullRequest.url, result: pullRequest })
  });
}

async function commentOnDevelopPullRequest(input: WorkflowInput & { readonly pullRequest: PullRequestRef; readonly qualityReport: QualityReport }): Promise<void> {
  const operationInput = {
    pullRequest: input.pullRequest,
    body: buildDevelopPullRequestComment(input.state, input.qualityReport)
  };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'commentOnPullRequest', operationInput));

  if (existing !== undefined) {
    return;
  }

  await runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'commentOnPullRequest',
    operationInput,
    run: async () => {
      await input.input.github.commentOnPullRequest(operationInput);
    },
    external: () => ({ externalId: `${input.pullRequest.repositoryOwner}/${input.pullRequest.repositoryName}#${input.pullRequest.number}` })
  });
}

async function readDevelopChecks(input: WorkflowInput & { readonly branch: BranchRef }): Promise<PullRequestCheckSummary> {
  const operationInput = {
    repository: input.input.repository.ref,
    branchName: input.branch.name
  };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'getChecks', operationInput));

  if (existing?.result !== undefined) {
    return existing.result as PullRequestCheckSummary;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'getChecks',
    operationInput,
    run: async () => input.input.github.getChecks(operationInput),
    external: (checks) => ({ externalId: input.branch.name, result: checks })
  });
}

async function runLedgeredOperation<T>(input: {
  readonly workflow: WorkflowInput;
  readonly provider: string;
  readonly port: string;
  readonly action: string;
  readonly operationInput: unknown;
  readonly run: () => Promise<T>;
  readonly external: (result: T) => { readonly externalId?: string | undefined; readonly externalUrl?: string | undefined; readonly result?: unknown };
}): Promise<T> {
  const started = await input.workflow.operationLedger.startOperation({
    runId: input.workflow.state.runId,
    provider: input.provider,
    port: input.port,
    action: input.action,
    input: input.operationInput,
    startedAt: input.workflow.now().toISOString()
  });

  try {
    const result = await input.run();
    await input.workflow.operationLedger.succeedOperation({
      operationId: started.operationId,
      finishedAt: input.workflow.now().toISOString(),
      ...input.external(result)
    });
    return result;
  } catch (error) {
    await input.workflow.operationLedger.failOperation({
      operationId: started.operationId,
      finishedAt: input.workflow.now().toISOString(),
      errorSummary: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function toOperationLookup(state: DeliveryRunStateRecord, provider: string, port: string, action: string, input: unknown) {
  return {
    runId: state.runId,
    provider,
    port,
    action,
    input
  };
}

function buildDevelopPullRequestComment(state: DeliveryRunStateRecord, qualityReport: QualityReport): string {
  return [
    `Agentic Delivery run ${state.runId} prepared this develop pull request.`,
    `Quality status: ${qualityReport.status.toUpperCase()}.`,
    'Actual branch push used the local git/native fallback; GitHub actions use typed CodeHostPort operations.'
  ].join('\n');
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
