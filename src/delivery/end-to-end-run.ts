import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { WorkspaceConfig, WorkspaceRepositoryConfig } from '../config/index.js';
import { MockGitHubConnector, buildDevelopPullRequestBody } from '../connectors/github/index.js';
import { MockJiraConnector } from '../connectors/jira/index.js';
import { MockRailwayConnector } from '../connectors/railway/index.js';
import { MockSmokeUrlVerifier } from '../deployment/index.js';
import type { BranchRef, DeliveryRunStateRecord, DeliveryTicket, QualityReport, RepositoryConfig, RepositoryRef } from '../domain/index.js';
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
  recordBranchPushed,
  recordPullRequestOpened,
  transitionDeliveryRunState
} from '../state/index.js';
import { runProductionPullRequestPreparation } from './production-pr-preparation.js';
import { runStagingVerification } from './staging-verification.js';

export interface EndToEndMockDeliveryResult {
  readonly state: DeliveryRunStateRecord;
  readonly runId: string;
  readonly runDirectoryPath: string;
  readonly planReportPath: string;
  readonly implementationLogPath: string;
  readonly qualityReportPath: string;
  readonly stagingReportPath: string;
  readonly finalReportPath: string;
}

export interface RunEndToEndMockDeliveryInput {
  readonly ticketKey: string;
  readonly config: WorkspaceConfig;
  readonly rootPath?: string;
  readonly runId?: string;
  readonly now?: () => Date;
}

export async function runEndToEndMockDelivery(input: RunEndToEndMockDeliveryInput): Promise<EndToEndMockDeliveryResult> {
  const rootPath = input.rootPath ?? process.cwd();
  const now = input.now ?? (() => new Date());
  const ticket = await new MockJiraConnector(input.config).getTicket(input.ticketKey);
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
    workingDirectory: repository.localPath,
    prompt: buildMockImplementationPrompt(ticket, repository, branch),
    implementationLogPath: join(rootPath, implementationLogPath),
    maxAttempts: input.config.devRunner.maxAttempts
  });
  const implementedState: DeliveryRunStateRecord = {
    ...implementingState,
    devRuns: [...implementingState.devRuns, devRun]
  };

  const localChecksRunningState = transitionDeliveryRunState(implementedState, 'LOCAL_CHECKS_RUNNING', now().toISOString());
  await stateStore.write(localChecksRunningState);

  const qualityReport = buildMockQualityReport(ticket.ref.key, runId, repository, now);
  await writeMockQualityLogs(rootPath, ticket.ref.key, runId);
  const qualityReportPath = await reportWriter.writeQuality(ticket.ref.key, runId, qualityReport);
  const localChecksPassedState = transitionDeliveryRunState(
    {
      ...localChecksRunningState,
      qualityReports: [...localChecksRunningState.qualityReports, qualityReport]
    },
    'LOCAL_CHECKS_PASSED',
    now().toISOString()
  );
  await stateStore.write(localChecksPassedState);

  const github = new MockGitHubConnector();
  await github.createBranch({ repository: repository.ref, branch });
  const pushedBranch = await github.pushBranch({ repository: repository.ref, branch });
  const pushedState = recordBranchPushed(localChecksPassedState, pushedBranch, now().toISOString());
  await stateStore.write(pushedState);

  const developPullRequest = await github.openPullRequest({
    repository: repository.ref,
    title: `${ticket.ref.key} ${ticket.summary}`,
    body: buildDevelopPullRequestBody({
      ticket,
      analysis: pushedState.ticketAnalysis,
      runId,
      repository: repository.ref,
      branch: pushedBranch,
      qualityReport
    }),
    sourceBranch: pushedBranch.name,
    targetBranch: repository.branchPolicy.stagingTarget
  });
  const developPullRequestState = recordPullRequestOpened(pushedState, developPullRequest, now().toISOString());
  await stateStore.write(developPullRequestState);

  const checksPassedState = transitionDeliveryRunState(developPullRequestState, 'DEVELOP_CHECKS_PASSED', now().toISOString());
  await stateStore.write(checksPassedState);

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

function createMockGitCommandRunner(repository: RepositoryRef, branchName: string): (input: GitCommandInput) => Promise<GitCommandResult> {
  const headSha = `mock-${stableSlug(`${repository.owner}-${repository.name}-${branchName}`)}`;

  return async (input) => {
    if (input.args[0] === 'show-ref') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    if (input.args[0] === 'rev-parse') {
      return { stdout: `${headSha}\n`, stderr: '', exitCode: 0 };
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
