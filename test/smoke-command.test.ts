import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockMcpClient,
  MockSmokeUrlVerifier,
  createCliProgram,
  createMockMcpTool,
  defaultGitHubMcpToolNames,
  defaultJiraMcpToolNames,
  defaultRailwayMcpToolNames,
  getOperationLedgerFilePath,
  getRunDirectoryPath,
  getRunStateFilePath,
  type CliProgramIO,
  type DeliveryRunStateRecord,
  type DevRunInput,
  type DevRunResult,
  type DevRunner,
  type GitCommandInput,
  type GitCommandResult,
  type JsonObject,
  type McpToolCallAuditRecord,
  type QualityReport
} from '../src/index.js';

test('smoke command refuses missing confirmation before doctor, config, MCP, or state', async (t) => {
  const rootPath = await createTempRoot(t);
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /missing --confirm-real-provider-smoke/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

test('smoke command stops on doctor fail before MCP readiness or run state', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: {
      commandExists: (command) => command !== 'opencode',
      opencodeHomeDirectory: join(rootPath, 'opencode-home')
    },
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Phase 1\/3: running local doctor/u);
  assert.match(captured.stdout, /FAIL: OpenCode/u);
  assert.match(captured.stderr, /Smoke preflight failed/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

test('smoke command requires Jira, GitHub, and Railway MCP modes before run state or provider side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: {
      mcpClients: clients,
      mcpAuditSink: (records) => auditRecords.push(...records)
    },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner,
      smokeVerifier: new MockSmokeUrlVerifier(),
      qualityRunner: async ({ gates, logRootPath }) => {
        qualityCalls += 1;
        assert.deepEqual(gates.map((gate) => gate.name), ['test']);
        assert.match(logRootPath, /.ewokbot\/runs\/AE-101\/smoke-run-1\/quality-logs/u);
        return createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Atlassian MCP Jira work-item smoke run requested for AE-101/u);
  assert.match(captured.stdout, /validating runtime MCP readiness for Jira, GitHub handoff, and Railway staging reads/u);
  assert.match(captured.stderr, /Smoke preflight requires jira\.mode, github\.mode, and railway\.mode to be mcp for BB/u);
  assert.match(captured.stderr, /github\.mode=mock/u);
  assert.match(captured.stderr, /railway\.mode=mock/u);
  assert.match(captured.stderr, /failed before run state, git, OpenCode, quality, GitHub, Railway, operation ledger, staging report, production PR, merge, or deploy side effects/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.atlassian.toolCallRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(auditRecords, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assertNoSmokeSideEffectFiles(rootPath);
});

test('smoke command uses fake GitHub and Railway MCP tools for staging verification without mutating Railway', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml(), {
    envLines: ['GITHUB_PERSONAL_ACCESS_TOKEN=redacted', 'ATLASSIAN_BASE_URL=redacted', 'ATLASSIAN_EMAIL=redacted', 'ATLASSIAN_API_TOKEN=redacted', 'VERCEL_TOKEN=redacted']
  });
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: {
      mcpClients: clients,
      mcpAuditSink: (records) => auditRecords.push(...records)
    },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner,
      smokeVerifier: new MockSmokeUrlVerifier(),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 0, captured.stderr + captured.stdout);
  assert.match(captured.stdout, /Final State: STAGING_VERIFIED/u);
  assert.match(captured.stdout, /Staging Report: \.ewokbot\/runs\/AE-101\/smoke-run-1\/staging-report\.md/u);
  assert.match(captured.stdout, /Develop Handoff Commit: local-head/u);
  assert.doesNotMatch(captured.stdout, /FAIL: GitHub/u);
  assert.doesNotMatch(captured.stdout, /FAIL: Railway/u);
  assert.doesNotMatch(captured.stdout, /FAIL: Vercel/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests.map((call) => call.toolName), [
    defaultGitHubMcpToolNames.listBranches,
    defaultGitHubMcpToolNames.createBranch,
    defaultGitHubMcpToolNames.openPullRequest,
    defaultGitHubMcpToolNames.commentOnPullRequest,
    defaultGitHubMcpToolNames.getChecks,
    defaultGitHubMcpToolNames.getChecks,
    defaultGitHubMcpToolNames.mergePullRequest
  ]);
  assert.deepEqual(clients.railway.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment
  ]);
  assertNoRailwayMutatingToolCalls(clients.railway.toolCallRequests.map((call) => call.toolName));
  assert.equal(auditRecords.some((record) => record.port === 'DeploymentPort' && record.action === 'waitForDeployment' && record.status === 'succeeded'), true);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff', 'status', 'diff', 'show-ref', 'checkout', 'rev-parse', 'reset', 'add', 'diff', '-c', 'rev-parse', 'push', 'rev-parse']);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(qualityCalls, 1);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'STAGING_VERIFIED');
  assert.equal(state.pullRequests.length, 1);
  assert.equal(state.pullRequests[0]?.targetBranch, 'develop');
  assert.equal(state.developHandoffCommit?.commitSha, 'local-head');
  assert.deepEqual(state.developHandoffCommit?.stagedFiles, ['src/app.ts']);
  assert.equal(state.stagingDeployments.length, 1);
  assert.equal(state.stagingDeployments[0]?.commitSha, 'develop-merge-head');
  assert.equal(state.stagingDeployments[0]?.serviceUrl, 'https://frontend.example.test');
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'staging-report.md'))).isFile(), true);
  assert.equal((await stat(join(rootPath, getOperationLedgerFilePath('AE-101', 'smoke-run-1')))).isFile(), true);
});

test('smoke command reports GitHub handoff failures without Jira read wrapper', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;
  clients.github = new MockMcpClient([
    createMockMcpTool('github', defaultGitHubMcpToolNames.listBranches, () => ({ content: { branches: [] }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { headSha: 'github-branch-head' } }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: { error: 'create_pull_request failed with 422: no commits between develop and agent branch' }, isError: true })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.listPullRequests, () => ({ content: { pullRequests: [] }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, () => ({ content: { checks: { status: 'passed', totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 } }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: { ok: true }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.mergePullRequest, () => ({ content: { ok: true }, isError: false }))
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner,
      smokeVerifier: new MockSmokeUrlVerifier(),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /GitHub develop PR handoff or follow-up failed/u);
  assert.doesNotMatch(captured.stderr, /unable to read Jira work item/u);
  assert.deepEqual(clients.github.toolCallRequests.map((call) => call.toolName), [
    defaultGitHubMcpToolNames.listBranches,
    defaultGitHubMcpToolNames.createBranch,
    defaultGitHubMcpToolNames.openPullRequest
  ]);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff', 'status', 'diff', 'show-ref', 'checkout', 'rev-parse', 'reset', 'add', 'diff', '-c', 'rev-parse', 'push', 'rev-parse']);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(qualityCalls, 1);
});

test('smoke command needs human before provider handoff when agent completion needs credentials', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'blocked',
    changedFiles: 'src/app.ts',
    testsRun: 'not run with reason: provider credentials are required',
    knownLimits: 'blocked by credentials',
    blockers: 'credentials required from operator',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner,
      smokeVerifier: new MockSmokeUrlVerifier(),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Agent Completion: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Human Action Needed:/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(qualityCalls, 0);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff']);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'NEEDS_HUMAN');
  assert.equal(state.agentCompletion?.decision, 'needs_human');
  assert.equal(state.humanActionNeeded?.reason, state.agentCompletion.reason);
  assert.equal(state.coreSafety, undefined);
  assert.equal(state.qualityReports.length, 0);
  assert.equal(state.pullRequests.length, 0);
  assert.equal(state.stagingDeployments.length, 0);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'core-safety.json')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'staging-report.md')));
  await assert.rejects(stat(join(rootPath, getOperationLedgerFilePath('AE-101', 'smoke-run-1'))));
});

test('smoke command refuses an existing state file before delivery side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml());
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AE-101', 'smoke-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1'));
  const existingState = '{"sentinel":"keep-existing-state"}\n';
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  await mkdir(runDirectoryPath, { recursive: true });
  await writeFile(statePath, existingState, 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async ({ gates: _gates, logRootPath: _logRootPath }) => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal(await readFile(statePath, 'utf8'), existingState);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assertNoSmokeSideEffectFiles(rootPath);
});

test('smoke command refuses an existing run directory before delivery side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml());
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AE-101', 'smoke-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AE-101', 'smoke-run-1'));
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  const gitCalls: GitCommandInput[] = [];
  const devRunner = createFakeDevRunner(completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts',
    testsRun: 'pnpm test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  }));
  let qualityCalls = 0;

  await mkdir(runDirectoryPath, { recursive: true });

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async ({ gates: _gates, logRootPath: _logRootPath }) => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal((await stat(runDirectoryPath)).isDirectory(), true);
  await assert.rejects(stat(statePath));
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assertNoSmokeSideEffectFiles(rootPath);
});

test('smoke command fails missing Atlassian MCP Jira work-item readiness before run state, repository branch/git, OpenCode, quality, package-manager, or provider side effects', async (t) => {
  const rootPath = await createSmokeWorkspace(t, smokeWorkspaceWithProviderMcpYaml());
  const captured = createCapturedIO();
  const clients = createSmokeMcpClients();
  clients.atlassian = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [jiraIssue()] }, isError: false })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    doctorOptions: { commandExists: () => true, opencodeHomeDirectory: join(rootPath, 'opencode-home') },
    runtimeMcp: { mcpClients: clients },
    smokeDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'smoke', 'AE-101', '--confirm-real-provider-smoke', '--run-id', 'smoke-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /Smoke run failed/u);
  assert.match(captured.stderr, /missing required runtime MCP tool/u);
  assert.match(captured.stderr, new RegExp(defaultJiraMcpToolNames.getTicket, 'u'));
  assert.match(captured.stderr, /Production PR preparation, production merge, production deploy, and Railway mutating actions are never attempted/u);
  assert.deepEqual(clients.atlassian.toolCallRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(qualityCalls, 0);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-smoke-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

async function createSmokeWorkspace(t: TestContext, configYaml: string, options: { readonly envLines?: readonly string[] | undefined } = {}): Promise<string> {
  const rootPath = await createTempRoot(t);
  const repoPath = join(rootPath, 'frontend');
  const envLines = options.envLines ?? ['GITHUB_PERSONAL_ACCESS_TOKEN=redacted', 'ATLASSIAN_BASE_URL=redacted', 'ATLASSIAN_EMAIL=redacted', 'ATLASSIAN_API_TOKEN=redacted', 'RAILWAY_TOKEN=redacted'];

  await mkdir(join(rootPath, '.ewokbot'), { recursive: true });
  await mkdir(repoPath, { recursive: true });
  await writeFile(join(rootPath, '.ewokbot', 'workspace.yml'), configYaml, 'utf8');
  await writeFile(join(rootPath, '.ewokbot', '.env.example'), ['GITHUB_PERSONAL_ACCESS_TOKEN=', 'ATLASSIAN_BASE_URL=', 'ATLASSIAN_EMAIL=', 'ATLASSIAN_API_TOKEN=', 'RAILWAY_TOKEN=', ''].join('\n'), 'utf8');
  await writeFile(join(rootPath, '.ewokbot', '.env'), [...envLines, ''].join('\n'), 'utf8');
  await writeFile(join(repoPath, '.agent-quality.yml'), ['commands:', '  test: mock test', 'required:', '  - test', ''].join('\n'), 'utf8');
  return rootPath;
}

function createCapturedIO(): { readonly io: CliProgramIO; readonly stdout: string; readonly stderr: string } {
  const captured = { stdout: '', stderr: '' };
  return {
    get stdout() {
      return captured.stdout;
    },
    get stderr() {
      return captured.stderr;
    },
    io: {
      stdout: (text: string) => {
        captured.stdout += text;
      },
      stderr: (text: string) => {
        captured.stderr += text;
      }
    }
  };
}

function createSmokeMcpClients(): Record<string, MockMcpClient> {
  return {
    atlassian: new MockMcpClient([
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [jiraIssue()] }, isError: false })),
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue() }, isError: false })),
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
    ]),
    github: new MockMcpClient([
      createMockMcpTool('github', defaultGitHubMcpToolNames.listBranches, () => ({ content: { branches: [] }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { headSha: 'github-branch-head' } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, (input) => {
        const targetBranch = String(input.arguments.base ?? input.arguments.targetBranch);
        const number = targetBranch === 'main' ? 9102 : 9101;
        return { content: { pullRequest: { number, url: `https://github.example.test/pull/${number}`, targetBranch } }, isError: false };
      }),
      createMockMcpTool('github', defaultGitHubMcpToolNames.listPullRequests, () => ({ content: { pullRequests: [{ number: 9101, head: { ref: 'agent/AE-101-smoke-frontend-real-provider-path' } }] }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, (input) => {
        if (input.arguments.method === 'get') {
          return {
            content: {
              pullRequest: {
                number: 9101,
                title: 'AE-101 Smoke frontend real provider path',
                url: 'https://github.example.test/pull/9101',
                status: 'open',
                sourceBranch: 'agent/AE-101-smoke-frontend-real-provider-path',
                targetBranch: 'develop'
              }
            },
            isError: false
          };
        }

        return { content: { checks: { status: 'passed', totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 } }, isError: false };
      }),
      createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: { ok: true }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.mergePullRequest, () => ({
        content: {
          pullRequest: {
            number: 9101,
            title: 'AE-101 Smoke frontend real provider path',
            url: 'https://github.example.test/pull/9101',
            status: 'merged',
            sourceBranch: 'agent/AE-101-smoke-frontend-real-provider-path',
            targetBranch: 'develop'
          },
          merge_commit_sha: 'develop-merge-head',
          merged_at: '2026-06-05T00:00:04.000Z'
        },
        isError: false
      }))
    ]),
    railway: new MockMcpClient(createRailwayTools())
  };
}

function createRailwayTools(): ReturnType<typeof createMockMcpTool>[] {
  return uniqueRailwayToolNames().map((toolName) => createMockMcpTool('railway', toolName, () => {
    if (toolName === defaultRailwayMcpToolNames.environmentStatus) {
      return { content: { environment: { status: 'ready' } }, isError: false };
    }

    if (toolName === defaultRailwayMcpToolNames.waitForDeployment) {
      return { content: { deployment: railwayDeployment('develop', 'develop-merge-head') }, isError: false };
    }

    return { content: { ok: true }, isError: false };
  }));
}

function uniqueRailwayToolNames(): readonly string[] {
  return Array.from(new Set(Object.values(defaultRailwayMcpToolNames).filter((toolName) => toolName.trim().length > 0)));
}

function assertNoRailwayMutatingToolCalls(toolNames: readonly string[]): void {
  const deniedToolNames = ['deploy', 'deploy_template', 'generate_domain', 'remove_service', 'remove_project', 'scale_service', 'set_variables', 'add_reference_variable', 'list_variables'];

  for (const toolName of deniedToolNames) {
    assert.equal(toolNames.includes(toolName), false, `${toolName} must not be called by staging verification`);
  }
}

function jiraIssue(): JsonObject {
  return {
    key: 'AE-101',
    fields: {
      summary: 'Smoke frontend real provider path',
      description: 'Validate the frontend delivery smoke run.',
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels: ['frontend'],
      created: '2026-06-05T00:00:00.000Z',
      updated: '2026-06-05T00:00:00.000Z'
    }
  };
}

function railwayDeployment(branch: string, commitSha: string): JsonObject {
  return {
    ref: {
      projectId: 'mock-project-agentic',
      environmentId: 'mock-environment-staging',
      serviceId: 'mock-service-frontend',
      deploymentId: 'deployment-1',
      environment: 'staging'
    },
    status: 'success',
    branch,
    commitSha,
    serviceUrl: 'https://frontend.example.test',
    startedAt: '2026-06-05T00:00:00.000Z',
    finishedAt: '2026-06-05T00:01:00.000Z',
    summary: 'Mock Railway MCP staging deployment succeeded.'
  };
}

function createFakeGitRunner(output: { readonly calls?: GitCommandInput[] | undefined } = {}): (input: GitCommandInput) => Promise<GitCommandResult> {
  let statusCalls = 0;
  let diffCalls = 0;

  return async (input) => {
    output.calls?.push(input);

    if (input.args[0] === 'status') {
      statusCalls += 1;
      return fakeGitResult(input, { statusPorcelain: statusCalls === 1 ? '' : ' M src/app.ts\n' });
    }

    if (input.args[0] === 'diff') {
      if (input.args.join(' ') === 'diff --cached --name-only') {
        return fakeGitResult(input, { diffStat: 'src/app.ts\n' });
      }

      if (input.args.includes('--unified=0')) {
        return fakeGitResult(input, { diffPatch: diffPatch('src/app.ts', ['export const smoke = true;']) });
      }

      diffCalls += 1;
      return fakeGitResult(input, { diffStat: diffCalls === 1 ? '' : ' src/app.ts | 1 +\n 1 file changed, 1 insertion(+)' });
    }

    return fakeGitResult(input);
  };
}

function fakeGitResult(input: GitCommandInput, output: { readonly statusPorcelain?: string | undefined; readonly diffStat?: string | undefined; readonly diffPatch?: string | undefined } = {}): GitCommandResult {
  if (input.args[0] === 'show-ref') {
    return { stdout: '', stderr: '', exitCode: 1 };
  }

  if (input.args[0] === 'rev-parse') {
    return { stdout: 'local-head\n', stderr: '', exitCode: 0 };
  }

  if (input.args[0] === 'status') {
    return { stdout: output.statusPorcelain ?? '', stderr: '', exitCode: 0 };
  }

  if (input.args[0] === 'diff') {
    return { stdout: input.args.includes('--unified=0') ? output.diffPatch ?? '' : output.diffStat ?? '', stderr: '', exitCode: 0 };
  }

  return { stdout: '', stderr: '', exitCode: 0 };
}

function diffPatch(filePath: string, additions: readonly string[]): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,0 +1,${additions.length} @@`,
    ...additions.map((line) => `+${line}`),
    ''
  ].join('\n');
}

function createFakeDevRunner(implementationLog: string): DevRunner & { readonly calls: readonly DevRunInput[] } {
  const calls: DevRunInput[] = [];

  return {
    get calls() {
      return calls;
    },
    async run(input) {
      calls.push(input);
      await mkdir(dirname(input.implementationLogPath), { recursive: true });
      await writeFile(input.implementationLogPath, `# Implementation Log\n\n${input.prompt}\n\n${implementationLog}\n`, 'utf8');

      return createPassedDevRun(input);
    }
  };
}

function completionLog(input: {
  readonly status: 'completed' | 'blocked' | 'incomplete';
  readonly changedFiles: string;
  readonly testsRun: string;
  readonly knownLimits: string;
  readonly blockers: string;
  readonly backgroundAgents: string;
}): string {
  return [
    '## Required Final Completion Summary',
    `Status: ${input.status}`,
    `Changed files: ${input.changedFiles}`,
    `Tests run: ${input.testsRun}`,
    `Known limits: ${input.knownLimits}`,
    `Blockers: ${input.blockers}`,
    `Background agents: ${input.backgroundAgents}`,
    ''
  ].join('\n');
}

function createPassedDevRun(input: DevRunInput): DevRunResult {
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
    startedAt: '2026-06-05T00:00:00.000Z',
    finishedAt: '2026-06-05T00:00:01.000Z',
    durationMs: 1000,
    attempts: [
      {
        attempt: 1,
        command: input.command,
        workingDirectory: input.workingDirectory,
        startedAt: '2026-06-05T00:00:00.000Z',
        finishedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        status: 'passed',
        summary: 'Fake OpenCode implementation passed.'
      }
    ],
    status: 'passed',
    summary: 'Fake OpenCode implementation passed.'
  };
}

function createPassedQualityReport(repositoryPath: string, command = 'mock test'): QualityReport {
  return {
    status: 'passed',
    required: [
      {
        name: 'test',
        command,
        workingDirectory: repositoryPath,
        startedAt: '2026-06-05T00:00:00.000Z',
        finishedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        stdoutLogPath: '.ewokbot/runs/AE-101/smoke-run-1/quality-logs/test.stdout.log',
        stderrLogPath: '.ewokbot/runs/AE-101/smoke-run-1/quality-logs/test.stderr.log',
        status: 'passed',
        summary: 'Mock quality gate passed.'
      }
    ],
    optional: []
  };
}

function fixedClock(): () => Date {
  let tick = 0;
  return () => {
    const date = new Date(Date.UTC(2026, 5, 5, 0, 0, tick));
    tick += 1;
    return date;
  };
}

async function assertNoSmokeSideEffectFiles(rootPath: string): Promise<void> {
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'plan.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'implementation-log.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'quality-report.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'staging-report.md')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AE-101', 'smoke-run-1', 'final-report.md')));
  await assert.rejects(stat(join(rootPath, getOperationLedgerFilePath('AE-101', 'smoke-run-1'))));
}

function smokeWorkspaceYaml(): string {
  return `
workspace:
  name: Smoke Test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AE
  mcp_server: atlassian
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 1
quality:
  default_profile: node
mcp_servers:
  atlassian:
    transport: stdio
    command: mcp-atlassian
    args: []
    env_var_names:
      - ATLASSIAN_BASE_URL
      - ATLASSIAN_EMAIL
      - ATLASSIAN_API_TOKEN
repos:
  - name: frontend
    url: https://github.com/agentic/frontend
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
    deployments:
      staging:
        provider: railway
        project_id: mock-project-agentic
        environment_id: mock-environment-staging
        service_id: mock-service-frontend
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls:
            - /health
`;
}

function smokeWorkspaceWithProviderMcpYaml(): string {
  return `
workspace:
  name: Smoke Test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AE
  mcp_server: atlassian
github:
  mode: mcp
  mcp_server: github
delivery:
  checks:
    no_remote_checks: wait
  pull_requests:
    develop:
      auto_merge: true
      merge_method: squash
      require_checks: pass
      after_merge:
        verify_deployment: true
    main:
      auto_merge: false
      require_human_approval: true
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 1
quality:
  default_profile: node
mcp_servers:
  atlassian:
    transport: stdio
    command: mcp-atlassian
    args: []
    env_var_names:
      - ATLASSIAN_BASE_URL
      - ATLASSIAN_EMAIL
      - ATLASSIAN_API_TOKEN
  github:
    display_name: GitHub MCP
    command: docker
    args:
      - run
      - -i
      - --rm
      - -e
      - GITHUB_PERSONAL_ACCESS_TOKEN
      - ghcr.io/github/github-mcp-server
    env_var_names:
      - GITHUB_PERSONAL_ACCESS_TOKEN
  railway:
    display_name: Railway MCP
    command: railway
    args:
      - mcp
mcp_policy:
  mode: custom
  tools:
    read_jira_issue:
      decision: allow
    list_branches:
      decision: allow
    create_branch:
      decision: allow
    list_pull_requests:
      decision: allow
    create_pull_request:
      decision: allow
    pull_request_read:
      decision: allow
    add_issue_comment:
      decision: allow
    merge_pull_request:
      decision: allow
    environment_status:
      decision: allow
    list_deployments:
      decision: allow
repos:
  - name: frontend
    url: https://github.com/agentic/frontend
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
    deployments:
      staging:
        provider: railway
        project_id: mock-project-agentic
        environment_id: mock-environment-staging
        service_id: mock-service-frontend
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls:
            - /health
`;
}
