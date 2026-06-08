import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockMcpClient,
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
  type QualityReport
} from '../src/index.js';

test('run-dev command refuses missing confirmation before config, MCP, state, or git', async (t) => {
  const rootPath = await createTempRoot(t);
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /missing --confirm-dev-execution/u);
  assert.deepEqual(clients.atlassian.listToolRequests, []);
  assert.deepEqual(clients.github.listToolRequests, []);
  assert.deepEqual(clients.railway.listToolRequests, []);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs')));
});

test('run-dev command executes one selected repository through local checks only', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  const events: string[] = [];
  const devRunner = createFakeDevRunner(events);
  const qualityReport = createPassedQualityReport(join(rootPath, 'frontend'));
  const gitCommandRunner = createFakeGitRunner({ calls: gitCalls, events });

  await writeFile(join(rootPath, '.ewokbot', '.env'), ['OPENCODE_COMMAND=opencode-from-env', 'ANTHROPIC_API_KEY=workspace-secret', ''].join('\n'), 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner,
      devRunner,
      qualityRunner: async ({ gates, logRootPath }) => {
        assert.deepEqual(gates.map((gate) => gate.name), ['test']);
        assert.match(logRootPath, /.ewokbot\/runs\/AI-101\/dev-run-1\/quality-logs/u);
        return qualityReport;
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Development execution requested for AI-101/u);
  assert.match(captured.stdout, /Scope: one Jira work item/u);
  assert.match(captured.stdout, /creating Atlassian MCP Jira work-item TicketPort\.getTicket runtime path/u);
  assert.match(captured.stdout, /reading one Jira work item/u);
  assert.match(captured.stdout, /Execution boundary confirmed before run state, git, OpenCode, and quality side effects/u);
  assert.match(captured.stdout, /Repository: agentic\/frontend/u);
  assert.match(captured.stdout, /Branch: agent\/AI-101-dev-frontend-local-path/u);
  assert.match(captured.stdout, /Final State: LOCAL_CHECKS_PASSED/u);
  assert.match(captured.stdout, /Test Relevance: WARN/u);
  assert.match(captured.stdout, /Local-only boundary preserved/u);
  assert.equal(captured.stderr, '');

  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.equal(clients.atlassian.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.listBacklog), false);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.equal(devRunner.calls.length, 1);
  const devRunInput = devRunner.calls[0];
  assert.ok(devRunInput !== undefined);
  assert.ok(devRunInput.environment !== undefined);
  assert.equal(devRunInput.environment.OPENCODE_COMMAND, 'opencode-from-env');
  assert.equal(devRunInput.environment.ANTHROPIC_API_KEY, 'workspace-secret');
  assert.doesNotMatch(captured.stdout, /workspace-secret/u);
  assert.doesNotMatch(captured.stderr, /workspace-secret/u);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff', 'status', 'diff']);
  assert.deepEqual(events, ['git:show-ref', 'git:checkout', 'git:rev-parse', 'git:status', 'git:diff', 'dev-run', 'git:status', 'git:diff', 'git:status', 'git:diff']);
  assert.equal(gitCalls.some((call) => call.args[0] === 'push'), false);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'LOCAL_CHECKS_PASSED');
  assert.equal(state.targetRepositories.length, 1);
  assert.equal(state.pullRequests.length, 0);
  assert.equal(state.stagingDeployments.length, 0);
  assert.equal(state.branches.length, 1);
  assert.equal(state.devRuns.length, 1);
  assert.equal(state.qualityReports.length, 1);
  assert.equal(state.meaningfulDiff?.decision, 'passed');
  assert.equal(state.agentCompletion?.decision, 'pass');
  assert.equal(state.agentCompletion.statusSignal, 'completed');
  assert.equal(state.coreSafety?.decision, 'pass');
  assert.equal(state.testRelevance?.decision, 'warn');
  assert.equal(state.coreSafety.changedFileCount, 1);
  assert.equal(state.coreSafety.addedLineCount, 1);
  assert.deepEqual(state.meaningfulDiff.baselineChangedFiles, []);
  assert.deepEqual(state.meaningfulDiff.afterAgentChangedFiles, ['src/app.ts']);
  assert.deepEqual(state.meaningfulDiff.newChangedFiles, ['src/app.ts']);
  assert.deepEqual(state.meaningfulDiff.productFiles, ['src/app.ts']);
  const meaningfulDiff = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'meaningful-diff.json'), 'utf8')) as DeliveryRunStateRecord['meaningfulDiff'];
  assert.equal(meaningfulDiff?.decision, 'passed');
  const agentCompletion = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'agent-completion.json'), 'utf8')) as DeliveryRunStateRecord['agentCompletion'];
  assert.equal(agentCompletion?.decision, 'pass');
  const coreSafety = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'core-safety.json'), 'utf8')) as DeliveryRunStateRecord['coreSafety'];
  assert.equal(coreSafety?.decision, 'pass');
  const testRelevance = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'test-relevance.json'), 'utf8')) as DeliveryRunStateRecord['testRelevance'];
  assert.equal(testRelevance?.decision, 'warn');
  assert.equal(testRelevance?.qualityCommands[0]?.command, 'mock test');
  assert.equal(testRelevance?.qualityCommands[0]?.trivial, true);
  const qualityReportMarkdown = await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md'), 'utf8');
  assert.match(qualityReportMarkdown, /Test Relevance/u);
  assert.match(qualityReportMarkdown, /Decision: WARN/u);
  const finalReport = await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'final-report.md'), 'utf8');
  assert.match(finalReport, /Development execution remained local-only/u);
  assert.match(finalReport, /Meaningful Diff/u);
  assert.match(finalReport, /Agent Completion/u);
  assert.match(finalReport, /Core Safety/u);
  assert.match(finalReport, /Test Relevance/u);
  assert.match(finalReport, /Decision: PASS/u);
  assert.match(finalReport, /Decision: WARN/u);
  assert.match(finalReport, /Agent Product Changed Files: src\/app\.ts/u);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'implementation-log.md'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'meaningful-diff.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'agent-completion.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'core-safety.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'test-relevance.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md'))).isFile(), true);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command passes test relevance for realistic test evidence', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const qualityReport = createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm test');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner(),
      devRunner: createFakeDevRunner(undefined, completionLog({
        status: 'completed',
        changedFiles: 'src/app.ts',
        testsRun: 'pnpm test',
        knownLimits: 'none',
        blockers: 'none',
        backgroundAgents: 'none'
      })),
      qualityRunner: async () => qualityReport
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Final State: LOCAL_CHECKS_PASSED/u);
  assert.match(captured.stdout, /Test Relevance: PASS/u);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'LOCAL_CHECKS_PASSED');
  assert.equal(state.testRelevance?.decision, 'pass');
  assert.equal(state.testRelevance?.qualityCommands[0]?.command, 'pnpm test');
  assert.equal(state.testRelevance?.qualityCommands[0]?.trivial, false);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command needs human after quality when tests were explicitly not run', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const qualityReport = createPassedQualityReport(join(rootPath, 'frontend'), 'pnpm typecheck', 'typecheck');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner(),
      devRunner: createFakeDevRunner(undefined, completionLog({
        status: 'completed',
        changedFiles: 'src/app.ts',
        testsRun: 'not run',
        knownLimits: 'none',
        blockers: 'none',
        backgroundAgents: 'none'
      })),
      qualityRunner: async () => qualityReport
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Test Relevance: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Human Action Needed:/u);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'NEEDS_HUMAN');
  assert.equal(state.testRelevance?.decision, 'needs_human');
  assert.equal(state.qualityReports.length, 1);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'test-relevance.json'))).isFile(), true);
  assert.equal((await stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md'))).isFile(), true);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command fails before core safety when agent output is exploration-only', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({ calls: gitCalls }),
      devRunner: createFakeDevRunner(undefined, completionLog({
        status: 'completed',
        preface: 'I looked into the request and recommend changing src/app.ts.',
        changedFiles: 'src/app.ts',
        testsRun: 'mock test',
        knownLimits: 'none',
        blockers: 'none',
        backgroundAgents: 'none'
      })),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: FAILED/u);
  assert.match(captured.stdout, /Agent Completion: FAIL/u);
  assert.equal(qualityCalls, 0);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff']);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'FAILED');
  assert.equal(state.agentCompletion?.decision, 'fail');
  assert.equal(state.coreSafety, undefined);
  assert.equal(state.qualityReports.length, 0);
  const report = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'agent-completion.json'), 'utf8')) as DeliveryRunStateRecord['agentCompletion'];
  assert.equal(report?.findings.some((finding) => finding.kind === 'exploration_only'), true);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'core-safety.json')));
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md')));
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command needs human before core safety when agent reports credential blockers', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner(),
      devRunner: createFakeDevRunner(undefined, completionLog({
        status: 'blocked',
        changedFiles: 'src/app.ts',
        testsRun: 'not run with reason: provider credentials are required',
        knownLimits: 'blocked by credentials',
        blockers: 'credentials required from operator',
        backgroundAgents: 'none'
      })),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Agent Completion: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Human Action Needed:/u);
  assert.equal(qualityCalls, 0);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'NEEDS_HUMAN');
  assert.equal(state.agentCompletion?.decision, 'needs_human');
  assert.equal(state.humanActionNeeded?.reason, state.agentCompletion.reason);
  assert.equal(state.coreSafety, undefined);
  assert.equal(state.qualityReports.length, 0);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'core-safety.json')));
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command fails before local checks when OpenCode only changes ignored artifacts', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  const events: string[] = [];
  const devRunner = createFakeDevRunner(events);
  const gitCommandRunner = createFakeGitRunner({
    calls: gitCalls,
    events,
    afterStatusPorcelain: ['?? .omo/session.json', '?? .ewokbot/runs/AI-101/dev-run-1/evidence.json', '?? logs/opencode.log', ''].join('\n'),
    afterDiffStat: ''
  });
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner,
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: FAILED/u);
  assert.match(captured.stdout, /Meaningful Diff: FAILED/u);
  assert.match(captured.stdout, /only ignored agent\/runtime artifacts/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff']);
  assert.deepEqual(events, ['git:show-ref', 'git:checkout', 'git:rev-parse', 'git:status', 'git:diff', 'dev-run', 'git:status', 'git:diff']);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(qualityCalls, 0);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'FAILED');
  assert.equal(state.failure?.state, 'IMPLEMENTING');
  assert.match(state.failure?.reason ?? '', /only ignored agent\/runtime artifacts/u);
  assert.equal(state.qualityReports.length, 0);
  assert.equal(state.meaningfulDiff?.decision, 'failed');
  assert.deepEqual(state.meaningfulDiff.baselineChangedFiles, []);
  assert.deepEqual(state.meaningfulDiff.afterAgentChangedFiles, ['.omo/session.json', '.ewokbot/runs/AI-101/dev-run-1/evidence.json', 'logs/opencode.log']);
  assert.deepEqual(state.meaningfulDiff.newChangedFiles, ['.omo/session.json', '.ewokbot/runs/AI-101/dev-run-1/evidence.json', 'logs/opencode.log']);
  assert.deepEqual(state.meaningfulDiff.productFiles, []);
  assert.deepEqual(state.meaningfulDiff.ignoredFiles, ['.omo/session.json', '.ewokbot/runs/AI-101/dev-run-1/evidence.json', 'logs/opencode.log']);

  const meaningfulDiff = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'meaningful-diff.json'), 'utf8')) as DeliveryRunStateRecord['meaningfulDiff'];
  assert.equal(meaningfulDiff?.decision, 'failed');
  const finalReport = await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'final-report.md'), 'utf8');
  assert.match(finalReport, /Meaningful Diff/u);
  assert.match(finalReport, /Decision: FAILED/u);
  assert.match(finalReport, /Agent Product Changed Files: none/u);
  assert.match(finalReport, /Agent Ignored Files: \.omo\/session\.json/u);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md')));
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command fails when only a pre-existing product diff is present after OpenCode', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  const events: string[] = [];
  const devRunner = createFakeDevRunner(events);
  let qualityCalls = 0;
  const preexistingStatus = ' M src/preexisting.ts\n';
  const preexistingDiff = ' src/preexisting.ts | 1 +\n 1 file changed, 1 insertion(+)';

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({
        calls: gitCalls,
        events,
        baselineStatusPorcelain: preexistingStatus,
        baselineDiffStat: preexistingDiff,
        afterStatusPorcelain: preexistingStatus,
        afterDiffStat: preexistingDiff
      }),
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: FAILED/u);
  assert.match(captured.stdout, /no new changed files after the pre-OpenCode baseline/u);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff']);
  assert.deepEqual(events, ['git:show-ref', 'git:checkout', 'git:rev-parse', 'git:status', 'git:diff', 'dev-run', 'git:status', 'git:diff']);
  assert.equal(devRunner.calls.length, 1);
  assert.equal(qualityCalls, 0);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'FAILED');
  assert.equal(state.failure?.state, 'IMPLEMENTING');
  assert.equal(state.qualityReports.length, 0);
  assert.equal(state.meaningfulDiff?.decision, 'failed');
  assert.deepEqual(state.meaningfulDiff.baselineChangedFiles, ['src/preexisting.ts']);
  assert.deepEqual(state.meaningfulDiff.afterAgentChangedFiles, ['src/preexisting.ts']);
  assert.deepEqual(state.meaningfulDiff.newChangedFiles, []);
  assert.deepEqual(state.meaningfulDiff.productFiles, []);

  const meaningfulDiff = JSON.parse(await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'meaningful-diff.json'), 'utf8')) as DeliveryRunStateRecord['meaningfulDiff'];
  assert.deepEqual(meaningfulDiff?.baselineChangedFiles, ['src/preexisting.ts']);
  assert.deepEqual(meaningfulDiff?.newChangedFiles, []);
  const finalReport = await readFile(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'final-report.md'), 'utf8');
  assert.match(finalReport, /Baseline Changed Files: src\/preexisting\.ts/u);
  assert.match(finalReport, /Agent-New Changed Files: none/u);
  assert.match(finalReport, /Agent Product Changed Files: none/u);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md')));
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command fails before local checks when core safety finds a forbidden file', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  const events: string[] = [];
  const devRunner = createFakeDevRunner(events);
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({
        calls: gitCalls,
        events,
        afterStatusPorcelain: ' M .env.local\n',
        afterDiffStat: ' .env.local | 1 +\n 1 file changed, 1 insertion(+)',
        afterDiffPatch: diffPatch('.env.local', ['SAFE_PLACEHOLDER=1'])
      }),
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: FAILED/u);
  assert.match(captured.stdout, /Core Safety: FAIL/u);
  assert.equal(captured.stderr, '');
  assert.equal(qualityCalls, 0);
  assert.deepEqual(gitCalls.map((call) => call.args[0]), ['show-ref', 'checkout', 'rev-parse', 'status', 'diff', 'status', 'diff', 'status', 'diff']);
  assert.deepEqual(events, ['git:show-ref', 'git:checkout', 'git:rev-parse', 'git:status', 'git:diff', 'dev-run', 'git:status', 'git:diff', 'git:status', 'git:diff']);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'FAILED');
  assert.equal(state.coreSafety?.decision, 'fail');
  assert.deepEqual(state.coreSafety.forbiddenFiles.map((finding) => finding.filePath), ['.env.local']);
  assert.equal(state.qualityReports.length, 0);
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'quality-report.md')));
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command fails secret-like additions without persisting or printing raw values', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const rawSecret = 'super-secret-token-1234567890';
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({
        afterStatusPorcelain: '?? src/config.ts\n',
        afterDiffStat: ''
      }),
      readFile: async () => `const token = "${rawSecret}";\n`,
      devRunner: createFakeDevRunner(),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Core Safety: FAIL/u);
  assert.doesNotMatch(captured.stdout, new RegExp(rawSecret, 'u'));
  assert.doesNotMatch(captured.stderr, new RegExp(rawSecret, 'u'));
  assert.equal(qualityCalls, 0);

  const coreSafetyPath = join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'core-safety.json');
  const finalReportPath = join(rootPath, '.ewokbot', 'runs', 'AI-101', 'dev-run-1', 'final-report.md');
  const statePath = join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'));
  const coreSafety = await readFile(coreSafetyPath, 'utf8');
  const finalReport = await readFile(finalReportPath, 'utf8');
  const stateJson = await readFile(statePath, 'utf8');
  assert.doesNotMatch(coreSafety, new RegExp(rawSecret, 'u'));
  assert.doesNotMatch(finalReport, new RegExp(rawSecret, 'u'));
  assert.doesNotMatch(stateJson, new RegExp(rawSecret, 'u'));
  const state = JSON.parse(stateJson) as DeliveryRunStateRecord;
  assert.equal(state.coreSafety?.secretFindings.length, 1);
  assert.equal(state.qualityReports.length, 0);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command needs human before local checks when core safety changed-file limit is exceeded', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      coreSafetyLimits: { maxChangedFiles: 1, maxAddedLines: 50 },
      gitCommandRunner: createFakeGitRunner({
        afterStatusPorcelain: [' M src/a.ts', ' M src/b.ts', ''].join('\n'),
        afterDiffStat: ' src/a.ts | 1 +\n src/b.ts | 1 +\n 2 files changed, 2 insertions(+)',
        afterDiffPatch: [diffPatch('src/a.ts', ['export const a = 1;']), diffPatch('src/b.ts', ['export const b = 1;'])].join('\n')
      }),
      devRunner: createFakeDevRunner(),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Core Safety: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /Human Action Needed:/u);
  assert.equal(qualityCalls, 0);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'NEEDS_HUMAN');
  assert.equal(state.humanActionNeeded?.reason, state.coreSafety?.reason);
  assert.deepEqual(state.coreSafety?.limitFindings.map((finding) => finding.limit), ['maxChangedFiles']);
  assert.equal(state.qualityReports.length, 0);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command needs human before local checks for dependency lockfile changes', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  let qualityCalls = 0;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: createFakeGitRunner({
        afterStatusPorcelain: ' M pnpm-lock.yaml\n',
        afterDiffStat: ' pnpm-lock.yaml | 1 +\n 1 file changed, 1 insertion(+)',
        afterDiffPatch: diffPatch('pnpm-lock.yaml', ['lockfileVersion: 9.0'])
      }),
      devRunner: createFakeDevRunner(),
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /Final State: NEEDS_HUMAN/u);
  assert.match(captured.stdout, /dependency lockfile/i);
  assert.equal(qualityCalls, 0);

  const state = JSON.parse(await readFile(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1')), 'utf8')) as DeliveryRunStateRecord;
  assert.equal(state.state, 'NEEDS_HUMAN');
  assert.equal(state.coreSafety?.decision, 'needs_human');
  assert.deepEqual(state.coreSafety.humanReviewFindings.map((finding) => finding.category), ['dependency_lockfile']);
  assert.equal(state.qualityReports.length, 0);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

test('run-dev command refuses zero selected repositories before state, git, OpenCode, or quality', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('zero');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const devRunner = createFakeDevRunner();

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /requires exactly one selected repository/u);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assert.rejects(stat(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'))));
});

test('run-dev command refuses multiple selected repositories before state, git, OpenCode, or quality', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('multi'));
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('multi');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const devRunner = createFakeDevRunner();

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /planning selected 2/u);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assert.rejects(stat(join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'))));
});

test('run-dev command refuses existing run directory or state before local side effects', async (t) => {
  const rootPath = await createRunDevWorkspace(t, runDevWorkspaceYaml('single'));
  const runDirectoryPath = join(rootPath, getRunDirectoryPath('AI-101', 'dev-run-1'));
  const statePath = join(rootPath, getRunStateFilePath('AI-101', 'dev-run-1'));
  const existingState = '{"sentinel":"keep-existing-state"}\n';
  const captured = createCapturedIO();
  const clients = createRunDevMcpClients('single');
  const gitCalls: GitCommandInput[] = [];
  let qualityCalls = 0;
  const devRunner = createFakeDevRunner();

  await mkdir(runDirectoryPath, { recursive: true });
  await writeFile(statePath, existingState, 'utf8');

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    runtimeMcp: { mcpClients: clients },
    runDevDelivery: {
      now: fixedClock(),
      gitCommandRunner: async (input) => {
        gitCalls.push(input);
        return fakeGitResult(input);
      },
      devRunner,
      qualityRunner: async () => {
        qualityCalls += 1;
        return createPassedQualityReport(join(rootPath, 'frontend'));
      }
    }
  }).run(['node', 'ewokbot', 'run-dev', 'AI-101', '--confirm-dev-execution', '--run-id', 'dev-run-1']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /already exists/u);
  assert.equal(await readFile(statePath, 'utf8'), existingState);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(gitCalls, []);
  assert.equal(devRunner.calls.length, 0);
  assert.equal(qualityCalls, 0);
  await assertNoProviderHandoffFiles(rootPath, 'AI-101', 'dev-run-1');
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-run-dev-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

async function createRunDevWorkspace(t: TestContext, configYaml: string): Promise<string> {
  const rootPath = await createTempRoot(t);

  await mkdir(join(rootPath, '.ewokbot'), { recursive: true });
  await mkdir(join(rootPath, 'frontend'), { recursive: true });
  await mkdir(join(rootPath, 'api'), { recursive: true });
  await writeFile(join(rootPath, '.ewokbot', 'workspace.yml'), configYaml, 'utf8');
  await writeFile(join(rootPath, 'frontend', '.agent-quality.yml'), ['commands:', '  test: mock test', 'required:', '  - test', ''].join('\n'), 'utf8');
  await writeFile(join(rootPath, 'api', '.agent-quality.yml'), ['commands:', '  test: mock test', 'required:', '  - test', ''].join('\n'), 'utf8');

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
      stdout: (text) => {
        captured.stdout += text;
      },
      stderr: (text) => {
        captured.stderr += text;
      }
    }
  };
}

function createRunDevMcpClients(ticketShape: 'single' | 'zero' | 'multi'): Record<string, MockMcpClient> {
  return {
    atlassian: new MockMcpClient([
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [jiraIssue(ticketShape)] }, isError: false })),
      createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue(ticketShape) }, isError: false }))
    ]),
    github: new MockMcpClient([
      createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { headSha: 'github-head' } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: { pullRequest: { number: 1, url: 'https://github.example.test/pull/1', targetBranch: 'develop' } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, () => ({ content: { checks: { status: 'passed', totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 } }, isError: false })),
      createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: { ok: true }, isError: false }))
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
      return { content: { deployment: railwayDeployment() }, isError: false };
    }

    return { content: { ok: true }, isError: false };
  }));
}

function uniqueRailwayToolNames(): readonly string[] {
  return Array.from(new Set(Object.values(defaultRailwayMcpToolNames).filter((toolName) => toolName.trim().length > 0)));
}

function jiraIssue(ticketShape: 'single' | 'zero' | 'multi'): JsonObject {
  const labels = ticketShape === 'zero' ? ['unknown'] : ticketShape === 'multi' ? ['frontend', 'api'] : ['frontend'];
  const summary = ticketShape === 'zero' ? 'Unknown local path' : ticketShape === 'multi' ? 'Dev frontend and api local path' : 'Dev frontend local path';

  return {
    key: 'AI-101',
    fields: {
      summary,
      description: 'Implement the requested local-only development change.',
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels,
      created: '2026-06-05T00:00:00.000Z',
      updated: '2026-06-05T00:00:00.000Z'
    }
  };
}

function railwayDeployment(): JsonObject {
  return {
    ref: {
      projectId: 'project-1',
      serviceId: 'service-1',
      deploymentId: 'deployment-1',
      environment: 'staging'
    },
    status: 'success',
    branch: 'develop',
    commitSha: 'local-head',
    serviceUrl: 'https://frontend.example.test',
    startedAt: '2026-06-05T00:00:00.000Z',
    finishedAt: '2026-06-05T00:01:00.000Z',
    summary: 'Mock Railway deployment should not be called by run-dev.'
  };
}

function fakeGitResult(
  input: GitCommandInput,
  output: { readonly statusPorcelain?: string | undefined; readonly diffStat?: string | undefined; readonly diffPatch?: string | undefined } = {}
): GitCommandResult {
  if (input.args[0] === 'show-ref') {
    return { stdout: '', stderr: '', exitCode: 1 };
  }

  if (input.args[0] === 'rev-parse') {
    return { stdout: 'local-head\n', stderr: '', exitCode: 0 };
  }

  if (input.args[0] === 'status') {
    return { stdout: output.statusPorcelain ?? ' M src/app.ts\n', stderr: '', exitCode: 0 };
  }

  if (input.args[0] === 'diff') {
    if (input.args.includes('--unified=0')) {
      return { stdout: output.diffPatch ?? diffPatch('src/app.ts', ['export const changed = true;']), stderr: '', exitCode: 0 };
    }

    return { stdout: output.diffStat ?? ' src/app.ts | 1 +\n 1 file changed, 1 insertion(+)', stderr: '', exitCode: 0 };
  }

  return { stdout: '', stderr: '', exitCode: 0 };
}

function createFakeGitRunner(output: {
  readonly calls?: GitCommandInput[] | undefined;
  readonly events?: string[] | undefined;
  readonly baselineStatusPorcelain?: string | undefined;
  readonly baselineDiffStat?: string | undefined;
  readonly afterStatusPorcelain?: string | undefined;
  readonly afterDiffStat?: string | undefined;
  readonly afterDiffPatch?: string | undefined;
} = {}): (input: GitCommandInput) => Promise<GitCommandResult> {
  let statusCalls = 0;
  let diffCalls = 0;

  return async (input) => {
    output.calls?.push(input);
    output.events?.push(`git:${input.args[0] ?? 'unknown'}`);

    if (input.args[0] === 'status') {
      statusCalls += 1;
      const statusPorcelain = statusCalls === 1 ? output.baselineStatusPorcelain ?? '' : output.afterStatusPorcelain ?? ' M src/app.ts\n';
      return fakeGitResult(input, { statusPorcelain });
    }

    if (input.args[0] === 'diff') {
      if (input.args.includes('--unified=0')) {
        return fakeGitResult(input, { diffPatch: output.afterDiffPatch });
      }

      diffCalls += 1;
      const diffStat = diffCalls === 1 ? output.baselineDiffStat ?? '' : output.afterDiffStat ?? ' src/app.ts | 1 +\n 1 file changed, 1 insertion(+)';
      return fakeGitResult(input, { diffStat });
    }

    return fakeGitResult(input);
  };
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

function createFakeDevRunner(events?: string[], implementationLog?: string): DevRunner & { readonly calls: readonly DevRunInput[] } {
  const calls: DevRunInput[] = [];

  return {
    get calls() {
      return calls;
    },
    async run(input) {
      events?.push('dev-run');
      calls.push(input);
      await mkdir(dirname(input.implementationLogPath), { recursive: true });
      await writeFile(input.implementationLogPath, `# Implementation Log\n\n${input.prompt}\n\n${implementationLog ?? defaultCompletionLog()}\n`, 'utf8');

      return createPassedDevRun(input);
    }
  };
}

function defaultCompletionLog(): string {
  return completionLog({
    status: 'completed',
    changedFiles: 'src/app.ts, .env.local, src/config.ts, src/a.ts, src/b.ts, pnpm-lock.yaml',
    testsRun: 'mock test',
    knownLimits: 'none',
    blockers: 'none',
    backgroundAgents: 'none'
  });
}

function completionLog(input: {
  readonly status: 'completed' | 'blocked' | 'incomplete';
  readonly preface?: string | undefined;
  readonly changedFiles: string;
  readonly testsRun: string;
  readonly knownLimits: string;
  readonly blockers: string;
  readonly backgroundAgents: string;
}): string {
  return [
    '## Required Final Completion Summary',
    input.preface,
    `Status: ${input.status}`,
    `Changed files: ${input.changedFiles}`,
    `Tests run: ${input.testsRun}`,
    `Known limits: ${input.knownLimits}`,
    `Blockers: ${input.blockers}`,
    `Background agents: ${input.backgroundAgents}`,
    ''
  ].filter((line): line is string => line !== undefined).join('\n');
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

function createPassedQualityReport(repositoryPath: string, command = 'mock test', name = 'test'): QualityReport {
  return {
    status: 'passed',
    required: [
      {
        name,
        command,
        workingDirectory: repositoryPath,
        startedAt: '2026-06-05T00:00:00.000Z',
        finishedAt: '2026-06-05T00:00:01.000Z',
        durationMs: 1000,
        exitCode: 0,
        stdoutLogPath: '.ewokbot/runs/AI-101/dev-run-1/quality-logs/test.stdout.log',
        stderrLogPath: '.ewokbot/runs/AI-101/dev-run-1/quality-logs/test.stderr.log',
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

async function assertNoProviderHandoffFiles(rootPath: string, ticketKey: string, runId: string): Promise<void> {
  await assert.rejects(stat(join(rootPath, '.ewokbot', 'runs', ticketKey, runId, 'staging-report.md')));
  await assert.rejects(stat(join(rootPath, getOperationLedgerFilePath(ticketKey, runId))));
}

function runDevWorkspaceYaml(shape: 'single' | 'multi'): string {
  const apiRepository = shape === 'multi'
    ? [
        '  - name: api',
        '    url: https://github.com/agentic/api',
        '    local_path: ./api',
        '    default_branch: develop',
        '    production_branch: main',
        '    quality_profile: node',
        '    hints:',
        '      - api',
        '    staging_smoke_urls:',
        '      - /health'
      ].join('\n')
    : '';

  return `
workspace:
  name: Run Dev Test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AI
  mcp_server: atlassian
github:
  mode: mcp
  organization: agentic
  mcp_server: github
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
    display_name: Atlassian MCP
    url: https://mcp.example.test/atlassian
  github:
    display_name: GitHub MCP
    url: https://mcp.example.test/github
  railway:
    display_name: Railway MCP
    url: https://mcp.example.test/railway
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
${apiRepository}
`;
}
