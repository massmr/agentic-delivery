import type { OperationLedger } from '../agent/index.js';
import { InMemoryOperationLedger, JsonOperationLedger } from '../agent/index.js';
import type { DeliveryConfig } from '../config/index.js';
import { getDefaultDeliveryConfig } from '../config/index.js';
import type { GitHubConnector } from '../connectors/github/index.js';
import { buildDevelopPullRequestBody } from '../connectors/github/index.js';
import type { BranchRef, DeliveryRunStateRecord, DeliveryTicket, DevelopHandoffCommit, DevelopPullRequestFollowUpEvidence, PullRequestCheckSummary, PullRequestMergeResult, PullRequestRef, QualityReport, RepositoryConfig } from '../domain/index.js';
import type { LocalGitAdapter } from '../git/index.js';
import type { RuntimeGitHubMcpAction, RuntimeProviderFactoryOptions } from '../providers/index.js';
import { createRuntimeCodeHostPort } from '../providers/index.js';
import type { RunStateStore } from '../state/index.js';
import { recordBranchCreated, recordBranchPushed, recordDevelopHandoffCommit, recordDevelopPullRequestFollowUp, recordPullRequestOpened } from '../state/index.js';
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
  readonly deliveryConfig?: DeliveryConfig | undefined;
  readonly now?: () => Date;
}

export interface RuntimeDevelopPullRequestHandoffInput extends Omit<DevelopPullRequestHandoffInput, 'github'> {
  readonly runtimeProviders: RuntimeProviderFactoryOptions;
}

export interface DevelopPullRequestFollowUpInput {
  readonly state: DeliveryRunStateRecord;
  readonly repository: RepositoryConfig;
  readonly github: GitHubConnector;
  readonly operationLedger?: OperationLedger | undefined;
  readonly operationLedgerRootPath?: string | undefined;
  readonly stateStore: RunStateStore;
  readonly deliveryConfig?: DeliveryConfig | undefined;
  readonly now?: () => Date;
}

export interface RuntimeDevelopPullRequestFollowUpInput extends Omit<DevelopPullRequestFollowUpInput, 'github'> {
  readonly runtimeProviders: RuntimeProviderFactoryOptions;
}

interface DevelopPullRequestWorkflowInput {
  readonly state: DeliveryRunStateRecord;
  readonly repository: RepositoryConfig;
  readonly github: GitHubConnector;
  readonly operationLedger?: OperationLedger | undefined;
  readonly operationLedgerRootPath?: string | undefined;
  readonly stateStore: RunStateStore;
  readonly deliveryConfig?: DeliveryConfig | undefined;
  readonly now?: () => Date;
}

export async function runRuntimeDevelopPullRequestHandoff(input: RuntimeDevelopPullRequestHandoffInput): Promise<DeliveryRunStateRecord> {
  assertReadyForDevelopPullRequestHandoff(input.state);
  const requiredGitHubMcpActions: RuntimeGitHubMcpAction[] = ['createBranch', 'openPullRequest', 'commentOnPullRequest', 'readPullRequest', 'getChecks'];
  const github = await createRuntimeCodeHostPort({
    ...input.runtimeProviders,
    requiredGitHubMcpActions: runtimeFollowUpActions(input.runtimeProviders.config.delivery, requiredGitHubMcpActions)
  });

  return runDevelopPullRequestHandoff({
    ...input,
    github,
    deliveryConfig: input.runtimeProviders.config.delivery
  });
}

export async function runRuntimeDevelopPullRequestFollowUp(input: RuntimeDevelopPullRequestFollowUpInput): Promise<DeliveryRunStateRecord> {
  assertReadyForDevelopPullRequestFollowUp(input.state);
  const github = await createRuntimeCodeHostPort({
    ...input.runtimeProviders,
    requiredGitHubMcpActions: runtimeFollowUpActions(input.runtimeProviders.config.delivery, ['readPullRequest', 'getChecks'])
  });

  return runDevelopPullRequestFollowUp({
    ...input,
    github,
    deliveryConfig: input.runtimeProviders.config.delivery
  });
}

export async function runDevelopPullRequestFollowUp(input: DevelopPullRequestFollowUpInput): Promise<DeliveryRunStateRecord> {
  assertReadyForDevelopPullRequestFollowUp(input.state);
  const now = input.now ?? (() => new Date());
  const operationLedger = resolveOperationLedger(input);
  const pullRequest = requireDevelopPullRequestForFollowUp(input.state, input.repository);
  const branch = requireBranchForPullRequest(input.state, input.repository, pullRequest);
  const followUpState = await followDevelopPullRequest({
    state: input.state,
    input,
    operationLedger,
    now,
    branch,
    pullRequest,
    freshReadOperations: true
  });

  await input.stateStore.write(followUpState);
  return followUpState;
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
    qualityReport: latestQualityReport,
    draft: determineDevelopPullRequestDraftState(input.deliveryConfig ?? getDefaultDeliveryConfig())
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

  const followUpState = await followDevelopPullRequest({
    state: pullRequestState,
    input,
    operationLedger,
    now,
    branch: pushedBranch,
    pullRequest
  });

  await input.stateStore.write(followUpState);
  return followUpState;
}

function runtimeFollowUpActions(deliveryConfig: DeliveryConfig, baseActions: readonly RuntimeGitHubMcpAction[]): readonly RuntimeGitHubMcpAction[] {
  if (!deliveryConfig.pullRequests.develop.autoMerge) {
    return baseActions;
  }

  return [...baseActions, 'mergePullRequest'];
}

function resolveOperationLedger(input: DevelopPullRequestWorkflowInput): OperationLedger {
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
  readonly input: DevelopPullRequestWorkflowInput;
  readonly operationLedger: OperationLedger;
  readonly now: () => Date;
  readonly freshReadOperations?: boolean | undefined;
}

async function createCodeHostBranch(input: WorkflowInput & { readonly input: DevelopPullRequestHandoffInput; readonly branch: BranchRef }): Promise<BranchRef> {
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

async function pushLocalBranch(input: WorkflowInput & { readonly input: DevelopPullRequestHandoffInput; readonly branch: BranchRef }): Promise<BranchRef> {
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

async function commitScopedAgentDiff(input: WorkflowInput & { readonly input: DevelopPullRequestHandoffInput; readonly branch: BranchRef }): Promise<DevelopHandoffCommit> {
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

async function openDevelopPullRequest(input: WorkflowInput & { readonly input: DevelopPullRequestHandoffInput; readonly branch: BranchRef; readonly handoffCommit: DevelopHandoffCommit; readonly qualityReport: QualityReport; readonly draft: boolean }): Promise<PullRequestRef> {
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
    targetBranch: input.input.repository.branchPolicy.stagingTarget,
    draft: input.draft
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

function determineDevelopPullRequestDraftState(deliveryConfig: DeliveryConfig): boolean {
  const develop = deliveryConfig.pullRequests.develop;
  const noRemoteChecks = deliveryConfig.checks.noRemoteChecks;

  if (develop.draftMode === 'always') {
    return true;
  }

  if (develop.draftMode === 'never') {
    return false;
  }

  if (develop.requireHumanApproval) {
    return true;
  }

  if (noRemoteChecks === 'needs_human' || noRemoteChecks === 'fail') {
    return true;
  }

  if (develop.autoMerge && develop.requireChecks === 'pass_or_absent' && noRemoteChecks === 'pass') {
    return false;
  }

  return true;
}

async function commentOnDevelopPullRequest(input: WorkflowInput & { readonly input: DevelopPullRequestHandoffInput; readonly pullRequest: PullRequestRef; readonly qualityReport: QualityReport }): Promise<void> {
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

async function readDevelopChecks(input: WorkflowInput & { readonly branch: BranchRef; readonly pullRequest: PullRequestRef }): Promise<PullRequestCheckSummary> {
  const operationInput = {
    repository: input.input.repository.ref,
    branchName: input.branch.name,
    pullRequest: input.pullRequest
  };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'getChecks', operationInput));

  if (!input.freshReadOperations && existing?.result !== undefined) {
    return existing.result as PullRequestCheckSummary;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'getChecks',
    operationInput,
    run: async () => input.input.github.getChecks(operationInput),
    external: (checks) => ({ externalId: String(input.pullRequest.number), externalUrl: input.pullRequest.url, result: checks })
  });
}

async function followDevelopPullRequest(input: WorkflowInput & { readonly branch: BranchRef; readonly pullRequest: PullRequestRef }): Promise<DeliveryRunStateRecord> {
  const deliveryConfig = input.input.deliveryConfig ?? getDefaultDeliveryConfig();
  const developPolicy = deliveryConfig.pullRequests.develop;
  const observedPullRequest = await readDevelopPullRequest(input);
  const checks = await readDevelopChecks({ ...input, pullRequest: observedPullRequest });
  const observedAt = input.now().toISOString();

  if (observedPullRequest.status === 'closed') {
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: 'stopped',
      reason: 'Develop pull request was closed without merge; monitoring stopped before staging verification.',
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: developPolicy.autoMerge,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, 'SKIPPED', observedAt);
  }

  if (observedPullRequest.status === 'merged') {
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: 'ready_for_staging',
      reason: 'Develop pull request is already merged; staging verification may continue.',
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: developPolicy.autoMerge,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, 'DEVELOP_CHECKS_PASSED', observedAt);
  }

  if (observedPullRequest.status === 'draft') {
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: 'needs_human',
      reason: 'Develop pull request is still a draft; staging is blocked until a human marks it ready for review or merges develop.',
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: developPolicy.autoMerge,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, 'NEEDS_HUMAN', observedAt);
  }

  if (checks.totalCount === 0) {
    return recordNoRemoteChecksDecision(input, observedPullRequest, checks, deliveryConfig, observedAt);
  }

  if (checks.status === 'failed' || checks.status === 'cancelled') {
    const nextState = developPolicy.requireHumanApproval ? 'NEEDS_HUMAN' : 'FAILED';
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: nextState === 'FAILED' ? 'fail' : 'needs_human',
      reason: developPolicy.requireHumanApproval
        ? `Develop pull request checks are ${checks.status}; require_human_approval keeps staging blocked for human review.`
        : `Develop pull request checks are ${checks.status}; require_checks=${developPolicy.requireChecks} blocks staging verification.`,
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: developPolicy.autoMerge,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, nextState, observedAt);
  }

  if (checks.status === 'pending') {
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: 'wait',
      reason: 'Develop pull request checks are still pending; staging verification is waiting.',
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: developPolicy.autoMerge,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, 'PR_TO_DEVELOP_OPENED', observedAt);
  }

  if (developPolicy.requireHumanApproval) {
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: 'needs_human',
      reason: 'Develop pull request checks passed, but require_human_approval=true keeps staging blocked until a human merges develop.',
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: developPolicy.autoMerge,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, 'NEEDS_HUMAN', observedAt);
  }

  if (!developPolicy.autoMerge) {
    return recordFollowUp(input, {
      pullRequest: observedPullRequest,
      checks,
      decision: 'wait',
      reason: 'Develop pull request checks passed; waiting for a human to merge develop because develop auto_merge is disabled.',
      noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
      autoMerge: false,
      mergeMethod: developPolicy.mergeMethod,
      observedAt
    }, 'PR_TO_DEVELOP_OPENED', observedAt);
  }

  const mergeResult = await mergeDevelopPullRequest({ ...input, pullRequest: observedPullRequest, method: developPolicy.mergeMethod });
  return recordFollowUp(input, {
    pullRequest: mergeResult.pullRequest,
    checks,
    decision: 'ready_for_staging',
    reason: `Develop pull request checks passed and auto_merge merged the PR with ${developPolicy.mergeMethod}.`,
    noRemoteChecksPolicy: deliveryConfig.checks.noRemoteChecks,
    autoMerge: true,
    mergeMethod: developPolicy.mergeMethod,
    observedAt,
    mergeResult
  }, 'DEVELOP_CHECKS_PASSED', observedAt);
}

async function recordNoRemoteChecksDecision(
  input: WorkflowInput & { readonly branch: BranchRef },
  pullRequest: PullRequestRef,
  checks: PullRequestCheckSummary,
  deliveryConfig: DeliveryConfig,
  observedAt: string
): Promise<DeliveryRunStateRecord> {
  const policy = deliveryConfig.checks.noRemoteChecks;
  const developPolicy = deliveryConfig.pullRequests.develop;

  switch (policy) {
    case 'pass':
      if (developPolicy.requireChecks === 'pass') {
        return recordFollowUp(input, {
          pullRequest,
          checks,
          decision: 'wait',
          reason: 'Develop pull request has no remote checks, but require_checks=pass requires passing remote checks before staging.',
          noRemoteChecksPolicy: policy,
          autoMerge: developPolicy.autoMerge,
          mergeMethod: developPolicy.mergeMethod,
          observedAt
        }, 'PR_TO_DEVELOP_OPENED', observedAt);
      }

      if (developPolicy.requireHumanApproval) {
        return recordFollowUp(input, {
          pullRequest,
          checks,
          decision: 'needs_human',
          reason: 'Develop pull request has no remote checks; no_remote_checks=pass is configured, but require_human_approval=true requires a human merge before staging.',
          noRemoteChecksPolicy: policy,
          autoMerge: developPolicy.autoMerge,
          mergeMethod: developPolicy.mergeMethod,
          observedAt
        }, 'NEEDS_HUMAN', observedAt);
      }

      if (!developPolicy.autoMerge) {
        return recordFollowUp(input, {
          pullRequest,
          checks,
          decision: 'wait',
          reason: 'Develop pull request has no remote checks and no_remote_checks=pass is configured; waiting for a human merge because develop auto_merge is disabled.',
          noRemoteChecksPolicy: policy,
          autoMerge: false,
          mergeMethod: developPolicy.mergeMethod,
          observedAt
        }, 'PR_TO_DEVELOP_OPENED', observedAt);
      }

      const mergeResult = await mergeDevelopPullRequest({ ...input, pullRequest, method: developPolicy.mergeMethod });
      return recordFollowUp(input, {
        pullRequest: mergeResult.pullRequest,
        checks,
        decision: 'ready_for_staging',
        reason: `Develop pull request has no remote checks; explicit no_remote_checks=pass with require_checks=pass_or_absent allowed auto_merge to merge the PR with ${developPolicy.mergeMethod}.`,
        noRemoteChecksPolicy: policy,
        autoMerge: true,
        mergeMethod: developPolicy.mergeMethod,
        observedAt,
        mergeResult
      }, 'DEVELOP_CHECKS_PASSED', observedAt);
    case 'needs_human':
      return recordFollowUp(input, {
        pullRequest,
        checks,
        decision: 'needs_human',
        reason: 'Develop pull request has no remote checks and no_remote_checks=needs_human requires human review before staging.',
        noRemoteChecksPolicy: policy,
        autoMerge: developPolicy.autoMerge,
        mergeMethod: developPolicy.mergeMethod,
        observedAt
      }, 'NEEDS_HUMAN', observedAt);
    case 'fail':
      return recordFollowUp(input, {
        pullRequest,
        checks,
        decision: 'fail',
        reason: 'Develop pull request has no remote checks and no_remote_checks=fail blocks staging.',
        noRemoteChecksPolicy: policy,
        autoMerge: developPolicy.autoMerge,
        mergeMethod: developPolicy.mergeMethod,
        observedAt
      }, 'FAILED', observedAt);
    case 'wait':
      return recordFollowUp(input, {
        pullRequest,
        checks,
        decision: 'wait',
        reason: 'Develop pull request has no remote checks and no_remote_checks=wait keeps monitoring before staging.',
        noRemoteChecksPolicy: policy,
        autoMerge: developPolicy.autoMerge,
        mergeMethod: developPolicy.mergeMethod,
        observedAt
      }, 'PR_TO_DEVELOP_OPENED', observedAt);
  }
}

function recordFollowUp(
  input: WorkflowInput,
  evidence: DevelopPullRequestFollowUpEvidence,
  nextState: DeliveryRunStateRecord['state'],
  updatedAt: string
): DeliveryRunStateRecord {
  return recordDevelopPullRequestFollowUp(input.state, evidence, nextState, updatedAt);
}

async function readDevelopPullRequest(input: WorkflowInput & { readonly pullRequest: PullRequestRef }): Promise<PullRequestRef> {
  const operationInput = { pullRequest: input.pullRequest };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'readPullRequest', operationInput));

  if (!input.freshReadOperations && existing?.result !== undefined) {
    return existing.result as PullRequestRef;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'readPullRequest',
    operationInput,
    run: async () => input.input.github.readPullRequest(operationInput),
    external: (pullRequest) => ({ externalId: String(pullRequest.number), externalUrl: pullRequest.url, result: pullRequest })
  });
}

async function mergeDevelopPullRequest(input: WorkflowInput & { readonly pullRequest: PullRequestRef; readonly method: PullRequestMergeResult['mergeMethod'] }): Promise<PullRequestMergeResult> {
  const stagingTarget = input.input.repository.branchPolicy.stagingTarget;

  if (input.pullRequest.targetBranch !== stagingTarget || input.pullRequest.targetBranch !== 'develop') {
    throw new Error(`Develop auto-merge can only merge develop pull requests targeting ${stagingTarget}; target branch is ${input.pullRequest.targetBranch}.`);
  }

  const operationInput = { pullRequest: input.pullRequest, method: input.method };
  const existing = await input.operationLedger.findCompletedOperation(toOperationLookup(input.state, 'github', 'CodeHostPort', 'mergePullRequest', operationInput));

  if (existing?.result !== undefined) {
    return existing.result as PullRequestMergeResult;
  }

  return runLedgeredOperation({
    workflow: input,
    provider: 'github',
    port: 'CodeHostPort',
    action: 'mergePullRequest',
    operationInput,
    run: async () => input.input.github.mergePullRequest(operationInput),
    external: (result) => ({ externalId: String(result.pullRequest.number), externalUrl: result.pullRequest.url, result })
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

export function assertReadyForDevelopPullRequestFollowUp(state: DeliveryRunStateRecord): void {
  if (state.state !== 'PR_TO_DEVELOP_OPENED') {
    throw new Error(`Develop PR follow-up requires PR_TO_DEVELOP_OPENED state; current state is ${state.state}.`);
  }
}

function requireDevelopPullRequestForFollowUp(state: DeliveryRunStateRecord, repository: RepositoryConfig): PullRequestRef {
  const pullRequest = [...state.pullRequests].reverse().find((candidate) => candidate.provider === 'github'
    && candidate.repositoryOwner === repository.ref.owner
    && candidate.repositoryName === repository.ref.name
    && candidate.targetBranch === repository.branchPolicy.stagingTarget);

  if (pullRequest === undefined) {
    throw new Error('Develop PR follow-up requires a persisted develop pull request before reading checks or merge state.');
  }

  return pullRequest;
}

function requireBranchForPullRequest(state: DeliveryRunStateRecord, repository: RepositoryConfig, pullRequest: PullRequestRef): BranchRef {
  const branch = [...state.branches].reverse().find((candidate) => candidate.repository.owner === repository.ref.owner
    && candidate.repository.name === repository.ref.name
    && candidate.name === pullRequest.sourceBranch);

  if (branch !== undefined) {
    return branch;
  }

  if (state.developHandoffCommit !== undefined) {
    return {
      repository: repository.ref,
      name: pullRequest.sourceBranch,
      baseBranch: repository.branchPolicy.stagingTarget,
      headSha: state.developHandoffCommit.commitSha
    };
  }

  throw new Error('Develop PR follow-up requires a persisted pushed branch or develop handoff commit before reading checks.');
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
