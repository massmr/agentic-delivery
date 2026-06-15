import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  McpToolNotFoundError,
  MockMcpClient,
  RuntimeMcpClientResolutionError,
  createPublicCliRuntimeMcp,
  createCliProgram,
  createMockMcpTool,
  defaultJiraMcpToolNames,
  type McpToolCallAuditRecord,
  type RuntimeMcpSdkClient,
  type RuntimeMcpSdkTransport
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
    configPath: '.ewokbot/workspace.yml',
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

test('agentic scan jql passes the provided query through Jira MCP', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const client = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, (input) => {
      assert.equal(input.arguments.jql, 'project = AD ORDER BY Rank ASC');
      return {
        content: { issues: [jiraIssue('AD-720', 'Run arbitrary Jira JQL through Ewokbot')] },
        isError: false
      };
    }),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, () => ({ content: { issue: jiraIssue('AD-720', 'unused') }, isError: false })),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'agentic', 'scan', 'jql', 'project = AD ORDER BY Rank ASC']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Found 1 Jira tickets for JQL/u);
  assert.match(captured.stdout, /AD-720/u);
});

test('agentic scan ticket shows child and blocking tickets through obvious Jira JQL variants', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const calls: string[] = [];
  const issueMap = new Map<string, readonly ReturnType<typeof jiraIssue>[]>([
    ['"Epic Link" = KK-80 ORDER BY Rank ASC', [jiraIssue('KK-81', 'Epic child task')]],
    ['parent = KK-80 ORDER BY Rank ASC', [jiraIssue('KK-81', 'Epic child task')]],
    ['"Parent Link" = KK-80 ORDER BY Rank ASC', []],
    ['issue in linkedIssues("KK-80", "is blocked by") ORDER BY updated DESC', [jiraIssue('KK-90', 'Blocking dependency')]],
    ['issue in linkedIssues("KK-80", "blocks") ORDER BY updated DESC', []],
    ['issue in linkedIssues("KK-80") ORDER BY updated DESC', [jiraIssue('KK-90', 'Blocking dependency')]]
  ]);
  const client = new MockMcpClient([
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.listBacklog, (input) => {
      const jql = String(input.arguments.jql);
      calls.push(jql);
      return {
        content: { issues: issueMap.get(jql) ?? [] },
        isError: false
      };
    }),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.getTicket, (input) => {
      assert.equal(input.arguments.issueKey, 'KK-80');
      return { content: { issue: jiraIssue('KK-80', 'Parent work item') }, isError: false };
    }),
    createMockMcpTool('atlassian', defaultJiraMcpToolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'agentic', 'scan', 'ticket', 'KK-80']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Jira ticket: KK-80/u);
  assert.match(captured.stdout, /Children \(1\):/u);
  assert.match(captured.stdout, /KK-81/u);
  assert.match(captured.stdout, /Potential blockers \(1\):/u);
  assert.match(captured.stdout, /KK-90/u);
  assert.deepEqual(calls, [
    '"Epic Link" = KK-80 ORDER BY Rank ASC',
    'parent = KK-80 ORDER BY Rank ASC',
    '"Parent Link" = KK-80 ORDER BY Rank ASC',
    'issue in linkedIssues("KK-80", "is blocked by") ORDER BY updated DESC',
    'issue in linkedIssues("KK-80", "blocks") ORDER BY updated DESC',
    'issue in linkedIssues("KK-80") ORDER BY updated DESC'
  ]);
});

test('agentic scan reads Jira MCP from discovered parent workspace without run evidence', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcpDiscovery());
  mkdirSync(join(rootPath, 'api', '.git'), { recursive: true });
  mkdirSync(join(rootPath, 'frontend', '.git'), { recursive: true });
  const captured = createCapturedIO();
  const client = createJiraMcpClient([{ key: 'AD-705', summary: 'Scan discovered workspace through Jira MCP' }]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian: client } }
  }).run(['node', 'agentic', 'scan']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Found 1 Jira backlog tickets/u);
  assert.match(captured.stdout, /AD-705/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.listBacklog]);
  assert.equal(existsSync(join(rootPath, '.ewokbot', 'runs')), false);
});

test('agentic scan constructs public runtime MCP clients from workspace config', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const sdkClient = new ScanSdkClient();
  const runtime = createPublicCliRuntimeMcp({
    clientFactory: () => sdkClient,
    transportFactory: () => ({ close: async () => undefined })
  });

  try {
    const exitCode = await createCliProgram({
      cwd: rootPath,
      configPath: '.ewokbot/workspace.yml',
      io: captured.io,
      runtimeMcp: runtime.runtimeMcp
    }).run(['node', 'agentic', 'scan']);

    assert.equal(exitCode, 0);
    assert.match(captured.stdout, /Found 1 Jira backlog tickets/u);
    assert.match(captured.stdout, /AD-704/u);
    assert.deepEqual(sdkClient.callToolNames, [defaultJiraMcpToolNames.listBacklog]);
  } finally {
    await runtime.close();
  }

  assert.equal(sdkClient.closed, true);
});

test('agentic scan surfaces empty Jira MCP backlog without side effects', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithJiraMcp());
  const captured = createCapturedIO();
  const client = createJiraMcpClient([]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
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
    () => createCliProgram({ cwd: rootPath, configPath: '.ewokbot/workspace.yml', io: captured.io }).run(['node', 'agentic', 'scan']),
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
      configPath: '.ewokbot/workspace.yml',
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
      configPath: '.ewokbot/workspace.yml',
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
  mkdirSync(join(rootPath, '.ewokbot'));
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), config);
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

class ScanSdkClient implements RuntimeMcpSdkClient {
  readonly callToolNames: string[] = [];
  closed = false;

  async connect(_transport: RuntimeMcpSdkTransport): Promise<void> {
    return;
  }

  async listTools(): Promise<unknown> {
    return {
      tools: [
        { name: defaultJiraMcpToolNames.listBacklog, description: 'List Jira backlog', inputSchema: { type: 'object' } },
        { name: defaultJiraMcpToolNames.getTicket, description: 'Get Jira issue', inputSchema: { type: 'object' } },
        { name: defaultJiraMcpToolNames.comment, description: 'Comment on Jira issue', inputSchema: { type: 'object' } }
      ]
    };
  }

  async callTool(input: { readonly name: string }): Promise<unknown> {
    this.callToolNames.push(input.name);
    return {
      structuredContent: { issues: [jiraIssue('AD-704', 'Scan through public runtime MCP factory')] },
      isError: false
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
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
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
`;
}

function workspaceWithJiraMcpDiscovery(): string {
  return `
workspace:
  name: scan-discovery-test
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
