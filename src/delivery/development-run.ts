import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { WorkspaceConfig, WorkspaceRepositoryConfig } from '../config/index.js';
import type { DeliveryRunStateRecord, DeliveryTicket, DevRunner, QualityGateDefinition, QualityReport, RepositoryConfig, RepositoryRef } from '../domain/index.js';
import { LocalGitAdapter, buildWorkingBranchName } from '../git/index.js';
import type { GitCommandRunner } from '../git/index.js';
import { createTicketPlan, toRepositoryRef } from '../planning/index.js';
import type { TicketPort } from '../ports/index.js';
import { buildQualityGateDefinitions, loadRepositoryQualityConfig, QualityRunner } from '../quality/index.js';
import { MarkdownReportWriter } from '../reports/index.js';
import { runOpenCodeImplementation } from '../runners/index.js';
import {
  JsonRunStateStore,
  createDeliveryRunStateRecord,
  getRunDirectoryPath,
  getRunStateFilePath,
  recordBranchCreated,
  transitionDeliveryRunState
} from '../state/index.js';
import type { RunStateStore } from '../state/index.js';

export interface DevelopmentRunBoundary {
  readonly ticketKey: string;
  readonly ticketSummary: string;
  readonly repository: RepositoryRef;
  readonly repositoryLocalPath: string;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly qualityGates: readonly QualityGateDefinition[];
  readonly runId: string;
  readonly runDirectoryPath: string;
}

export interface DevelopmentRunResult {
  readonly state: DeliveryRunStateRecord;
  readonly runId: string;
  readonly runDirectoryPath: string;
  readonly planReportPath: string;
  readonly implementationLogPath?: string | undefined;
  readonly qualityReportPath?: string | undefined;
  readonly finalReportPath?: string | undefined;
}

export type DevelopmentQualityRunner = (input: {
  readonly gates: readonly QualityGateDefinition[];
  readonly logRootPath: string;
}) => Promise<QualityReport>;

export interface RunDevelopmentExecutionInput {
  readonly ticketKey: string;
  readonly config: WorkspaceConfig;
  readonly ticketPort: TicketPort;
  readonly devRunner: DevRunner;
  readonly rootPath?: string | undefined;
  readonly runId?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly qualityRunner?: DevelopmentQualityRunner | undefined;
  readonly stateStore?: RunStateStore | undefined;
  readonly reportWriter?: MarkdownReportWriter | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly onBoundaryReady?: ((boundary: DevelopmentRunBoundary) => void) | undefined;
}

export class DevelopmentRunPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevelopmentRunPreflightError';
  }
}

export async function runDevelopmentExecution(input: RunDevelopmentExecutionInput): Promise<DevelopmentRunResult> {
  const rootPath = input.rootPath ?? process.cwd();
  const now = input.now ?? (() => new Date());
  const stateStore = input.stateStore ?? new JsonRunStateStore(rootPath);
  const reportWriter = input.reportWriter ?? new MarkdownReportWriter(rootPath);
  const ticket = await input.ticketPort.getTicket(input.ticketKey);
  const plan = createTicketPlan(ticket, input.config);

  assertExactlyOneSelectedRepository(plan.selectedRepositories);

  const selectedRepository = plan.selectedRepositories[0];
  const workspaceRepository = requireWorkspaceRepository(input.config, selectedRepository);
  const repository = toRepositoryConfig(workspaceRepository, input.config.github.organization, rootPath);
  const runId = input.runId ?? createRunId(ticket.ref.key, now());

  await assertDevelopmentRunDoesNotExist(rootPath, ticket.ref.key, runId);

  const branchName = buildWorkingBranchName({
    ticketKey: ticket.ref.key,
    summary: ticket.summary,
    prefix: repository.branchPolicy.workingBranchPrefix
  });
  const qualityGates = await loadQualityGates(repository.localPath);

  input.onBoundaryReady?.({
    ticketKey: ticket.ref.key,
    ticketSummary: ticket.summary,
    repository: selectedRepository,
    repositoryLocalPath: repository.localPath,
    branchName,
    baseBranch: repository.branchPolicy.stagingTarget,
    qualityGates,
    runId,
    runDirectoryPath: getRunDirectoryPath(ticket.ref.key, runId)
  });

  const createdAt = now().toISOString();
  const initialState = createDeliveryRunStateRecord({
    runId,
    ticket: ticket.ref,
    targetRepositories: [selectedRepository],
    timestamps: {
      createdAt,
      updatedAt: createdAt
    },
    ticketAnalysis: plan.analysis
  });

  await stateStore.write(initialState);

  const planReportPath = await reportWriter.writePlan(runId, plan);
  const plannedState = transitionDeliveryRunState(initialState, 'PLANNED', now().toISOString());
  await stateStore.write(plannedState);

  const git = new LocalGitAdapter(input.gitCommandRunner);
  let stateAfterBranch: DeliveryRunStateRecord;

  try {
    const branch = await git.createBranch({
      repository: repository.ref,
      localPath: repository.localPath,
      branchName,
      baseBranch: repository.branchPolicy.stagingTarget
    });
    stateAfterBranch = recordBranchCreated(plannedState, branch, now().toISOString());
    await stateStore.write(stateAfterBranch);
  } catch (error) {
    const failedState = markFailed(plannedState, 'PLANNED', `Local branch creation failed: ${formatError(error)}`, now().toISOString());
    await stateStore.write(failedState);
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, failedState, { planReportPath, mockOnlyNote: localOnlyNote });
    return buildResult(failedState, runId, planReportPath, { finalReportPath });
  }

  const branch = stateAfterBranch.branches.find((candidate) => candidate.name === branchName);

  if (branch === undefined) {
    const failedState = markFailed(stateAfterBranch, 'BRANCH_CREATED', 'Local branch creation did not return a branch record.', now().toISOString());
    await stateStore.write(failedState);
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, failedState, { planReportPath, mockOnlyNote: localOnlyNote });
    return buildResult(failedState, runId, planReportPath, { finalReportPath });
  }

  const implementedState = await runOpenCodeImplementation({
    state: stateAfterBranch,
    ticket,
    repository: { ...repository, qualityGates },
    branch,
    qualityGates,
    definitionOfDone: buildDevelopmentDefinitionOfDone(),
    command: input.config.devRunner.command,
    commandArgs: input.config.devRunner.args,
    timeoutMs: input.config.devRunner.timeoutMs,
    environment: input.environment ?? process.env,
    environmentAllowlist: input.config.devRunner.envVarNames,
    abortSignal: input.abortSignal,
    rootPath,
    stateStore,
    runner: input.devRunner,
    maxAttempts: input.config.devRunner.maxAttempts,
    now
  });

  const implementationLogPath = join(getRunDirectoryPath(ticket.ref.key, runId), 'implementation-log.md');

  if (implementedState.state === 'FAILED') {
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, implementedState, { planReportPath, implementationLogPath, mockOnlyNote: localOnlyNote });
    return buildResult(implementedState, runId, planReportPath, { implementationLogPath, finalReportPath });
  }

  const localChecksRunningState = transitionDeliveryRunState(implementedState, 'LOCAL_CHECKS_RUNNING', now().toISOString());
  await stateStore.write(localChecksRunningState);

  let qualityReport: QualityReport;

  try {
    qualityReport = await runQuality(input, qualityGates, join(rootPath, getRunDirectoryPath(ticket.ref.key, runId), 'quality-logs'), now);
  } catch (error) {
    const failedState = markFailed(localChecksRunningState, 'LOCAL_CHECKS_RUNNING', `Local quality gates failed to run: ${formatError(error)}`, now().toISOString());
    await stateStore.write(failedState);
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, failedState, { planReportPath, implementationLogPath, mockOnlyNote: localOnlyNote });
    return buildResult(failedState, runId, planReportPath, { implementationLogPath, finalReportPath });
  }

  const qualityReportPath = await reportWriter.writeQuality(ticket.ref.key, runId, qualityReport);
  const stateWithQuality: DeliveryRunStateRecord = {
    ...localChecksRunningState,
    qualityReports: [...localChecksRunningState.qualityReports, qualityReport]
  };

  if (qualityReport.status !== 'passed') {
    const failedState = markFailed(stateWithQuality, 'LOCAL_CHECKS_RUNNING', summarizeQualityFailure(qualityReport), now().toISOString());
    await stateStore.write(failedState);
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, failedState, {
      planReportPath,
      implementationLogPath,
      qualityReportPath,
      mockOnlyNote: localOnlyNote
    });
    return buildResult(failedState, runId, planReportPath, { implementationLogPath, qualityReportPath, finalReportPath });
  }

  const localChecksPassedState = transitionDeliveryRunState(stateWithQuality, 'LOCAL_CHECKS_PASSED', now().toISOString());
  await stateStore.write(localChecksPassedState);
  const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, localChecksPassedState, {
    planReportPath,
    implementationLogPath,
    qualityReportPath,
    mockOnlyNote: localOnlyNote
  });

  return buildResult(localChecksPassedState, runId, planReportPath, { implementationLogPath, qualityReportPath, finalReportPath });
}

export async function assertDevelopmentRunDoesNotExist(rootPath: string, ticketKey: string, runId: string): Promise<void> {
  const runDirectoryPath = join(rootPath, getRunDirectoryPath(ticketKey, runId));
  const stateFilePath = join(rootPath, getRunStateFilePath(ticketKey, runId));

  if (await pathExists(stateFilePath) || await pathExists(runDirectoryPath)) {
    throw new DevelopmentRunPreflightError(`Development run ${ticketKey}/${runId} already exists. Choose a new --run-id or inspect the existing run before retrying.`);
  }
}

function assertExactlyOneSelectedRepository(repositories: readonly RepositoryRef[]): void {
  if (repositories.length === 1) {
    return;
  }

  if (repositories.length === 0) {
    throw new DevelopmentRunPreflightError('Development execution requires exactly one selected repository, but the ticket did not match any configured repository. Update repos[].hints or choose a narrower ticket.');
  }

  throw new DevelopmentRunPreflightError(`Development execution requires exactly one selected repository, but planning selected ${repositories.length}: ${repositories.map((repository) => `${repository.owner}/${repository.name}`).join(', ')}. Split the ticket or adjust repository hints before running run-dev.`);
}

function requireWorkspaceRepository(config: WorkspaceConfig, repository: RepositoryRef): WorkspaceRepositoryConfig {
  const workspaceRepository = config.repos.find((candidate) => candidate.name === repository.name);

  if (workspaceRepository === undefined) {
    throw new DevelopmentRunPreflightError(`Selected repository ${repository.owner}/${repository.name} is not present in .ewokbot/workspace.yml repos.`);
  }

  return workspaceRepository;
}

function toRepositoryConfig(repository: WorkspaceRepositoryConfig, owner: string, rootPath: string): RepositoryConfig {
  return {
    ref: toRepositoryRef(repository, owner),
    role: 'application',
    localPath: resolve(rootPath, repository.localPath),
    branchPolicy: {
      workingBranchPrefix: 'agent',
      stagingTarget: 'develop',
      productionTarget: 'main'
    },
    qualityGates: [],
    stagingSmokeUrls: repository.stagingSmokeUrls
  };
}

async function loadQualityGates(repositoryPath: string): Promise<readonly QualityGateDefinition[]> {
  const qualityConfig = await loadRepositoryQualityConfig(repositoryPath);
  return buildQualityGateDefinitions(qualityConfig, repositoryPath);
}

async function runQuality(
  input: RunDevelopmentExecutionInput,
  gates: readonly QualityGateDefinition[],
  logRootPath: string,
  now: () => Date
): Promise<QualityReport> {
  if (input.qualityRunner !== undefined) {
    return input.qualityRunner({ gates, logRootPath });
  }

  return new QualityRunner({ logRootPath, now }).run(gates);
}

function summarizeQualityFailure(report: QualityReport): string {
  const failedGate = report.required.find((result) => result.status === 'failed');
  return failedGate === undefined ? 'Required local quality gate failed during development execution.' : failedGate.summary;
}

function buildDevelopmentDefinitionOfDone(): readonly string[] {
  return [
    'Implement only the Jira ticket scope in the selected repository.',
    'Keep all evidence local under .ewokbot/runs/.',
    'Stop after local OpenCode execution and local quality gates; do not push, open PRs, verify deployments, merge, or deploy production.'
  ];
}

function markFailed(state: DeliveryRunStateRecord, failedFromState: DeliveryRunStateRecord['state'], reason: string, occurredAt: string): DeliveryRunStateRecord {
  return {
    ...transitionDeliveryRunState(state, 'FAILED', occurredAt),
    failure: {
      state: failedFromState,
      reason,
      occurredAt
    }
  };
}

function buildResult(
  state: DeliveryRunStateRecord,
  runId: string,
  planReportPath: string,
  paths: {
    readonly implementationLogPath?: string | undefined;
    readonly qualityReportPath?: string | undefined;
    readonly finalReportPath?: string | undefined;
  }
): DevelopmentRunResult {
  return {
    state,
    runId,
    runDirectoryPath: getRunDirectoryPath(state.ticket.key, runId),
    planReportPath,
    ...paths
  };
}

function createRunId(ticketKey: string, date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  return `${ticketKey}-${timestamp}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const localOnlyNote = 'Development execution stopped after local OpenCode implementation and local quality gates. Ewokbot did not push git branches, open GitHub pull requests, call Railway/Vercel, verify deployments, merge production, or deploy production.';
