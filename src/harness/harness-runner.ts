import { constants } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { WorkspaceConfig } from '../config/index.js';
import { runDevelopmentExecution } from '../delivery/index.js';
import type { DevelopmentRunResult } from '../delivery/index.js';
import type { DeliveryTicket, DevRunInput, DevRunResult, DevRunner, QualityReport } from '../domain/index.js';
import type { GitCommandInput, GitCommandResult, GitCommandRunner } from '../git/index.js';
import type { TicketPort } from '../ports/index.js';
import { getRunDirectoryPath } from '../state/index.js';

import type { HarnessFixture, HarnessFixtureAgent } from './fixture.js';
import { HarnessFixtureError, loadHarnessFixture } from './fixture.js';

export interface RunHarnessInput {
  readonly fixtureId?: string | undefined;
  readonly all?: boolean | undefined;
  readonly cwd?: string | undefined;
  readonly fixturesRoot?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface HarnessCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly actual: string;
}

export interface HarnessFixtureResult {
  readonly fixtureId: string;
  readonly status: 'passed' | 'failed';
  readonly score: {
    readonly passed: number;
    readonly total: number;
  };
  readonly finalState: string;
  readonly runDirectoryPath: string;
  readonly workspacePath: string;
  readonly checks: readonly HarnessCheckResult[];
}

export interface HarnessRunResult {
  readonly status: 'passed' | 'failed';
  readonly fixturesRoot: string;
  readonly results: readonly HarnessFixtureResult[];
}

export async function runHarness(input: RunHarnessInput): Promise<HarnessRunResult> {
  const cwd = input.cwd ?? process.cwd();
  const fixturesRoot = resolve(cwd, input.fixturesRoot ?? 'fixtures/harness');
  const fixtureIds = input.all === true ? await listHarnessFixtureIds(fixturesRoot) : requireSingleFixtureId(input.fixtureId);
  const results: HarnessFixtureResult[] = [];

  for (const fixtureId of fixtureIds) {
    results.push(await runHarnessFixture({ fixtureId, fixturesRoot, now: input.now }));
  }

  return {
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    fixturesRoot,
    results
  };
}

export async function listHarnessFixtureIds(fixturesRoot: string): Promise<readonly string[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  const fixtureIds: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fixturePath = join(fixturesRoot, entry.name, 'fixture.json');

    if (await pathExists(fixturePath)) {
      fixtureIds.push(entry.name);
    }
  }

  return fixtureIds.sort();
}

async function runHarnessFixture(input: { readonly fixtureId: string; readonly fixturesRoot: string; readonly now?: (() => Date) | undefined }): Promise<HarnessFixtureResult> {
  const fixturePath = join(input.fixturesRoot, input.fixtureId, 'fixture.json');
  const fixture = await loadHarnessFixture(fixturePath);

  if (fixture.id !== input.fixtureId) {
    throw new HarnessFixtureError(`${fixturePath}: fixture id '${fixture.id}' must match directory '${input.fixtureId}'.`);
  }

  const workspacePath = await mkdtemp(join(tmpdir(), `ewokbot-harness-${fixture.id}-`));
  await prepareFixtureWorkspace({ fixture, fixturesRoot: input.fixturesRoot, workspacePath });
  const runId = `${fixture.id}-run`;
  const result = await runDevelopmentExecution({
    ticketKey: fixture.ticket.key,
    config: buildWorkspaceConfig(fixture),
    ticketPort: new FixtureTicketPort(fixture),
    devRunner: new FixtureDevRunner(fixture.agent),
    gitCommandRunner: createFixtureGitRunner(fixture.agent),
    rootPath: workspacePath,
    runId,
    now: input.now ?? fixedHarnessClock,
    environment: {},
    qualityRunner: ({ gates, logRootPath }) => buildFixtureQualityReport({ gates, logRootPath, now: input.now ?? fixedHarnessClock })
  });
  const checks = await scoreFixture({ fixture, result, workspacePath });
  const passed = checks.filter((check) => check.passed).length;

  return {
    fixtureId: fixture.id,
    status: passed === checks.length ? 'passed' : 'failed',
    score: { passed, total: checks.length },
    finalState: result.state.state,
    runDirectoryPath: join(workspacePath, result.runDirectoryPath),
    workspacePath,
    checks
  };
}

function requireSingleFixtureId(fixtureId: string | undefined): readonly string[] {
  if (fixtureId === undefined || fixtureId.trim().length === 0) {
    throw new HarnessFixtureError('Missing fixture id. Pass a fixture id or --all.');
  }

  return [fixtureId];
}

async function prepareFixtureWorkspace(input: { readonly fixture: HarnessFixture; readonly fixturesRoot: string; readonly workspacePath: string }): Promise<void> {
  for (const repository of input.fixture.repositories) {
    await cp(join(input.fixturesRoot, repository.sourcePath), join(input.workspacePath, repository.name), {
      recursive: true,
      errorOnExist: false
    });
  }

  await mkdir(join(input.workspacePath, '.ewokbot'), { recursive: true });
}

function buildWorkspaceConfig(fixture: HarnessFixture): WorkspaceConfig {
  return {
    workspace: {
      name: `Harness ${fixture.id}`,
      autonomy: 'supervised',
      stagingBranch: 'develop',
      productionBranch: 'main',
      maxConcurrentTickets: 1
    },
    jira: {
      mode: 'mock',
      baseUrl: 'https://jira.example.test',
      projectKeys: ['AD'],
      mcpToolNames: {
        listBacklog: 'mockListBacklog',
        getTicket: 'mockGetTicket',
        comment: 'mockComment'
      }
    },
    github: {
      mode: 'mock',
      organization: 'ewokbot-fixtures',
      mcpToolNames: {
        createBranch: 'mockCreateBranch',
        openPullRequest: 'mockOpenPullRequest',
        getChecks: 'mockGetChecks',
        commentOnPullRequest: 'mockCommentOnPullRequest'
      }
    },
    railway: {
      mode: 'mock',
      stagingBranch: 'develop',
      productionBranch: 'main',
      mcpToolNames: {
        waitForDeployment: 'mockWaitForDeployment',
        readDeployment: 'mockReadDeployment',
        getServiceUrl: 'mockGetServiceUrl'
      }
    },
    devRunner: {
      mode: 'mock',
      provider: 'opencode',
      command: 'fixture-opencode',
      args: [],
      timeoutMs: 60_000,
      envVarNames: [],
      maxAttempts: 1
    },
    quality: {
      defaultProfile: 'node'
    },
    mcpServers: [],
    repos: fixture.repositories.map((repository) => ({
      name: repository.name,
      url: `https://github.example.test/ewokbot-fixtures/${repository.name}`,
      localPath: repository.name,
      defaultBranch: 'develop',
      productionBranch: 'main',
      qualityProfile: repository.qualityProfile,
      hints: repository.hints,
      stagingSmokeUrls: []
    }))
  };
}

class FixtureTicketPort implements TicketPort {
  constructor(private readonly fixture: HarnessFixture) {}

  async listBacklog(): Promise<readonly DeliveryTicket[]> {
    return [this.toTicket()];
  }

  async getTicket(key: string): Promise<DeliveryTicket> {
    if (key !== this.fixture.ticket.key) {
      throw new Error(`Fixture ${this.fixture.id} does not define ticket ${key}.`);
    }

    return this.toTicket();
  }

  async comment(): Promise<void> {
    throw new Error('Harness fixtures do not support provider comments.');
  }

  private toTicket(): DeliveryTicket {
    return {
      ref: {
        provider: 'jira',
        key: this.fixture.ticket.key,
        url: `https://jira.example.test/browse/${this.fixture.ticket.key}`
      },
      summary: this.fixture.ticket.summary,
      description: this.fixture.ticket.description,
      status: 'To Do',
      priority: 'medium',
      labels: this.fixture.ticket.labels,
      createdAt: fixedHarnessClock().toISOString(),
      updatedAt: fixedHarnessClock().toISOString()
    };
  }
}

class FixtureDevRunner implements DevRunner {
  constructor(private readonly agent: HarnessFixtureAgent) {}

  async run(input: DevRunInput): Promise<DevRunResult> {
    for (const fileWrite of this.agent.fileWrites) {
      const outputPath = join(input.workingDirectory, fileWrite.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, fileWrite.content, 'utf8');
    }

    await writeFile(join(input.workingDirectory, '.omo', 'session.json'), '{"fixture":true}\n', 'utf8').catch(async () => {
      await mkdir(join(input.workingDirectory, '.omo'), { recursive: true });
      await writeFile(join(input.workingDirectory, '.omo', 'session.json'), '{"fixture":true}\n', 'utf8');
    });

    const implementationLog = buildImplementationLog(this.agent);
    await mkdir(dirname(input.implementationLogPath), { recursive: true });
    await writeFile(input.implementationLogPath, implementationLog, 'utf8');

    const startedAt = fixedHarnessClock().toISOString();
    const finishedAt = fixedHarnessClock().toISOString();

    return {
      provider: 'opencode',
      ticketKey: input.ticketKey,
      runId: input.runId,
      repository: input.repository,
      branchName: input.branchName,
      baseBranch: input.baseBranch,
      command: input.command,
      workingDirectory: input.workingDirectory,
      implementationLogPath: input.implementationLogPath,
      startedAt,
      finishedAt,
      durationMs: 0,
      attempts: [{
        attempt: 1,
        command: input.command,
        workingDirectory: input.workingDirectory,
        startedAt,
        finishedAt,
        durationMs: 0,
        exitCode: 0,
        status: 'passed',
        summary: implementationLog
      }],
      status: 'passed',
      summary: implementationLog
    };
  }
}

function createFixtureGitRunner(agent: HarnessFixtureAgent): GitCommandRunner {
  let statusCalls = 0;

  return async (input: GitCommandInput): Promise<GitCommandResult> => {
    const [command, ...args] = input.args;

    if (command === 'show-ref') {
      return { stdout: '', stderr: '', exitCode: 1 };
    }

    if (command === 'checkout') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (command === 'rev-parse') {
      return { stdout: 'fixture-head-sha\n', stderr: '', exitCode: 0 };
    }

    if (command === 'status') {
      statusCalls += 1;
      const hasPathspec = args.includes('--');

      if (hasPathspec) {
        return { stdout: filterPathspecStatus(agent.gitPathspecStatus ?? agent.gitAfterStatus, args), stderr: '', exitCode: 0 };
      }

      return { stdout: statusCalls === 1 ? '' : agent.gitAfterStatus, stderr: '', exitCode: 0 };
    }

    if (command === 'diff') {
      if (args.includes('--unified=0')) {
        return { stdout: filterUnifiedDiff(agent.gitTrackedDiff, args), stderr: '', exitCode: 0 };
      }

      return { stdout: statusCalls <= 1 ? '' : agent.gitAfterDiffStat, stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: `Unexpected harness git command: git ${input.args.join(' ')}\n`, exitCode: 1 };
  };
}

function filterPathspecStatus(status: string, args: readonly string[]): string {
  const separatorIndex = args.indexOf('--');

  if (separatorIndex === -1) {
    return status;
  }

  const pathspecs = new Set(args.slice(separatorIndex + 1));
  const lines = status.split('\n').filter((line) => {
    if (line.trim().length === 0) {
      return false;
    }

    return pathspecs.has(parsePorcelainPath(line));
  });

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function parsePorcelainPath(line: string): string {
  return unquoteGitPath(line.slice(3).trim());
}

function unquoteGitPath(filePath: string): string {
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    return filePath.slice(1, -1);
  }

  return filePath;
}

function filterUnifiedDiff(diff: string, args: readonly string[]): string {
  const separatorIndex = args.indexOf('--');

  if (separatorIndex === -1) {
    return diff;
  }

  const pathspecs = new Set(args.slice(separatorIndex + 1));
  const sections = splitUnifiedDiffSections(diff).filter((section) => {
    const filePath = parseDiffGitPath(section[0] ?? '');
    return filePath !== undefined && pathspecs.has(filePath);
  });

  if (sections.length === 0) {
    return '';
  }

  return `${sections.map((section) => section.join('\n')).join('\n')}\n`;
}

function splitUnifiedDiffSections(diff: string): readonly (readonly string[])[] {
  const sections: string[][] = [];
  let currentSection: string[] = [];

  for (const line of diff.split('\n')) {
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith('diff --git ')) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
      }

      currentSection = [line];
      continue;
    }

    if (currentSection.length > 0) {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

function parseDiffGitPath(line: string): string | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);

  if (match === null) {
    return undefined;
  }

  return unquoteGitPath(match[2] ?? '').trim();
}

async function buildFixtureQualityReport(input: { readonly gates: readonly { readonly name: string; readonly command?: string | undefined; readonly requirement: string; readonly workingDirectory: string }[]; readonly logRootPath: string; readonly now: () => Date }): Promise<QualityReport> {
  const startedAt = input.now().toISOString();
  const finishedAt = input.now().toISOString();
  const required = await Promise.all(input.gates.filter((gate) => gate.requirement === 'required').map(async (gate) => {
    const stdoutLogPath = join(input.logRootPath, `${gate.name}.stdout.log`);
    const stderrLogPath = join(input.logRootPath, `${gate.name}.stderr.log`);
    await mkdir(dirname(stdoutLogPath), { recursive: true });
    await writeFile(stdoutLogPath, `${gate.command ?? gate.name} fixture pass\n`, 'utf8');
    await writeFile(stderrLogPath, '', 'utf8');

    return {
      name: gate.name,
      command: gate.command,
      workingDirectory: gate.workingDirectory,
      startedAt,
      finishedAt,
      durationMs: 0,
      exitCode: 0,
      stdoutLogPath,
      stderrLogPath,
      status: 'passed' as const,
      summary: `${gate.name} passed in fixture harness.`
    };
  }));

  return { status: 'passed', required, optional: [] };
}

async function scoreFixture(input: { readonly fixture: HarnessFixture; readonly result: DevelopmentRunResult; readonly workspacePath: string }): Promise<readonly HarnessCheckResult[]> {
  const expected = input.fixture.expected;
  const selectedRepository = input.result.state.targetRepositories[0]?.name ?? 'none';
  const qualityResult = input.result.state.qualityReports.at(-1)?.status ?? 'not_run';
  const checks: HarnessCheckResult[] = [
    toCheck('selected repository', expected.selectedRepository, selectedRepository),
    toCheck('meaningful diff', expected.meaningfulDiff, input.result.state.meaningfulDiff?.decision ?? 'missing'),
    toCheck('policy decision', expected.policyDecision, input.result.state.coreSafety?.decision ?? 'missing'),
    toCheck('quality result', expected.qualityResult, qualityResult),
    toCheck('final state', expected.finalState, input.result.state.state)
  ];

  for (const reportPath of expected.reports) {
    const absolutePath = join(input.workspacePath, getRunDirectoryPath(input.fixture.ticket.key, input.result.runId), reportPath);
    checks.push(toCheck(`report ${reportPath}`, 'present', await pathExists(absolutePath) ? 'present' : 'missing'));
  }

  return checks;
}

function toCheck(name: string, expected: string, actual: string): HarnessCheckResult {
  return {
    name,
    expected,
    actual,
    passed: expected === actual
  };
}

function buildImplementationLog(agent: HarnessFixtureAgent): string {
  return [
    '# Fixture Implementation Log',
    '',
    `Status: ${agent.status}`,
    `Changed Files: ${agent.changedFiles.join(', ') || 'none'}`,
    `Tests Run: ${agent.testsRun}`,
    `Known Limits: ${agent.knownLimits}`,
    `Blockers: ${agent.blockers}`,
    `Background Agents: ${agent.backgroundAgents}`,
    ''
  ].join('\n');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function fixedHarnessClock(): Date {
  return new Date('2026-06-07T00:00:00.000Z');
}
