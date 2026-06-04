import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { WorkspaceConfig, WorkspaceRepositoryConfig } from '../config/index.js';
import type { SmokeUrlVerifier } from '../deployment/index.js';
import { HttpSmokeUrlVerifier } from '../deployment/index.js';
import type { DeliveryRunStateRecord, DeliveryTicket, QualityGateDefinition, QualityReport, RepositoryConfig, RepositoryRef } from '../domain/index.js';
import { LocalGitAdapter, buildWorkingBranchName } from '../git/index.js';
import type { GitCommandRunner } from '../git/index.js';
import { createTicketPlan, toRepositoryRef } from '../planning/index.js';
import { buildQualityGateDefinitions, loadRepositoryQualityConfig } from '../quality/index.js';
import { QualityRunner } from '../quality/index.js';
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
import type { WorkspaceAdapters } from '../providers/index.js';
import { runDevelopPullRequestHandoff } from './develop-pr-handoff.js';
import { runProductionPullRequestPreparation } from './production-pr-preparation.js';
import { runStagingVerification } from './staging-verification.js';

export interface RealProviderSmokeRunResult {
  readonly state: DeliveryRunStateRecord;
  readonly runId: string;
  readonly runDirectoryPath: string;
  readonly planReportPath: string;
  readonly implementationLogPath?: string | undefined;
  readonly qualityReportPath?: string | undefined;
  readonly stagingReportPath?: string | undefined;
  readonly finalReportPath?: string | undefined;
}

export type SmokeQualityRunner = (input: {
  readonly gates: readonly QualityGateDefinition[];
  readonly logRootPath: string;
}) => Promise<QualityReport>;

export interface RunRealProviderSmokeRunInput {
  readonly ticketKey: string;
  readonly config: WorkspaceConfig;
  readonly adapters: WorkspaceAdapters;
  readonly rootPath?: string | undefined;
  readonly runId?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly smokeVerifier?: SmokeUrlVerifier | undefined;
  readonly qualityRunner?: SmokeQualityRunner | undefined;
  readonly stateStore?: RunStateStore | undefined;
  readonly reportWriter?: MarkdownReportWriter | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export class RealProviderSmokePreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealProviderSmokePreflightError';
  }
}

export async function runRealProviderSmokeRun(input: RunRealProviderSmokeRunInput): Promise<RealProviderSmokeRunResult> {
  const rootPath = input.rootPath ?? process.cwd();
  const now = input.now ?? (() => new Date());
  const stateStore = input.stateStore ?? new JsonRunStateStore(rootPath);
  const reportWriter = input.reportWriter ?? new MarkdownReportWriter(rootPath);
  const ticket = await input.adapters.jira.getTicket(input.ticketKey);
  const plan = createTicketPlan(ticket, input.config);

  assertExactlyOneSelectedRepository(plan.selectedRepositories);

  const selectedRepository = plan.selectedRepositories[0];
  const workspaceRepository = requireWorkspaceRepository(input.config, selectedRepository);
  const repository = toRepositoryConfig(workspaceRepository, input.config.github.organization, rootPath);
  const runId = input.runId ?? createRunId(ticket.ref.key, now());

  await assertSmokeRunDoesNotExist(rootPath, ticket.ref.key, runId);

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

  const branchName = buildWorkingBranchName({
    ticketKey: ticket.ref.key,
    summary: ticket.summary,
    prefix: repository.branchPolicy.workingBranchPrefix
  });
  const git = new LocalGitAdapter(input.gitCommandRunner);
  const branch = await git.createBranch({
    repository: repository.ref,
    localPath: repository.localPath,
    branchName,
    baseBranch: repository.branchPolicy.stagingTarget
  });
  const branchCreatedState = recordBranchCreated(plannedState, branch, now().toISOString());
  await stateStore.write(branchCreatedState);

  const qualityGates = await loadQualityGates(repository.localPath);
  const implementedState = await runOpenCodeImplementation({
    state: branchCreatedState,
    ticket,
    repository: { ...repository, qualityGates },
    branch,
    qualityGates,
    definitionOfDone: buildSmokeDefinitionOfDone(),
    command: input.config.devRunner.command,
    commandArgs: input.config.devRunner.args,
    timeoutMs: input.config.devRunner.timeoutMs,
    environment: input.environment ?? process.env,
    environmentAllowlist: input.config.devRunner.envVarNames,
    abortSignal: input.abortSignal,
    rootPath,
    stateStore,
    runner: input.adapters.devRunner,
    maxAttempts: input.config.devRunner.maxAttempts,
    now
  });

  const implementationLogPath = join(getRunDirectoryPath(ticket.ref.key, runId), 'implementation-log.md');

  if (implementedState.state === 'FAILED') {
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, implementedState, { planReportPath, implementationLogPath });
    return buildResult(implementedState, runId, planReportPath, { implementationLogPath, finalReportPath });
  }

  const localChecksRunningState = transitionDeliveryRunState(implementedState, 'LOCAL_CHECKS_RUNNING', now().toISOString());
  await stateStore.write(localChecksRunningState);

  const qualityReport = await runQuality(input, qualityGates, join(rootPath, getRunDirectoryPath(ticket.ref.key, runId), 'quality-logs'), now);
  const qualityReportPath = await reportWriter.writeQuality(ticket.ref.key, runId, qualityReport);
  const stateWithQuality: DeliveryRunStateRecord = {
    ...localChecksRunningState,
    qualityReports: [...localChecksRunningState.qualityReports, qualityReport]
  };

  if (qualityReport.status !== 'passed') {
    const failedAt = now().toISOString();
    const failedState: DeliveryRunStateRecord = {
      ...transitionDeliveryRunState(stateWithQuality, 'FAILED', failedAt),
      failure: {
        state: 'LOCAL_CHECKS_RUNNING',
        reason: summarizeQualityFailure(qualityReport),
        occurredAt: failedAt
      }
    };

    await stateStore.write(failedState);
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, failedState, { planReportPath, implementationLogPath, qualityReportPath });
    return buildResult(failedState, runId, planReportPath, { implementationLogPath, qualityReportPath, finalReportPath });
  }

  const localChecksPassedState = transitionDeliveryRunState(stateWithQuality, 'LOCAL_CHECKS_PASSED', now().toISOString());
  await stateStore.write(localChecksPassedState);

  const developState = await runDevelopPullRequestHandoff({
    state: localChecksPassedState,
    ticket,
    repository,
    branchName,
    git,
    github: input.adapters.github,
    operationLedgerRootPath: rootPath,
    stateStore,
    now
  });
  const pushedBranch = developState.branches.find((candidate) => candidate.name === branchName) ?? branch;

  const stagingState = await runStagingVerification({
    state: developState,
    repository,
    branch: repository.branchPolicy.stagingTarget,
    commitSha: pushedBranch.headSha ?? branch.headSha ?? 'unknown-head',
    railway: input.adapters.railway,
    smokeVerifier: input.smokeVerifier ?? new HttpSmokeUrlVerifier(),
    stateStore,
    reportWriter,
    now
  });
  const stagingReportPath = join(getRunDirectoryPath(ticket.ref.key, runId), 'staging-report.md');

  if (stagingState.state === 'FAILED') {
    const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, stagingState, { planReportPath, implementationLogPath, qualityReportPath, stagingReportPath });
    return buildResult(stagingState, runId, planReportPath, { implementationLogPath, qualityReportPath, stagingReportPath, finalReportPath });
  }

  const productionState = await runProductionPullRequestPreparation({
    state: stagingState,
    ticket,
    repository,
    github: input.adapters.github,
    stateStore,
    now
  });
  const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, productionState, {
    planReportPath,
    implementationLogPath,
    qualityReportPath,
    stagingReportPath,
    mockOnlyNote: 'Real-provider smoke run completed only through production PR preparation. Production merge and deployment remain human-only.'
  });

  return buildResult(productionState, runId, planReportPath, { implementationLogPath, qualityReportPath, stagingReportPath, finalReportPath });
}

export async function assertSmokeRunDoesNotExist(rootPath: string, ticketKey: string, runId: string): Promise<void> {
  const runDirectoryPath = join(rootPath, getRunDirectoryPath(ticketKey, runId));
  const stateFilePath = join(rootPath, getRunStateFilePath(ticketKey, runId));

  if (await pathExists(stateFilePath) || await pathExists(runDirectoryPath)) {
    throw new RealProviderSmokePreflightError(`Smoke run ${ticketKey}/${runId} already exists. Choose a new --run-id or inspect the existing run before retrying.`);
  }
}

function assertExactlyOneSelectedRepository(repositories: readonly RepositoryRef[]): void {
  if (repositories.length === 1) {
    return;
  }

  if (repositories.length === 0) {
    throw new RealProviderSmokePreflightError('Smoke run requires exactly one selected repository, but the ticket did not match any configured repository. Update repos[].hints or choose a narrower ticket.');
  }

  throw new RealProviderSmokePreflightError(`Smoke run requires exactly one selected repository, but planning selected ${repositories.length}: ${repositories.map((repository) => `${repository.owner}/${repository.name}`).join(', ')}. Split the ticket or adjust repository hints before running smoke.`);
}

function requireWorkspaceRepository(config: WorkspaceConfig, repository: RepositoryRef): WorkspaceRepositoryConfig {
  const workspaceRepository = config.repos.find((candidate) => candidate.name === repository.name);

  if (workspaceRepository === undefined) {
    throw new RealProviderSmokePreflightError(`Selected repository ${repository.owner}/${repository.name} is not present in config/workspace.yml repos.`);
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
  input: RunRealProviderSmokeRunInput,
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
  return failedGate === undefined ? 'Required quality gate failed during smoke run.' : failedGate.summary;
}

function buildSmokeDefinitionOfDone(): readonly string[] {
  return [
    'Implement only the Jira ticket scope in the selected repository.',
    'Keep production merge and production deployment as human-only actions.',
    'Leave clear evidence in local quality, staging, and final reports.'
  ];
}

function buildResult(
  state: DeliveryRunStateRecord,
  runId: string,
  planReportPath: string,
  paths: {
    readonly implementationLogPath?: string | undefined;
    readonly qualityReportPath?: string | undefined;
    readonly stagingReportPath?: string | undefined;
    readonly finalReportPath?: string | undefined;
  }
): RealProviderSmokeRunResult {
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
