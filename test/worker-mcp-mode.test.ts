import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  McpToolNotFoundError,
  MockMcpClient,
  RuntimeMcpClientResolutionError,
  RuntimeMcpUnsupportedTransportError,
  createAgentWorkerRuntimeInfo,
  createCliProgram,
  createMockMcpTool,
  createPublicCliRuntimeMcp,
  defaultGitHubMcpToolNames,
  defaultJiraMcpToolNames,
  defaultRailwayMcpToolNames,
  type JsonObject,
  parseWorkspaceConfig,
  type CliProgramIO,
  type McpToolCallAuditRecord,
  getWorkerLockPath
} from '../src/index.js';

test('agentic worker runs explicit MCP mode with injected clients after provider readiness checks', async () => {
  const rootPath = createWorkspaceRoot(workerMcpConfigYaml);
  const clients = createWorkerMcpClients();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: {
      mcpClients: clients,
      mcpAuditSink: (records) => auditRecords.push(...records)
    }
  }).run(['node', 'agentic', 'worker', '--concurrency', '2', '--max-cycles', '1', '--max-attempts', '1']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Worker Mode: mcp/u);
  assert.match(captured.stdout, /Intake Mode: mcp/u);
  assert.match(captured.stdout, /Provider Modes: Jira=mcp, GitHub=mcp, Railway=mcp/u);
  assert.match(captured.stdout, /Queued: 1/u);
  assert.match(captured.stdout, /Succeeded: 1/u);
  assert.equal(captured.stderr, '');

  assert.deepEqual(clients.atlassian.listToolRequests, [{ serverId: 'atlassian' }, { serverId: 'atlassian' }, { serverId: 'atlassian' }]);
  assert.deepEqual(clients.github.listToolRequests, [{ serverId: 'github' }]);
  assert.deepEqual(clients.railway.listToolRequests, [{ serverId: 'railway' }]);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [
    defaultJiraMcpToolNames.listBacklog,
    defaultJiraMcpToolNames.getTicket
  ]);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}:${record.status}`), [
    'TicketPort.listBacklog:started',
    'TicketPort.listBacklog:succeeded',
    'TicketPort.getTicket:started',
    'TicketPort.getTicket:succeeded'
  ]);
});

test('agentic worker refuses MCP mode before queue side effects when a runtime client is missing', async () => {
  const rootPath = createWorkspaceRoot(workerMcpConfigYaml);
  const captured = createCapturedIO();

  await assert.rejects(
    () =>
      createCliProgram({ cwd: rootPath, configPath: '.ewokbot/workspace.yml', io: captured.io }).run([
        'node',
        'agentic',
        'worker',
        '--max-cycles',
        '1'
      ]),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpClientResolutionError);
      assert.equal(error.provider, 'Jira');
      assert.equal(error.serverId, 'atlassian');
      return true;
    }
  );

  assert.equal(captured.stdout, '');
  assert.equal(captured.stderr, '');
});

test('agentic worker start rejects unsupported public MCP transport before lock side effects', async () => {
  const rootPath = createWorkspaceRoot(workerMcpConfigYaml);
  const captured = createCapturedIO();
  const runtime = createPublicCliRuntimeMcp();

  await assert.rejects(
    () =>
      createCliProgram({
        cwd: rootPath,
        configPath: '.ewokbot/workspace.yml',
        io: captured.io,
        runtimeMcp: runtime.runtimeMcp
      }).run(['node', 'agentic', 'worker', 'start', '--once']),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpUnsupportedTransportError);
      assert.equal(error.serverId, 'atlassian');
      return true;
    }
  );

  assert.equal(captured.stdout, '');
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(getWorkerLockPath(rootPath)), false);
});

test('agentic worker refuses MCP mode before tool calls when a required provider tool is missing', async () => {
  const rootPath = createWorkspaceRoot(workerMcpConfigYaml);
  const clients = createWorkerMcpClients({ omitGitHubCreateBranch: true });
  const captured = createCapturedIO();

  await assert.rejects(
    () =>
      createCliProgram({
        cwd: rootPath,
        configPath: '.ewokbot/workspace.yml',
        io: captured.io,
        runtimeMcp: { mcpClients: clients }
      }).run(['node', 'agentic', 'worker', '--max-cycles', '1']),
    (error: unknown) => {
      assert.ok(error instanceof McpToolNotFoundError);
      assert.equal(error.serverId, 'github');
      assert.equal(error.toolName, defaultGitHubMcpToolNames.createBranch);
      return true;
    }
  );

  assert.equal(captured.stdout, '');
  assert.equal(captured.stderr, '');
  assert.deepEqual(clients.atlassian.toolCallRequests, []);
  assert.deepEqual(clients.github.toolCallRequests, []);
  assert.deepEqual(clients.railway.toolCallRequests, []);
});

test('agent worker runtime info rejects real provider modes for Milestone W', () => {
  const config = parseWorkspaceConfig(workerMcpConfigYaml.replace('github:\n  mode: mcp', 'github:\n  mode: real'));

  assert.throws(() => createAgentWorkerRuntimeInfo(config), /GitHub worker mode supports mock or explicit MCP providers only/u);
});

function createWorkspaceRoot(configYaml: string): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-worker-mcp-'));
  mkdirSync(join(rootPath, '.ewokbot'));
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), configYaml, 'utf8');
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

function createWorkerMcpClients(options: { readonly omitGitHubCreateBranch?: boolean } = {}): Record<string, MockMcpClient> {
  const atlassian = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({
      content: { issues: [jiraIssue('AD-501', 'Add frontend worker MCP mode')] },
      isError: false
    })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({
      content: { issue: jiraIssue('AD-501', 'Detailed frontend worker MCP mode') },
      isError: false
    })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);
  const githubTools = [
    ...(options.omitGitHubCreateBranch
      ? []
      : [createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { headSha: 'mcp-worker-sha' } }, isError: false }))]),
    createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({
      content: { pullRequest: { number: 501, url: 'https://github.example.test/pr/501' } },
      isError: false
    })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, () => ({ content: { checks: [] }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: { ok: true }, isError: false }))
  ];
  const github = new MockMcpClient(githubTools);
  const railway = new MockMcpClient(uniqueRailwayToolNames().map((toolName) => createMockMcpTool('railway', toolName, () => ({ content: { ok: true }, isError: false }))));

  return { atlassian, github, railway };
}

function uniqueRailwayToolNames(): readonly string[] {
  return Array.from(new Set(Object.values(defaultRailwayMcpToolNames).filter((toolName) => toolName.trim().length > 0)));
}

function jiraIssue(key: string, summary: string): JsonObject {
  return {
    key,
    fields: {
      summary,
      description: 'Mock worker MCP mode ticket for frontend delivery.',
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels: ['frontend'],
      created: '2026-06-04T00:00:00.000Z',
      updated: '2026-06-04T00:00:00.000Z'
    }
  };
}

const workerMcpConfigYaml = `
workspace:
  name: Worker MCP Test
  autonomy: full_until_production_pr
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
  max_attempts: 2
quality:
  default_profile: node
mcp_policy:
  mode: trusted
  tools:
    ${defaultGitHubMcpToolNames.openPullRequest}:
      decision: allow
      reason: Opening a staging pull request is allowed by the worker MCP fixture.
    ${defaultRailwayMcpToolNames.waitForDeployment}:
      decision: allow
      reason: Waiting for a staging deployment is allowed by the worker MCP fixture.
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
    staging_smoke_urls: []
`;
