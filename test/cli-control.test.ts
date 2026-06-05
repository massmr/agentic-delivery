import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  JsonRunStateStore,
  createCliProgram,
  createDeliveryRunStateRecord,
  getRunControlFilePath,
  getRunStateFilePath,
  getWorkspaceControlFilePath,
  transitionDeliveryRunState,
  type CliProgramIO,
  type DeliveryRunState,
  type DeliveryRunStateRecord,
  type QualityReport,
  type RepositoryRef,
  type TicketRef
} from '../src/index.js';

const ticket = {
  provider: 'jira',
  key: 'AD-301',
  url: 'https://jira.example.test/browse/AD-301'
} satisfies TicketRef;

const repository = {
  provider: 'github',
  owner: 'agentic',
  name: 'cli-control',
  defaultBranch: 'develop',
  url: 'https://github.com/agentic/cli-control'
} satisfies RepositoryRef;

const qualityReport = {
  status: 'passed',
  required: [
    {
      name: 'typecheck',
      command: 'pnpm typecheck',
      workingDirectory: '/workspace/cli-control',
      startedAt: '2026-06-04T11:00:00.000Z',
      finishedAt: '2026-06-04T11:00:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      stdoutLogPath: '.ewokbot/runs/AD-301/resume-run/quality-logs/typecheck.stdout.log',
      stderrLogPath: '.ewokbot/runs/AD-301/resume-run/quality-logs/typecheck.stderr.log',
      status: 'passed',
      summary: 'TypeScript passed.'
    }
  ],
  optional: []
} satisfies QualityReport;

test('ewokbot runs and inspect read persisted local state only', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunStateStore(rootPath);
  const listCaptured = createCapturedIO();
  const inspectCaptured = createCapturedIO();

  await store.write(createState('PLANNED', 'resume-run'));

  const listExit = await createCliProgram({ cwd: rootPath, io: listCaptured.io }).run(['node', 'ewokbot', 'runs']);
  const inspectExit = await createCliProgram({ cwd: rootPath, io: inspectCaptured.io }).run(['node', 'ewokbot', 'inspect', 'resume-run']);

  assert.equal(listExit, 0);
  assert.match(listCaptured.stdout, /resume-run \| AD-301 \| PLANNED/u);
  assert.equal(listCaptured.stderr, '');
  assert.equal(inspectExit, 0);
  assert.match(inspectCaptured.stdout, /Run ID: resume-run/u);
  assert.match(inspectCaptured.stdout, /Run Directory: .ewokbot\/runs\/AD-301\/resume-run/u);
  assert.match(inspectCaptured.stdout, /Human-only Production Note/u);
});

test('ewokbot pause is idempotent and ewokbot resume records intent then clears pause', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunStateStore(rootPath);
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: rootPath, io: captured.io });

  await store.write(createState('STAGING_VERIFIED', 'resume-run'));

  assert.equal(await program.run(['node', 'ewokbot', 'pause']), 0);
  assert.equal(await program.run(['node', 'ewokbot', 'pause']), 0);
  assert.match(captured.stdout, /Workspace paused: true/u);
  assert.equal((JSON.parse(readFileSync(join(rootPath, getWorkspaceControlFilePath()), 'utf8')) as { readonly paused: boolean }).paused, true);

  assert.equal(await program.run(['node', 'ewokbot', 'resume', 'resume-run']), 0);
  assert.match(captured.stdout, /Resume intent recorded for AD-301\/resume-run/u);
  assert.match(captured.stdout, /No provider, OpenCode, git, pull request, merge, deployment, or production side effects were performed/u);
  assert.equal((JSON.parse(readFileSync(join(rootPath, getWorkspaceControlFilePath()), 'utf8')) as { readonly paused: boolean }).paused, false);
  assert.equal(
    (JSON.parse(readFileSync(join(rootPath, getRunControlFilePath(ticket.key, 'resume-run')), 'utf8')) as { readonly resume: { readonly state: string } }).resume.state,
    'STAGING_VERIFIED'
  );
});

test('ewokbot resume rejects non-resumable states without writing resume intent', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunStateStore(rootPath);
  const captured = createCapturedIO();

  await store.write(createState('FAILED', 'failed-run'));

  const exitCode = await createCliProgram({ cwd: rootPath, io: captured.io }).run(['node', 'ewokbot', 'resume', 'failed-run']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /cannot resume automatically from FAILED/u);
});

test('ewokbot approve and reject only write local decisions for production PR state', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunStateStore(rootPath);
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: rootPath, io: captured.io });

  await store.write(createState('PRODUCTION_PR_OPENED', 'production-run'));
  await store.write(createState('STAGING_VERIFIED', 'not-production-run'));
  const beforeState = readFileSync(join(rootPath, getRunStateFilePath(ticket.key, 'production-run')), 'utf8');

  assert.equal(await program.run(['node', 'ewokbot', 'approve', 'production-run']), 0);
  assert.match(captured.stdout, /Production decision recorded locally.*approved/u);
  assert.match(captured.stdout, /No merge, production deployment, provider call, OpenCode run, git push, or MCP\/network side effect was performed/u);
  assert.equal(readFileSync(join(rootPath, getRunStateFilePath(ticket.key, 'production-run')), 'utf8'), beforeState);
  assert.equal(
    (JSON.parse(readFileSync(join(rootPath, getRunControlFilePath(ticket.key, 'production-run')), 'utf8')) as { readonly decision: { readonly decision: string } }).decision.decision,
    'approved'
  );

  assert.equal(await program.run(['node', 'ewokbot', 'reject', 'production-run']), 0);
  assert.equal(
    (JSON.parse(readFileSync(join(rootPath, getRunControlFilePath(ticket.key, 'production-run')), 'utf8')) as { readonly decision: { readonly decision: string } }).decision.decision,
    'rejected'
  );

  const blocked = createCapturedIO();
  assert.equal(await createCliProgram({ cwd: rootPath, io: blocked.io }).run(['node', 'ewokbot', 'approve', 'not-production-run']), 1);
  assert.match(blocked.stderr, /must be in PRODUCTION_PR_OPENED/u);
});

test('ewokbot logs prints known reports, missing markers, and quality stdout stderr logs', async () => {
  const rootPath = createTempRoot();
  const store = new JsonRunStateStore(rootPath);
  const captured = createCapturedIO();

  await store.write(createState('LOCAL_CHECKS_PASSED', 'resume-run'));
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'resume-run', 'plan.md'), 'Plan body\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'resume-run', 'quality-report.md'), 'Quality body\n', 'utf8');
  mkdirSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'resume-run', 'quality-logs'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'resume-run', 'quality-logs', 'typecheck.stdout.log'), 'typecheck stdout\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', ticket.key, 'resume-run', 'quality-logs', 'typecheck.stderr.log'), 'typecheck stderr\n', 'utf8');

  const exitCode = await createCliProgram({ cwd: rootPath, io: captured.io }).run(['node', 'ewokbot', 'logs', 'resume-run']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /# Run Logs resume-run/u);
  assert.match(captured.stdout, /Plan body/u);
  assert.match(captured.stdout, /## Implementation Log/u);
  assert.match(captured.stdout, /not found/u);
  assert.match(captured.stdout, /typecheck stdout/u);
  assert.match(captured.stdout, /typecheck stderr/u);
});

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agentic-cli-control-'));
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

function createState(state: DeliveryRunState, runId: string): DeliveryRunStateRecord {
  const timestamp = '2026-06-04T11:00:00.000Z';
  const initial = createDeliveryRunStateRecord({
    runId,
    ticket,
    targetRepositories: [repository],
    timestamps: { createdAt: timestamp, updatedAt: timestamp },
    ticketAnalysis: { ticketKey: ticket.key, goal: 'Control CLI', requirements: [], constraints: ['Local only.'], risks: [] }
  });

  return {
    ...transitionDeliveryRunState(initial, state, timestamp),
    qualityReports: runId === 'resume-run' ? [qualityReport] : []
  };
}
