import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DeliveryRunState, DeliveryRunStateRecord } from '../domain/index.js';
import { getRunStateFilePath } from '../state/index.js';
import { ewokbotRunsDirectory } from '../workspace-layout.js';

export interface RunStatusLookupOptions {
  readonly rootPath?: string;
  readonly ticketKey: string;
  readonly runId?: string;
}

export interface RunStatusLookupResult {
  readonly state: DeliveryRunStateRecord;
  readonly runIds: readonly string[];
  readonly selectedRunId: string;
}

export async function readRunState(rootPath: string, ticketKey: string, runId: string): Promise<DeliveryRunStateRecord> {
  try {
    const source = await readFile(join(rootPath, getRunStateFilePath(ticketKey, runId)), 'utf8');
    return JSON.parse(source) as DeliveryRunStateRecord;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`No run state found for ${ticketKey} run ${runId}. Expected ${getRunStateFilePath(ticketKey, runId)}.`);
    }

    throw error;
  }
}

export async function listRunIdsForTicket(rootPath: string, ticketKey: string): Promise<readonly string[]> {
  const ticketRunDirectory = join(rootPath, ewokbotRunsDirectory, ticketKey);

  try {
    const entries = await readdir(ticketRunDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export async function findLatestRunState(rootPath: string, ticketKey: string): Promise<RunStatusLookupResult> {
  const runIds = await listRunIdsForTicket(rootPath, ticketKey);

  if (runIds.length === 0) {
    throw new Error(`No runs found for ${ticketKey}. Expected run state under ${ewokbotRunsDirectory}/${ticketKey}/<run-id>/state.json.`);
  }

  const states = await Promise.all(runIds.map(async (runId) => readRunState(rootPath, ticketKey, runId)));
  const latest = [...states].sort(compareRunStateByRecency).at(-1);

  if (latest === undefined) {
    throw new Error(`No readable run states found for ${ticketKey}.`);
  }

  return {
    state: latest,
    runIds,
    selectedRunId: latest.runId
  };
}

export async function loadRunStatus(input: RunStatusLookupOptions): Promise<RunStatusLookupResult> {
  const rootPath = input.rootPath ?? process.cwd();
  const runIds = await listRunIdsForTicket(rootPath, input.ticketKey);

  if (input.runId !== undefined) {
    return {
      state: await readRunState(rootPath, input.ticketKey, input.runId),
      runIds,
      selectedRunId: input.runId
    };
  }

  return findLatestRunState(rootPath, input.ticketKey);
}

export function getNextActionForState(state: DeliveryRunStateRecord): string {
  return nextActionByState[state.state];
}

export function canResumeState(state: DeliveryRunStateRecord): boolean {
  return resumePolicyByState[state.state].resumable;
}

export function assertStateResumable(state: DeliveryRunStateRecord): void {
  const policy = resumePolicyByState[state.state];

  if (!policy.resumable) {
    throw new Error(`Run ${state.ticket.key}/${state.runId} cannot resume automatically from ${state.state}: ${policy.reason}`);
  }
}

export function renderRunStatus(state: DeliveryRunStateRecord, runIds: readonly string[] = [state.runId]): string {
  const latestQuality = state.qualityReports[state.qualityReports.length - 1];
  const latestDeployment = state.stagingDeployments[state.stagingDeployments.length - 1];

  return [
    `# Run Status ${state.ticket.key}`,
    '',
    `- Run ID: ${state.runId}`,
    `- Available Runs: ${runIds.length === 0 ? 'none' : runIds.join(', ')}`,
    `- State: ${state.state}`,
    `- Next Action: ${getNextActionForState(state)}`,
    `- Created At: ${state.timestamps.createdAt}`,
    `- Updated At: ${state.timestamps.updatedAt}`,
    `- Completed At: ${state.timestamps.completedAt ?? 'not completed'}`,
    '',
    '## Repositories',
    '',
    state.targetRepositories.length === 0 ? '- None' : state.targetRepositories.map((repository) => `- ${repository.owner}/${repository.name} (${repository.defaultBranch})`).join('\n'),
    '',
    '## Branches',
    '',
    state.branches.length === 0
      ? '- None'
      : state.branches
          .map((branch) => `- ${branch.repository.owner}/${branch.repository.name}: ${branch.name} from ${branch.baseBranch}${branch.headSha === undefined ? '' : ` @ ${branch.headSha}`}`)
          .join('\n'),
    '',
    '## Pull Requests',
    '',
    state.pullRequests.length === 0
      ? '- None'
      : state.pullRequests
          .map(
            (pullRequest) =>
              `- ${pullRequest.repositoryOwner}/${pullRequest.repositoryName} #${pullRequest.number}: ${pullRequest.sourceBranch} -> ${pullRequest.targetBranch} (${pullRequest.status}) ${pullRequest.url}`
          )
          .join('\n'),
    '',
    '## Meaningful Diff',
    '',
    renderMeaningfulDiff(state.meaningfulDiff),
    '',
    '## Agent Completion',
    '',
    renderAgentCompletion(state.agentCompletion),
    '',
    '## Core Safety',
    '',
    renderCoreSafety(state.coreSafety),
    '',
    '## Quality',
    '',
    latestQuality === undefined
      ? '- None'
      : [
          `- Status: ${latestQuality.status.toUpperCase()}`,
          `- Required: ${summarizeQualityGates(latestQuality.required)}`,
          `- Optional: ${summarizeQualityGates(latestQuality.optional)}`
        ].join('\n'),
    '',
    '## Staging',
    '',
    latestDeployment === undefined
      ? '- None'
      : [
          `- Status: ${latestDeployment.status.toUpperCase()}`,
          `- Deployment: ${latestDeployment.ref.deploymentId}`,
          `- Branch: ${latestDeployment.branch}`,
          `- Service URL: ${latestDeployment.serviceUrl}`,
          `- Smoke Checks: ${summarizeSmokeChecks(latestDeployment.smokeChecks)}`
        ].join('\n'),
    '',
    '## Failure',
    '',
    state.failure === undefined ? '- None' : `- ${state.failure.state}: ${state.failure.reason}`,
    '',
    '## Human Action',
    '',
    state.humanActionNeeded === undefined ? '- None' : `- ${state.humanActionNeeded.reason}`,
    ''
  ].join('\n');
}

function compareRunStateByRecency(left: DeliveryRunStateRecord, right: DeliveryRunStateRecord): number {
  const leftUpdatedAt = Date.parse(left.timestamps.updatedAt);
  const rightUpdatedAt = Date.parse(right.timestamps.updatedAt);

  if (leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt - rightUpdatedAt;
  }

  return left.runId.localeCompare(right.runId);
}

function summarizeQualityGates(gates: DeliveryRunStateRecord['qualityReports'][number]['required']): string {
  if (gates.length === 0) {
    return 'none';
  }

  return gates.map((gate) => `${gate.name} ${gate.status.toUpperCase()}`).join(', ');
}

function summarizeSmokeChecks(smokeChecks: NonNullable<DeliveryRunStateRecord['stagingDeployments'][number]>['smokeChecks']): string {
  if (smokeChecks.length === 0) {
    return 'none';
  }

  return smokeChecks.map((check) => `${check.url} ${check.status.toUpperCase()}`).join(', ');
}

function renderMeaningfulDiff(evidence: DeliveryRunStateRecord['meaningfulDiff']): string {
  if (evidence === undefined) {
    return '- None';
  }

  return [
    `- Decision: ${evidence.decision.toUpperCase()}`,
    `- Reason: ${evidence.reason}`,
    `- Baseline Changed Files: ${summarizeFiles(evidence.baselineChangedFiles)}`,
    `- After-Agent Changed Files: ${summarizeFiles(evidence.afterAgentChangedFiles)}`,
    `- Agent-New Changed Files: ${summarizeFiles(evidence.newChangedFiles)}`,
    `- Agent Product Changed Files: ${summarizeFiles(evidence.productFiles)}`,
    `- Agent Ignored Files: ${summarizeFiles(evidence.ignoredFiles)}`
  ].join('\n');
}

function renderCoreSafety(report: DeliveryRunStateRecord['coreSafety']): string {
  if (report === undefined) {
    return '- None';
  }

  return [
    `- Decision: ${report.decision.toUpperCase()}`,
    `- Reason: ${report.reason}`,
    `- Changed Files: ${summarizeFiles(report.changedFiles)}`,
    `- Added Lines: ${report.addedLineCount}`,
    `- Forbidden Files: ${report.forbiddenFiles.length}`,
    `- Secret-Like Findings: ${report.secretFindings.length}`,
    `- Human Review Findings: ${report.humanReviewFindings.map((finding) => `${finding.category}:${finding.filePath}`).join(', ') || 'none'}`
  ].join('\n');
}

function renderAgentCompletion(report: DeliveryRunStateRecord['agentCompletion']): string {
  if (report === undefined) {
    return '- None';
  }

  return [
    `- Decision: ${report.decision.toUpperCase()}`,
    `- Reason: ${report.reason}`,
    `- Status Signal: ${report.statusSignal.toUpperCase()}`,
    `- Changed Files Mentioned: ${summarizeFiles(report.changedFilesMentioned)}`,
    `- Tests Mentioned: ${report.testsMentioned ? 'yes' : 'no'}`,
    `- Known Limits Mentioned: ${report.knownLimitsMentioned ? 'yes' : 'no'}`,
    `- Blockers: ${report.blockers.length === 0 ? 'none' : report.blockers.join(', ')}`,
    `- Findings: ${report.findings.length === 0 ? 'none' : report.findings.map((finding) => `${finding.kind}:${finding.severity}`).join(', ')}`
  ].join('\n');
}

function summarizeFiles(files: readonly string[]): string {
  return files.length === 0 ? 'none' : files.join(', ');
}

const nextActionByState: Record<DeliveryRunState, string> = {
  DISCOVERED: 'Create a plan for the ticket.',
  PLANNED: 'Create the working branch.',
  BRANCH_CREATED: 'Run the implementation step.',
  IMPLEMENTING: 'Finish implementation and record the dev runner result.',
  LOCAL_CHECKS_RUNNING: 'Finish local quality gates.',
  LOCAL_CHECKS_PASSED: 'Push the branch and open the develop pull request.',
  PUSHED: 'Open the develop pull request.',
  PR_TO_DEVELOP_OPENED: 'Wait for develop pull request checks.',
  DEVELOP_CHECKS_PASSED: 'Verify the staging deployment.',
  STAGING_DEPLOYING: 'Wait for staging deployment and smoke checks.',
  STAGING_VERIFIED: 'Prepare the production pull request for human approval.',
  PRODUCTION_PR_OPENED: 'Wait for human production approval; do not merge automatically.',
  DONE: 'No next action; run is complete.',
  NEEDS_HUMAN: 'Resolve the requested human action before continuing.',
  FAILED: 'Inspect the failure and decide whether to retry manually.',
  SKIPPED: 'No next action; run was skipped.'
};

const resumePolicyByState: Record<DeliveryRunState, { readonly resumable: boolean; readonly reason: string }> = {
  DISCOVERED: {
    resumable: true,
    reason: 'Planning can start from the discovered ticket state.'
  },
  PLANNED: {
    resumable: true,
    reason: 'Branch creation can continue from the persisted plan.'
  },
  BRANCH_CREATED: {
    resumable: true,
    reason: 'Implementation can continue from the persisted branch reference.'
  },
  IMPLEMENTING: {
    resumable: true,
    reason: 'The implementation step can be retried from the persisted branch and prompt context.'
  },
  LOCAL_CHECKS_RUNNING: {
    resumable: true,
    reason: 'Local quality gates can be rerun from the persisted implementation result.'
  },
  LOCAL_CHECKS_PASSED: {
    resumable: true,
    reason: 'Develop PR handoff can continue after persisted local quality success.'
  },
  PUSHED: {
    resumable: true,
    reason: 'Develop PR creation can continue after persisted branch publication.'
  },
  PR_TO_DEVELOP_OPENED: {
    resumable: true,
    reason: 'Develop checks can be inspected from the persisted pull request.'
  },
  DEVELOP_CHECKS_PASSED: {
    resumable: true,
    reason: 'Staging verification can continue after persisted develop check success.'
  },
  STAGING_DEPLOYING: {
    resumable: true,
    reason: 'Staging deployment and smoke verification can be checked again.'
  },
  STAGING_VERIFIED: {
    resumable: true,
    reason: 'Production PR preparation can continue after persisted staging verification.'
  },
  PRODUCTION_PR_OPENED: {
    resumable: false,
    reason: 'production approval is human-only and must not resume automatically.'
  },
  DONE: {
    resumable: false,
    reason: 'the run is already complete.'
  },
  NEEDS_HUMAN: {
    resumable: false,
    reason: 'human input is required before any continuation.'
  },
  FAILED: {
    resumable: false,
    reason: 'the failure must be inspected before any manual retry.'
  },
  SKIPPED: {
    resumable: false,
    reason: 'the run was intentionally skipped.'
  }
};
