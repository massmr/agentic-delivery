import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockJiraConnector,
  createTicketPlan,
  loadWorkspaceConfig,
  renderTicketPlanMarkdown,
  type DeliveryTicket
} from '../src/index.js';

async function createTempRunRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-planning-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

test('MockJiraConnector lists deterministic backlog tickets from config', async () => {
  const config = await loadWorkspaceConfig('config/workspace.example.yml');
  const tickets = await new MockJiraConnector(config).listBacklog();

  assert.equal(tickets.length, 2);
  assert.equal(tickets[0]?.ref.key, 'LK-101');
  assert.equal(tickets[1]?.ref.key, 'LK-102');
});

test('createTicketPlan selects repositories using configured hints', async () => {
  const config = await loadWorkspaceConfig('config/workspace.example.yml');
  const ticket = await new MockJiraConnector(config).getTicket('LK-102');
  const plan = createTicketPlan(ticket, config);

  assert.equal(plan.needsHuman, false);
  assert.equal(plan.selectedRepositories[0]?.name, 'api');
  assert.match(plan.repositoryMatches[0]?.reasoning ?? '', /Matched hints/u);
});

test('createTicketPlan requests human input when no repository is confident', async () => {
  const config = await loadWorkspaceConfig('config/workspace.example.yml');
  const ticket = {
    ref: {
      provider: 'jira',
      key: 'LK-999',
      url: 'https://your-domain.atlassian.net/browse/LK-999'
    },
    summary: 'Write a legal memo',
    description: 'Prepare a legal memo unrelated to product code.',
    status: 'To Do',
    priority: 'low',
    labels: ['legal'],
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt: '2026-06-03T08:00:00.000Z'
  } satisfies DeliveryTicket;
  const plan = createTicketPlan(ticket, config);

  assert.equal(plan.needsHuman, true);
  assert.deepEqual(plan.selectedRepositories, []);
  assert.match(plan.humanReason ?? '', /No repository matched/u);
});

test('renderTicketPlanMarkdown includes status, selected repository, and risk notes', async () => {
  const config = await loadWorkspaceConfig('config/workspace.example.yml');
  const ticket = await new MockJiraConnector(config).getTicket('LK-102');
  const plan = createTicketPlan(ticket, config);
  const markdown = renderTicketPlanMarkdown('run-1', plan);

  assert.match(markdown, /# Plan LK-102/u);
  assert.match(markdown, /Status: PLANNED/u);
  assert.match(markdown, /your-org\/api/u);
  assert.match(markdown, /High priority ticket/u);
});

test('agentic plan creates a run state and plan report in mock mode', async (t) => {
  const workspaceDir = await createTempRunRoot(t);
  const captured = createCapturedIO();
  const exitCode = await (await import('../src/index.js')).createCliProgram({
    cwd: workspaceDir,
    configPath: join(process.cwd(), 'config/workspace.example.yml'),
    io: captured.io
  }).run(['node', 'agentic', 'plan', 'LK-101']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Planned LK-101/u);
  assert.match(captured.stdout, /Report: runs\/LK-101\/LK-101-/u);

  const reportMatch = /Report: (runs\/LK-101\/[^/]+\/plan\.md)/u.exec(captured.stdout);
  assert.notEqual(reportMatch, null);

  const report = await readFile(join(workspaceDir, reportMatch?.[1] ?? ''), 'utf8');
  assert.match(report, /# Plan LK-101/u);
  assert.match(report, /your-org\/frontend/u);
});

function createCapturedIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout(text: string) {
        stdout += text;
      },
      stderr(text: string) {
        stderr += text;
      }
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}
