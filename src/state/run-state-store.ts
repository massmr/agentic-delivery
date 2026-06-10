import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { DevRunResult } from '../domain/dev-runner.js';
import type { DeploymentResult } from '../domain/deployment.js';
import type { DevelopPullRequestFollowUpEvidence, PullRequestRef } from '../domain/pull-request.js';
import type { BranchRef, DevelopHandoffCommit } from '../domain/run.js';
import type { DeliveryRunState, DeliveryRunStateRecord } from '../domain/run.js';
import { getEwokbotRunDirectoryPath, getEwokbotRunStateFilePath } from '../workspace-layout.js';

export interface CreateDeliveryRunStateRecordInput {
  readonly runId: string;
  readonly ticket: DeliveryRunStateRecord['ticket'];
  readonly targetRepositories: DeliveryRunStateRecord['targetRepositories'];
  readonly timestamps: DeliveryRunStateRecord['timestamps'];
  readonly ticketAnalysis?: DeliveryRunStateRecord['ticketAnalysis'];
}

export interface RunStateStore {
  read(ticketKey: string, runId: string): Promise<DeliveryRunStateRecord>;
  write(state: DeliveryRunStateRecord): Promise<void>;
}

export function getRunDirectoryPath(ticketKey: string, runId: string): string {
  return getEwokbotRunDirectoryPath(ticketKey, runId);
}

export function getRunStateFilePath(ticketKey: string, runId: string): string {
  return getEwokbotRunStateFilePath(ticketKey, runId);
}

export function createDeliveryRunStateRecord(input: CreateDeliveryRunStateRecordInput): DeliveryRunStateRecord {
  return {
    runId: input.runId,
    ticket: input.ticket,
    state: 'DISCOVERED',
    targetRepositories: input.targetRepositories,
    branches: [],
    pullRequests: [],
    stagingDeployments: [],
    qualityReports: [],
    devRuns: [],
    timestamps: input.timestamps,
    ...(input.ticketAnalysis === undefined ? {} : { ticketAnalysis: input.ticketAnalysis })
  };
}

export function recordDevRunResult(state: DeliveryRunStateRecord, result: DevRunResult, updatedAt: string): DeliveryRunStateRecord {
  const stateWithResult: DeliveryRunStateRecord = {
    ...state,
    devRuns: [...state.devRuns, result]
  };

  if (result.status === 'passed') {
    return transitionDeliveryRunState(stateWithResult, 'IMPLEMENTING', updatedAt);
  }

  return {
    ...transitionDeliveryRunState(stateWithResult, 'FAILED', updatedAt),
    failure: {
      state: 'IMPLEMENTING',
      reason: summarizeDevRunFailure(result),
      occurredAt: updatedAt
    }
  };
}

export function recordBranchCreated(state: DeliveryRunStateRecord, branch: BranchRef, updatedAt: string): DeliveryRunStateRecord {
  return transitionDeliveryRunState(
    {
      ...state,
      branches: replaceBranch(state.branches, branch)
    },
    'BRANCH_CREATED',
    updatedAt
  );
}

export function recordBranchPushed(state: DeliveryRunStateRecord, branch: BranchRef, updatedAt: string): DeliveryRunStateRecord {
  return transitionDeliveryRunState(
    {
      ...state,
      branches: replaceBranch(state.branches, branch)
    },
    'PUSHED',
    updatedAt
  );
}

export function recordDevelopHandoffCommit(state: DeliveryRunStateRecord, commit: DevelopHandoffCommit, updatedAt: string): DeliveryRunStateRecord {
  const branch = state.branches.find(
    (candidate) =>
      candidate.repository.owner === commit.repository.owner && candidate.repository.name === commit.repository.name && candidate.name === commit.branchName
  );
  const stateWithCommit: DeliveryRunStateRecord = {
    ...state,
    developHandoffCommit: commit,
    branches:
      branch === undefined
        ? state.branches
        : replaceBranch(state.branches, {
            ...branch,
            headSha: commit.commitSha
          })
  };

  return transitionDeliveryRunState(stateWithCommit, state.state, updatedAt);
}

export function recordPullRequestOpened(state: DeliveryRunStateRecord, pullRequest: PullRequestRef, updatedAt: string): DeliveryRunStateRecord {
  return transitionDeliveryRunState(
    {
      ...state,
      pullRequests: replacePullRequest(state.pullRequests, pullRequest)
    },
    'PR_TO_DEVELOP_OPENED',
    updatedAt
  );
}

export function recordDevelopPullRequestFollowUp(
  state: DeliveryRunStateRecord,
  evidence: DevelopPullRequestFollowUpEvidence,
  nextState: DeliveryRunState,
  updatedAt: string
): DeliveryRunStateRecord {
  const stateWithEvidence: DeliveryRunStateRecord = {
    ...state,
    pullRequests: replacePullRequest(state.pullRequests, evidence.pullRequest),
    developPullRequestFollowUp: evidence
  };

  const transitioned = transitionDeliveryRunState(stateWithEvidence, nextState, updatedAt);

  if (nextState === 'FAILED') {
    return {
      ...transitioned,
      failure: {
        state: 'PR_TO_DEVELOP_OPENED',
        reason: evidence.reason,
        occurredAt: updatedAt
      }
    };
  }

  if (nextState === 'NEEDS_HUMAN') {
    return {
      ...transitioned,
      humanActionNeeded: {
        reason: evidence.reason,
        requestedAt: updatedAt
      }
    };
  }

  return transitioned;
}

export function recordProductionPullRequestOpened(
  state: DeliveryRunStateRecord,
  pullRequest: PullRequestRef,
  updatedAt: string
): DeliveryRunStateRecord {
  return transitionDeliveryRunState(
    {
      ...state,
      pullRequests: replacePullRequest(state.pullRequests, pullRequest)
    },
    'PRODUCTION_PR_OPENED',
    updatedAt
  );
}

export function recordStagingDeploying(state: DeliveryRunStateRecord, updatedAt: string): DeliveryRunStateRecord {
  if (state.state !== 'DEVELOP_CHECKS_PASSED') {
    throw new Error(`Staging verification requires DEVELOP_CHECKS_PASSED state; current state is ${state.state}.`);
  }

  return transitionDeliveryRunState(state, 'STAGING_DEPLOYING', updatedAt);
}

export function recordStagingVerified(
  state: DeliveryRunStateRecord,
  deployment: DeploymentResult,
  updatedAt: string
): DeliveryRunStateRecord {
  return transitionDeliveryRunState(
    {
      ...state,
      stagingDeployments: replaceDeployment(state.stagingDeployments, deployment)
    },
    'STAGING_VERIFIED',
    updatedAt
  );
}

export function recordStagingFailed(
  state: DeliveryRunStateRecord,
  deployment: DeploymentResult,
  reason: string,
  updatedAt: string
): DeliveryRunStateRecord {
  return {
    ...transitionDeliveryRunState(
      {
        ...state,
        stagingDeployments: replaceDeployment(state.stagingDeployments, deployment)
      },
      'FAILED',
      updatedAt
    ),
    failure: {
      state: 'STAGING_DEPLOYING',
      reason,
      occurredAt: updatedAt
    }
  };
}

export function canPrepareProductionPullRequest(state: DeliveryRunStateRecord): boolean {
  return state.state === 'STAGING_VERIFIED';
}

export function assertProductionPullRequestReady(state: DeliveryRunStateRecord): void {
  if (!canPrepareProductionPullRequest(state)) {
    throw new Error(`Production pull request preparation requires STAGING_VERIFIED state; current state is ${state.state}.`);
  }
}

function replaceBranch(branches: readonly BranchRef[], branch: BranchRef): readonly BranchRef[] {
  const remainingBranches = branches.filter(
    (candidate) =>
      candidate.repository.owner !== branch.repository.owner || candidate.repository.name !== branch.repository.name || candidate.name !== branch.name
  );

  return [...remainingBranches, branch];
}

function replacePullRequest(pullRequests: readonly PullRequestRef[], pullRequest: PullRequestRef): readonly PullRequestRef[] {
  const remainingPullRequests = pullRequests.filter(
    (candidate) =>
      candidate.repositoryOwner !== pullRequest.repositoryOwner ||
      candidate.repositoryName !== pullRequest.repositoryName ||
      candidate.sourceBranch !== pullRequest.sourceBranch ||
      candidate.targetBranch !== pullRequest.targetBranch
  );

  return [...remainingPullRequests, pullRequest];
}

function replaceDeployment(deployments: readonly DeploymentResult[], deployment: DeploymentResult): readonly DeploymentResult[] {
  const remainingDeployments = deployments.filter(
    (candidate) =>
      candidate.ref.projectId !== deployment.ref.projectId ||
      candidate.ref.serviceId !== deployment.ref.serviceId ||
      candidate.ref.deploymentId !== deployment.ref.deploymentId
  );

  return [...remainingDeployments, deployment];
}

function summarizeDevRunFailure(result: DevRunResult): string {
  const lastAttempt = result.attempts[result.attempts.length - 1];
  const lastSummary = lastAttempt?.summary ?? result.summary;
  const exitCode = lastAttempt?.exitCode ?? 'unknown';

  return `OpenCode implementation ${result.status}; review ${result.implementationLogPath} for details. Last exit code: ${exitCode}. Last attempt: ${lastSummary}`;
}

export function transitionDeliveryRunState(
  state: DeliveryRunStateRecord,
  nextState: DeliveryRunState,
  updatedAt: string
): DeliveryRunStateRecord {
  return {
    ...state,
    state: nextState,
    timestamps: {
      ...state.timestamps,
      updatedAt,
      ...(nextState === 'DONE' || nextState === 'FAILED' || nextState === 'SKIPPED' ? { completedAt: updatedAt } : {})
    }
  };
}

export class JsonRunStateStore implements RunStateStore {
  constructor(private readonly rootPath: string = process.cwd()) {}

  async read(ticketKey: string, runId: string): Promise<DeliveryRunStateRecord> {
    const statePath = join(this.rootPath, getRunStateFilePath(ticketKey, runId));
    const source = await readFile(statePath, 'utf8');
    return JSON.parse(source) as DeliveryRunStateRecord;
  }

  async write(state: DeliveryRunStateRecord): Promise<void> {
    const statePath = join(this.rootPath, getRunStateFilePath(state.ticket.key, state.runId));

    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}
