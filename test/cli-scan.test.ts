import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  McpToolNotFoundError,
  MockMcpClient,
  RuntimeMcpClientResolutionError,
  createCliProgram,
  createMockMcpTool,
  defaultJiraMcpToolNames,
  type McpToolCallAuditRecord
} from '../src/index.js';

test('agentic scan lists mock Jira backlog tickets', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ configPath: 'config/workspace.example.yml', io: captured.io }).run(['node', 'agentic', 'scan']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Found 2 Jira backlog tickets/u);
  assert.match(captured.stdout, /LK-101/u);
  assert.match(captured.stdout, /LK-102/u);
  assert.equal(captured.stderr, '');
});

test('agentic scan lists Jira MCP backlog tickets when runtime clients are injected', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = createJiraMcpClient([{ key: 'AD-701', summary: 'Read backlog through Jira MCP' }]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: 'config/workspace.yml',
    io: captured.io,
    runtimeMcp: {
      mcpClients: { atlassian: client },
      mcpAuditSink: (records) => auditRecords.push(...records)
    }
  }).run(['node', 'agentic', 'scan']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Found 1 Jira backlog tickets/u);
  assert.match(captured.stdout, /AD-701/u);
  assert.match(captured.stdout, /Read backlog through Jira MCP/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(client.listToolRequests, [{ serverId: 'atlassian' }, { serverId: 'atlassian' }]);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.listBacklog]);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}:${record.status}`), [
    'TicketPort.listBacklog:started',
    'TicketPort.listBacklog:succeeded'
  ]);
});

test('agentic scan surfaces empty Jira MCP backlog without side effects', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const client = createJiraMcpClient([]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: 'config/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'agentic', 'scan']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Found 0 Jira backlog tickets/u);
  assert.equal(client.toolCallRequests.length, 1);
  assert.equal(captured.stderr, '');
});

test('agentic scan fails Jira MCP readiness before falling back to mock or REST', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();

  await assert.rejects(
    () => createCliProgram({ cwd: rootPath, configPath: 'config/workspace.yml', io: captured.io }).run(['node', 'agentic', 'scan']),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpClientResolutionError);
      assert.equal(error.provider, 'Jira');
      assert.equal(error.serverId, 'atlassian');
      return true;
    }
  );
  assert.equal(captured.stdout, '');

  const client = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue('AD-702', 'Get only') }, isError: false })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);

  await assert.rejects(
    () => createCliProgram({
      cwd: rootPath,
      configPath: 'config/workspace.yml',
      io: captured.io,
      runtimeMcp: { mcpClients: { atlassian: client } }
    }).run(['node', 'agentic', 'scan']),
    (error: unknown) => {
      assert.ok(error instanceof McpToolNotFoundError);
      assert.equal(error.serverId, 'atlassian');
      assert.equal(error.toolName, defaultJiraMcpToolNames.listBacklog);
      return true;
    }
  );
  assert.deepEqual(client.toolCallRequests, []);
});

test('agentic scan surfaces inaccessible Jira MCP projects without fallback side effects', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const client = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({
      content: 'Jira project AD is not accessible to this MCP session.',
      isError: true
    })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue('AD-703', 'Unavailable') }, isError: false })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);

  await assert.rejects(
    () => createCliProgram({
      cwd: rootPath,
      configPath: 'config/workspace.yml',
      io: captured.io,
      runtimeMcp: { mcpClients: { atlassian: client } }
    }).run(['node', 'agentic', 'scan']),
    /Jira project AD is not accessible/u
  );

  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.listBacklog]);
  assert.equal(captured.stdout, '');
  assert.equal(captured.stderr, '');
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

function createWorkspaceRoot(config: string): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-scan-'));
  mkdirSync(join(rootPath, 'config'));
  writeFileSync(join(rootPath, 'config/workspace.yml'), config);
  return rootPath;
}

function createJiraMcpClient(issues: readonly { readonly key: string; readonly summary: string }[]): MockMcpClient {
  return new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, () => ({
      content: { issues: issues.map((issue) => jiraIssue(issue.key, issue.summary)) },
      isError: false
    })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, (input) => ({
      content: { issue: jiraIssue(String(input.arguments.issueKey), 'Fetched Jira MCP issue') },
      isError: false
    })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);
}

function jiraIssue(key: string, summary: string) {
  return {
    key,
    fields: {
      summary,
      description: 'MCP intake test issue.',
      status: { name: 'To Do' },
      priority: { name: 'High' },
      labels: ['mcp'],
      created: '2026-06-04T10:00:00.000Z',
      updated: '2026-06-04T10:05:00.000Z'
    }
  };
}

function workspaceWithJiraMcp(): string {
  return `
workspace:
  name: scan-test
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
  - name: frontend
    url: https://github.com/agentic/frontend
    local_path: ./worktrees/frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
`;
}
