import type { OperationLedger } from '../agent/index.js';
import { InMemoryOperationLedger, JsonOperationLedger } from '../agent/index.js';
import type { GitHubConnector } from '../connectors/github/index.js';
import { buildDevelopPullRequestBody } from '../connectors/github/index.js';
import type { BranchRef, DeliveryRunStateRecord, DeliveryTicket, DevelopHandoffCommit, PullRequestCheckSummary, PullRequestRef, QualityReport, RepositoryConfig } from '../domain/index.js';
import type { LocalGitAdapter } from '../git/index.js';
import type { RuntimeProviderFactoryOptions } from '../providers/index.js';
import { createRuntimeCodeHostPort } from '../providers/index.js';
import type { RunStateStore } from '../state/index.js';
import { recordBranchCreated, recordBranchPushed, recordDevelopHandoffCommit, recordPullRequestOpened, transitionDeliveryRunState } from '../state/index.js';
import { redactSensitiveText } from '../runners/opencode/redaction.js';

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

export interface RuntimeDevelopPullRequestHandoffInput extends Omit<DevelopPullRequestHandoffInput, 'github'> {
  readonly runtimeProviders: RuntimeProviderFactoryOptions;
}

export async function runRuntimeDevelopPullRequestHandoff(input: RuntimeDevelopPullRequestHandoffInput): Promise<DeliveryRunStateRecord> {
  assertReadyForDevelopPullRequestHandoff(input.state);
  const github = await createRuntimeCodeHostPort({
    ...input.runtimeProviders,
    requiredGitHubMcpActions: ['openPullRequest']
  });

  return runDevelopPullRequestHandoff({
    ...input,
    github
  });
}

export async function runDevelopPullRequestHandoff(input: DevelopPullRequestHandoffInput): Promise<DeliveryRunStateRecord> {
  const now = input.now ?? (() => new Date());
  const operationLedger = resolveOperationLedger(input);
  const latestQualityReport = requireReadyForDevelopPullRequest(input.state);
  const branch = await input.git.createBranch({
    repository: input.repository.ref,
    localPath: input.repository.localPath,
    branchName: input.branchName,
    baseBranch: input.repository.branchPolicy.stagingTarget
  });
  const branchCreatedState = recordBranchCreated(input.state, branch, now().toISOString());

  await input.stateStore.write(branchCreatedState);
  const codeHostBranch = await createCodeHostBranch({ state: branchCreatedState, input, operationLedger, now, branch });
  const handoffCommit = await commitScopedAgentDiff({ state: branchCreatedState, input, operationLedger, now, branch: codeHostBranch });
  const committedState = recordDevelopHandoffCommit(branchCreatedState, handoffCommit, now().toISOString());
  const committedBranch = {
    ...codeHostBranch,
    headSha: handoffCommit.commitSha
  };

  await input.stateStore.write(committedState);

  const pushedBranch = await pushLocalBranch({ state: committedState, input, operationLedger, now, branch: committedBranch });
  const pushedState = recordBranchPushed(committedState, pushedBranch, now().toISOString());

  await input.stateStore.write(pushedState);

  const pullRequest = await openDevelopPullRequest({
    state: pushedState,
    input,
    operationLedger,
    now,
    branch: pushedBranch,
    handoffCommit,
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

async function commitScopedAgentDiff(input: WorkflowInput & { readonly branch: BranchRef }): Promise<DevelopHandoffCommit> {
  const files = getScopedAgentProductFiles(input.state);
  const message = buildScopedAgentDiffCommitMessage(input.input.ticket);
  const operationInput = {
    repository: input.input.repository.ref,
    branchName: input.branch.name,
    files,
    message
  };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'git', 'LocalGitAdapter', 'commitScopedAgentDiff', operationInput));

  if (existing?.result !== undefined) {
    const commit = existing.result as DevelopHandoffCommit;
    const headSha = await input.input.git.getHeadSha(input.input.repository.localPath);

    if (headSha !== commit.commitSha) {
      throw new Error(`Recorded scoped agent diff commit ${commit.commitSha} is not the current local HEAD (${headSha}). Reset or restore the agent branch before reusing the develop PR handoff ledger.`);
    }

    return commit;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'git',
    port: 'LocalGitAdapter',
    action: 'commitScopedAgentDiff',
    operationInput,
    run: async () => input.input.git.commitScopedAgentDiff({
      repository: input.input.repository.ref,
      localPath: input.input.repository.localPath,
      branch: input.branch,
      files,
      message
    }),
    external: (commit) => ({ externalId: commit.commitSha, result: commit })
  });
}

async function openDevelopPullRequest(input: WorkflowInput & { readonly branch: BranchRef; readonly handoffCommit: DevelopHandoffCommit; readonly qualityReport: QualityReport }): Promise<PullRequestRef> {
  const operationInput = {
    repository: input.input.repository.ref,
    title: `${input.input.ticket.ref.key} ${input.input.ticket.summary}`,
    body: buildDevelopPullRequestBody({
      ticket: input.input.ticket,
      analysis: input.state.ticketAnalysis,
      runId: input.state.runId,
      repository: input.input.repository.ref,
      branch: input.branch,
      handoffCommit: input.handoffCommit,
      qualityReport: input.qualityReport,
      meaningfulDiff: input.state.meaningfulDiff,
      coreSafety: input.state.coreSafety,
      testRelevance: input.state.testRelevance
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
    `Ewokbot run ${state.runId} prepared this develop pull request.`,
    `Quality status: ${qualityReport.status.toUpperCase()}.`,
    `Scoped agent diff commit: ${state.developHandoffCommit?.commitSha ?? 'not recorded'}.`,
    'Actual branch push used the local git/native fallback; GitHub actions use typed CodeHostPort operations.'
  ].join('\n');
}

function getScopedAgentProductFiles(state: DeliveryRunStateRecord): readonly string[] {
  const files = state.meaningfulDiff?.productFiles ?? [];

  if (files.length === 0) {
    throw new Error('Develop PR handoff requires scoped agent product files before commit, push, or PR creation.');
  }

  return [...new Set(files)].sort();
}

function buildScopedAgentDiffCommitMessage(ticket: DeliveryTicket): string {
  const summary = redactSensitiveText(ticket.summary).replace(/\s+/gu, ' ').trim();
  const suffix = summary.length === 0 ? 'Commit scoped agent diff' : summary;

  return `${ticket.ref.key}: ${suffix}`;
}

export function assertReadyForDevelopPullRequestHandoff(state: DeliveryRunStateRecord): void {
  requireReadyForDevelopPullRequest(state);
}

function requireReadyForDevelopPullRequest(state: DeliveryRunStateRecord): QualityReport {
  if (state.state !== 'LOCAL_CHECKS_PASSED') {
    throw new Error(`Develop PR handoff requires LOCAL_CHECKS_PASSED state; current state is ${state.state}.`);
  }

  if (state.meaningfulDiff?.decision !== 'passed') {
    throw new Error('Develop PR handoff requires meaningful diff evidence to pass before branch, push, or PR creation.');
  }

  if (state.agentCompletion?.decision !== 'pass') {
    throw new Error('Develop PR handoff requires agent completion evidence to pass before branch, push, or PR creation.');
  }

  if (state.coreSafety?.decision !== 'pass') {
    throw new Error('Develop PR handoff requires core safety evidence to pass before branch, push, or PR creation.');
  }

  if (state.testRelevance?.decision !== 'pass') {
    throw new Error('Develop PR handoff requires test relevance evidence to pass before branch, push, or PR creation.');
  }

  return requireLatestPassedRequiredQualityReport(state);
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
