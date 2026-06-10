import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { WorkspaceConfig, WorkspaceRepositoryConfig } from '../config/index.js';
import { MockGitHubConnector, buildDevelopPullRequestBody } from '../connectors/github/index.js';
import { MockJiraConnector } from '../connectors/jira/index.js';
import { MockRailwayConnector } from '../connectors/railway/index.js';
import { MockSmokeUrlVerifier } from '../deployment/index.js';
import type {
  AgentCompletionReport,
  BranchRef,
  CoreSafetyReport,
  DeliveryRunStateRecord,
  DeliveryTicket,
  MeaningfulDiffEvidence,
  QualityReport,
  RepositoryConfig,
  RepositoryRef,
  TestRelevanceReport
} from '../domain/index.js';
import { LocalGitAdapter, buildWorkingBranchName } from '../git/index.js';
import type { GitCommandInput, GitCommandResult } from '../git/index.js';
import { createTicketPlan, toRepositoryRef } from '../planning/index.js';
import { MarkdownReportWriter } from '../reports/index.js';
import { MockOpenCodeRunner } from '../runners/opencode/index.js';
import {
  JsonRunStateStore,
  createDeliveryRunStateRecord,
  getRunDirectoryPath,
  recordBranchCreated,
  transitionDeliveryRunState
} from '../state/index.js';
import { runDevelopPullRequestHandoff } from './develop-pr-handoff.js';
import { runProductionPullRequestPreparation } from './production-pr-preparation.js';
import { runStagingVerification } from './staging-verification.js';

export interface EndToEndMockDeliveryResult {
  readonly state: DeliveryRunStateRecord;
  readonly runId: string;
  readonly runDirectoryPath: string;
  readonly planReportPath: string;
  readonly implementationLogPath?: string;
  readonly qualityReportPath?: string;
  readonly stagingReportPath?: string;
  readonly finalReportPath?: string;
}

export interface RunEndToEndMockDeliveryInput {
  readonly ticketKey: string;
  readonly ticket?: DeliveryTicket | undefined;
  readonly config: WorkspaceConfig;
  readonly rootPath?: string;
  readonly runId?: string;
  readonly now?: () => Date;
}

export async function runEndToEndMockDelivery(input: RunEndToEndMockDeliveryInput): Promise<EndToEndMockDeliveryResult> {
  const rootPath = input.rootPath ?? process.cwd();
  const now = input.now ?? (() => new Date());
  const ticket = input.ticket ?? await new MockJiraConnector(input.config).getTicket(input.ticketKey);
  const plan = createTicketPlan(ticket, input.config);

  if (plan.needsHuman) {
    throw new Error(`Mock run cannot continue because planning needs human input: ${plan.humanReason ?? 'no repository selected'}.`);
  }

  const workspaceRepository = requireWorkspaceRepository(input.config, plan.selectedRepositories[0]);
  const repository = toRepositoryConfig(workspaceRepository, input.config.github.organization, rootPath);
  const runId = input.runId ?? createRunId(ticket.ref.key, now());
  const stateStore = new JsonRunStateStore(rootPath);
  const reportWriter = new MarkdownReportWriter(rootPath);
  const createdAt = now().toISOString();
  const initialState = createDeliveryRunStateRecord({
    runId,
    ticket: ticket.ref,
    targetRepositories: plan.selectedRepositories,
    timestamps: {
      createdAt,
      updatedAt: createdAt
    },
    ticketAnalysis: plan.analysis
  });

  await stateStore.write(initialState);

  const planReportPath = await reportWriter.writePlan(runId, plan);

  if (plan.selectedRepositories.length > 1) {
    const reason = `Planning selected multiple repositories (${plan.selectedRepositories
      .map((repository) => `${repository.owner}/${repository.name}`)
      .join(', ')}). Multi-repo sub-runs are not implemented yet; choose one repository or split the Jira ticket before running.`;
    const needsHumanState: DeliveryRunStateRecord = {
      ...transitionDeliveryRunState(initialState, 'NEEDS_HUMAN', now().toISOString()),
      humanActionNeeded: {
        reason,
        requestedAt: now().toISOString()
      }
    };

    await stateStore.write(needsHumanState);

    return {
      state: needsHumanState,
      runId,
      runDirectoryPath: getRunDirectoryPath(ticket.ref.key, runId),
      planReportPath
    };
  }

  const plannedState = transitionDeliveryRunState(initialState, 'PLANNED', now().toISOString());
  await stateStore.write(plannedState);

  const branchName = buildWorkingBranchName({
    ticketKey: ticket.ref.key,
    summary: ticket.summary,
    prefix: repository.branchPolicy.workingBranchPrefix
  });
  const branch = await new LocalGitAdapter(createMockGitCommandRunner(repository.ref, branchName)).createBranch({
    repository: repository.ref,
    localPath: repository.localPath,
    branchName,
    baseBranch: repository.branchPolicy.stagingTarget
  });
  const branchCreatedState = recordBranchCreated(plannedState, branch, now().toISOString());
  await stateStore.write(branchCreatedState);

  const implementingState = transitionDeliveryRunState(branchCreatedState, 'IMPLEMENTING', now().toISOString());
  await stateStore.write(implementingState);

  const implementationLogPath = join(getRunDirectoryPath(ticket.ref.key, runId), 'implementation-log.md');
  const devRun = await new MockOpenCodeRunner({ now }).run({
    ticketKey: ticket.ref.key,
    runId,
    repository: repository.ref,
    branchName: branch.name,
    baseBranch: branch.baseBranch,
    command: input.config.devRunner.command,
    commandArgs: input.config.devRunner.args,
    workingDirectory: repository.localPath,
    prompt: buildMockImplementationPrompt(ticket, repository, branch),
    implementationLogPath: join(rootPath, implementationLogPath),
    maxAttempts: input.config.devRunner.maxAttempts,
    timeoutMs: input.config.devRunner.timeoutMs,
    environment: process.env,
    environmentAllowlist: input.config.devRunner.envVarNames
  });
  const implementedState: DeliveryRunStateRecord = {
    ...implementingState,
    devRuns: [...implementingState.devRuns, devRun]
  };

  const localChecksRunningState = transitionDeliveryRunState(implementedState, 'LOCAL_CHECKS_RUNNING', now().toISOString());
  await stateStore.write(localChecksRunningState);

  const qualityReport = buildMockQualityReport(ticket.ref.key, runId, repository, now);
  const testRelevance = buildMockTestRelevanceReport(qualityReport);
  const qualityReportWithEvidence: QualityReport = {
    ...qualityReport,
    testRelevance
  };
  await writeMockQualityLogs(rootPath, ticket.ref.key, runId);
  const qualityReportPath = await reportWriter.writeQuality(ticket.ref.key, runId, qualityReportWithEvidence);
  const localChecksPassedState = transitionDeliveryRunState(
    {
      ...localChecksRunningState,
      meaningfulDiff: buildMockMeaningfulDiffEvidence(repository, branch),
      agentCompletion: buildMockAgentCompletionReport(branch),
      coreSafety: buildMockCoreSafetyReport(),
      qualityReports: [...localChecksRunningState.qualityReports, qualityReportWithEvidence],
      testRelevance
    },
    'LOCAL_CHECKS_PASSED',
    now().toISOString()
  );
  await stateStore.write(localChecksPassedState);

  const github = new MockGitHubConnector();
  const mockDeliveryConfig = {
    ...input.config.delivery,
    pullRequests: {
      ...input.config.delivery.pullRequests,
      develop: {
        ...input.config.delivery.pullRequests.develop,
        autoMerge: true
      }
    }
  };
  const checksPassedState = await runDevelopPullRequestHandoff({
    state: localChecksPassedState,
    ticket,
    repository,
    branchName,
    git: new LocalGitAdapter(createMockGitCommandRunner(repository.ref, branchName)),
    github,
    deliveryConfig: mockDeliveryConfig,
    operationLedgerRootPath: rootPath,
    stateStore,
    now
  });
  const pushedBranch = checksPassedState.branches.find((candidate) => candidate.name === branchName) ?? branch;

  const stagingState = await runStagingVerification({
    state: checksPassedState,
    repository,
    branch: repository.branchPolicy.stagingTarget,
    commitSha: pushedBranch.headSha ?? 'mock-head',
    railway: new MockRailwayConnector(),
    smokeVerifier: new MockSmokeUrlVerifier(),
    stateStore,
    reportWriter,
    now
  });
  const stagingReportPath = join(getRunDirectoryPath(ticket.ref.key, runId), 'staging-report.md');
  const productionState = await runProductionPullRequestPreparation({
    state: stagingState,
    ticket,
    repository,
    github,
    stateStore,
    now
  });
  const finalReportPath = await reportWriter.writeFinal(ticket.ref.key, runId, productionState, {
    planReportPath,
    implementationLogPath,
    qualityReportPath,
    stagingReportPath
  });

  return {
    state: productionState,
    runId,
    runDirectoryPath: getRunDirectoryPath(ticket.ref.key, runId),
    planReportPath,
    implementationLogPath,
    qualityReportPath,
    stagingReportPath,
    finalReportPath
  };
}

function requireWorkspaceRepository(config: WorkspaceConfig, repository: RepositoryRef | undefined): WorkspaceRepositoryConfig {
  if (repository === undefined) {
    throw new Error('Mock run requires at least one selected repository.');
  }

  const workspaceRepository = config.repos.find((candidate) => candidate.name === repository.name);

  if (workspaceRepository === undefined) {
    throw new Error(`Selected repository ${repository.name} is not present in workspace config.`);
  }

  return workspaceRepository;
}

function toRepositoryConfig(repository: WorkspaceRepositoryConfig, owner: string | undefined, rootPath: string): RepositoryConfig {
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

function createMockGitCommandRunner(repository: RepositoryRef, branchName: string): (input: GitCommandInput) => Promise<GitCommandResult> {
  const headSha = `mock-${stableSlug(`${repository.owner}-${repository.name}-${branchName}`)}`;

  return async (input) => {
    if (input.args[0] === 'show-ref') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    if (input.args[0] === 'rev-parse') {
      return { stdout: `${headSha}\n`, stderr: '', exitCode: 0 };
    }

    if (input.args.join(' ') === 'diff --cached --name-only') {
      return { stdout: 'src/mock-implementation.ts\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

function buildMockImplementationPrompt(ticket: DeliveryTicket, repository: RepositoryConfig, branch: BranchRef): string {
  return [
    `Mock implementation for ${ticket.ref.key}`,
    `Repository: ${repository.ref.owner}/${repository.ref.name}`,
    `Branch: ${branch.name}`,
    'Complete the requested mock implementation without external provider calls.'
  ].join('\n');
}

function buildMockQualityReport(ticketKey: string, runId: string, repository: RepositoryConfig, now: () => Date): QualityReport {
  const startedAtDate = now();
  const finishedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const finishedAt = finishedAtDate.toISOString();

  return {
    status: 'passed',
    required: [
      {
        name: 'test',
        command: 'mock quality gates',
        workingDirectory: repository.localPath,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
        exitCode: 0,
        stdoutLogPath: join(getRunDirectoryPath(ticketKey, runId), 'quality-logs', 'test.stdout.log'),
        stderrLogPath: join(getRunDirectoryPath(ticketKey, runId), 'quality-logs', 'test.stderr.log'),
        status: 'passed',
        summary: 'Mock local quality gates passed.'
      }
    ],
    optional: []
  };
}

function buildMockMeaningfulDiffEvidence(repository: RepositoryConfig, branch: BranchRef): MeaningfulDiffEvidence {
  const changedFile = 'src/mock-implementation.ts';

  return {
    decision: 'passed',
    reason: 'Mock run produced a local product diff for develop handoff evidence.',
    baselineChangedFiles: [],
    afterAgentChangedFiles: [changedFile],
    newChangedFiles: [changedFile],
    changedFiles: [changedFile],
    productFiles: [changedFile],
    ignoredFiles: [],
    ignoredPathPatterns: [],
    baselineDiffSummary: `No existing mock diff on ${branch.baseBranch}.`,
    afterAgentDiffSummary: `Mock implementation changed ${changedFile} on ${branch.name}.`,
    diffSummary: `${repository.ref.owner}/${repository.ref.name} mock implementation changed product files.`
  };
}

function buildMockAgentCompletionReport(branch: BranchRef): AgentCompletionReport {
  return {
    decision: 'pass',
    reason: `Mock OpenCode run completed on ${branch.name}.`,
    source: 'combined',
    statusSignal: 'completed',
    summaryText: 'Mock implementation completed with local-only evidence.',
    changedFilesMentioned: ['src/mock-implementation.ts'],
    testsMentioned: true,
    knownLimitsMentioned: true,
    blockers: [],
    findings: []
  };
}

function buildMockCoreSafetyReport(): CoreSafetyReport {
  return {
    decision: 'pass',
    reason: 'Mock run changed only allowed local product files.',
    changedFiles: ['src/mock-implementation.ts'],
    changedFileCount: 1,
    addedLineCount: 12,
    limits: {
      maxChangedFiles: 200,
      maxAddedLines: 5000
    },
    forbiddenFiles: [],
    secretFindings: [],
    limitFindings: [],
    humanReviewFindings: []
  };
}

function buildMockTestRelevanceReport(qualityReport: QualityReport): TestRelevanceReport {
  return {
    decision: 'pass',
    reason: 'Mock local quality gate is relevant for the mock product diff.',
    changedFiles: ['src/mock-implementation.ts'],
    testsReported: ['mock quality gates'],
    qualityCommands: qualityReport.required.map((result) => ({
      name: result.name,
      command: result.command ?? result.name,
      requirement: 'required',
      status: result.status,
      relevant: true,
      trivial: false
    })),
    findings: [],
    trivialCommandPatterns: []
  };
}

async function writeMockQualityLogs(rootPath: string, ticketKey: string, runId: string): Promise<void> {
  const logRootPath = join(rootPath, getRunDirectoryPath(ticketKey, runId), 'quality-logs');

  await mkdir(logRootPath, { recursive: true });
  await writeFile(join(logRootPath, 'test.stdout.log'), 'mock quality gates passed\n', 'utf8');
  await writeFile(join(logRootPath, 'test.stderr.log'), '', 'utf8');
}

function createRunId(ticketKey: string, date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  return `${ticketKey}-${timestamp}`;
}

function stableSlug(source: string): string {
  const normalized = source.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  return normalized.length === 0 ? 'branch' : normalized.slice(0, 80);
}
