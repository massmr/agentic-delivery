import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MockJiraConnector,
  MockMcpClient,
  createCliProgram,
  createMockMcpTool,
  createTicketPlan,
  defaultJiraMcpToolNames,
  getRunDirectoryPath,
  getRunStateFilePath,
  loadWorkspaceConfig,
  renderTicketPlanMarkdown,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type McpToolCallAuditRecord
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

test('createTicketPlan selects discovered sibling repositories using folder hints', async (t) => {
  const workspaceDir = await createTempRunRoot(t);
  await mkdir(join(workspaceDir, '.ewokbot'), { recursive: true });
  await mkdir(join(workspaceDir, 'api', '.git'), { recursive: true });
  await writeFile(join(workspaceDir, '.ewokbot', 'workspace.yml'), discoveryWorkspaceConfig(), 'utf8');
  const config = await loadWorkspaceConfig(join(workspaceDir, '.ewokbot', 'workspace.yml'), { workspaceRoot: workspaceDir });
  const ticket = {
    ref: {
      provider: 'jira',
      key: 'LK-200',
      url: 'https://your-domain.atlassian.net/browse/LK-200'
    },
    summary: 'Update API endpoint validation',
    description: 'The api service should validate the new endpoint payload.',
    status: 'To Do',
    priority: 'medium',
    labels: ['api'],
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt: '2026-06-03T08:00:00.000Z'
  } satisfies DeliveryTicket;

  const plan = createTicketPlan(ticket, config);

  assert.equal(plan.needsHuman, false);
  assert.equal(plan.selectedRepositories[0]?.name, 'api');
  assert.equal(config.repos[0]?.localPath, './api');
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
  assert.match(captured.stdout, /Report: .ewokbot\/runs\/LK-101\/LK-101-/u);

  const reportMatch = /Report: (.ewokbot\/runs\/LK-101\/[^/]+\/plan\.md)/u.exec(captured.stdout);
  assert.notEqual(reportMatch, null);

  const report = await readFile(join(workspaceDir, reportMatch?.[1] ?? ''), 'utf8');
  assert.match(report, /# Plan LK-101/u);
  assert.match(report, /your-org\/frontend/u);
});

test('agentic plan reads one Jira MCP ticket and writes only dry-run planning evidence', async (t) => {
  const workspaceDir = await createTempRunRoot(t);
  await mkdir(join(workspaceDir, '.ewokbot'), { recursive: true });
  await mkdir(join(workspaceDir, 'api', '.git'), { recursive: true });
  await mkdir(join(workspaceDir, 'frontend', '.git'), { recursive: true });
  await writeFile(join(workspaceDir, '.ewokbot', 'workspace.yml'), discoveryJiraMcpWorkspaceConfig(), 'utf8');

  const captured = createCapturedIO();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = createPlanningJiraMcpClient('AD-801', 'Improve api request validation', ['api']);
  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: {
      mcpClients: { atlassian: client },
      mcpAuditSink: (records) => auditRecords.push(...records)
    }
  }).run(['node', 'ewokbot', 'plan', 'AD-801']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Dry Run: planning only/u);
  assert.match(captured.stdout, /no branch, OpenCode, package scripts, operation ledger, GitHub, Railway\/Vercel, PR, deployment, production merge, or production deploy/u);
  assert.match(captured.stdout, /Planned AD-801/u);
  assert.match(captured.stdout, /Selected repositories: api/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(client.listToolRequests.map((request) => request.serverId), ['atlassian', 'atlassian']);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.equal(client.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.listBacklog), false);
  assert.equal(client.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.comment), false);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}:${record.status}`), [
    'TicketPort.getTicket:started',
    'TicketPort.getTicket:succeeded'
  ]);

  const reportMatch = /Report: (.ewokbot\/runs\/AD-801\/[^/]+\/plan\.md)/u.exec(captured.stdout);
  assert.notEqual(reportMatch, null);
  const reportPath = reportMatch?.[1] ?? '';
  const runId = reportPath.split('/').at(-2) ?? '';
  const runDirectory = join(workspaceDir, getRunDirectoryPath('AD-801', runId));
  const report = await readFile(join(workspaceDir, reportPath), 'utf8');
  const state = JSON.parse(await readFile(join(workspaceDir, getRunStateFilePath('AD-801', runId)), 'utf8')) as DeliveryRunStateRecord;

  assert.match(report, /## Dry Run Boundary/u);
  assert.match(report, /No branch creation, OpenCode execution, package scripts, operation ledger, GitHub, Railway\/Vercel, pull request, deployment, production merge, or production deploy is performed/u);
  assert.match(report, /agentic\/api/u);
  assert.equal(state.state, 'PLANNED');
  assert.deepEqual(state.targetRepositories.map((repository) => repository.name), ['api']);
  assert.deepEqual(state.branches, []);
  assert.deepEqual(state.pullRequests, []);
  assert.deepEqual(state.stagingDeployments, []);
  assert.deepEqual(state.qualityReports, []);
  assert.deepEqual(state.devRuns, []);
  assert.deepEqual((await readdir(runDirectory)).sort(), ['plan.md', 'state.json']);
  await assert.rejects(stat(join(runDirectory, 'operation-ledger.json')));
  await assert.rejects(stat(join(runDirectory, 'quality-logs')));
});

test('agentic plan fails missing Jira MCP get ticket readiness before writing run evidence', async (t) => {
  const workspaceDir = await createTempRunRoot(t);
  await mkdir(join(workspaceDir, '.ewokbot'), { recursive: true });
  await mkdir(join(workspaceDir, 'api', '.git'), { recursive: true });
  await writeFile(join(workspaceDir, '.ewokbot', 'workspace.yml'), discoveryJiraMcpWorkspaceConfig(), 'utf8');

  const captured = createCapturedIO();
  const client = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({ content: { issues: [] }, isError: false })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'ewokbot', 'plan', 'AD-802']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Plan preflight failed before writing run state or planning evidence/u);
  assert.match(captured.stderr, /missing required Atlassian MCP Jira work-item tool/u);
  assert.match(captured.stderr, /atlassian/u);
  assert.match(captured.stderr, new RegExp(defaultJiraMcpToolNames.getTicket, 'u'));
  assert.match(captured.stderr, /No run state, branch, OpenCode, package script, operation ledger, GitHub, Railway\/Vercel, PR, deployment, production merge, or production deploy was started/u);
  assert.deepEqual(client.toolCallRequests, []);
  await assert.rejects(stat(join(workspaceDir, '.ewokbot', 'runs')));
});

test('agentic plan succeeds when Jira MCP exposes only get ticket for planning', async (t) => {
  const workspaceDir = await createTempRunRoot(t);
  await mkdir(join(workspaceDir, '.ewokbot'), { recursive: true });
  await mkdir(join(workspaceDir, 'api', '.git'), { recursive: true });
  await writeFile(join(workspaceDir, '.ewokbot', 'workspace.yml'), discoveryJiraMcpWorkspaceConfig(), 'utf8');

  const captured = createCapturedIO();
  const client = createPlanningJiraMcpClient('AD-803', 'Improve api request validation', ['api']);
  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'ewokbot', 'plan', 'AD-803']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Planned AD-803/u);
  assert.match(captured.stdout, /Selected repositories: api/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(client.listToolRequests.map((request) => request.serverId), ['atlassian', 'atlassian']);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  assert.equal(client.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.listBacklog), false);
  assert.equal(client.toolCallRequests.some((call) => call.toolName === defaultJiraMcpToolNames.comment), false);
});

test('agentic plan reports Jira MCP ticket read failures before writing run evidence', async (t) => {
  const workspaceDir = await createTempRunRoot(t);
  await mkdir(join(workspaceDir, '.ewokbot'), { recursive: true });
  await mkdir(join(workspaceDir, 'api', '.git'), { recursive: true });
  await writeFile(join(workspaceDir, '.ewokbot', 'workspace.yml'), discoveryJiraMcpWorkspaceConfig(), 'utf8');

  const captured = createCapturedIO();
  const client = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: 'Unauthorized Jira MCP session expired.', isError: true }))
  ]);
  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'ewokbot', 'plan', 'AD-804']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Plan preflight failed before writing run state or planning evidence/u);
  assert.match(captured.stderr, /unable to read Jira work item AD-804/u);
  assert.match(captured.stderr, /Unauthorized Jira MCP session expired/u);
  assert.match(captured.stderr, /fix .*MCP auth\/session/u);
  assert.match(captured.stderr, /No run state, branch, OpenCode, package script, operation ledger, GitHub, Railway\/Vercel, PR, deployment, production merge, or production deploy was started/u);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.getTicket]);
  await assert.rejects(stat(join(workspaceDir, '.ewokbot', 'runs')));
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

function discoveryWorkspaceConfig(): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - LK
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
repos:
  discovery: sibling-git-directories
  exclude: []
`;
}

function discoveryJiraMcpWorkspaceConfig(): string {
  return `
workspace:
  name: planning-test
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AD
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
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  atlassian:
    display_name: Atlassian MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.example.test/atlassian
repos:
  discovery: sibling-git-directories
  exclude: []
`;
}

function createPlanningJiraMcpClient(key: string, summary: string, labels: readonly string[]): MockMcpClient {
  return new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, (input) => ({
      content: { issue: jiraIssue(String(input.arguments.issueKey), summary, labels) },
      isError: false
    }))
  ]);
}

function jiraIssue(key: string, summary: string, labels: readonly string[]) {
  return {
    key,
    fields: {
      summary,
      description: `${summary}.`,
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels,
      created: '2026-06-04T10:00:00.000Z',
      updated: '2026-06-04T10:05:00.000Z'
    }
  };
}
