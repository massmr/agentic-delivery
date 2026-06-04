import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  JiraMcpTicketPort,
  McpToolNotFoundError,
  MockJiraConnector,
  MockMcpClient,
  WorkspaceConfigError,
  createJiraConnector,
  createMockMcpTool,
  parseWorkspaceConfig,
  type McpToolCallAuditRecord,
  type TicketPort
} from '../src/index.js';

const serverId = 'atlassian';
const toolNames = {
  search: ['search', 'Jira', 'Issues', 'Using', 'Jql'].join(''),
  get: ['get', 'Jira', 'Issue'].join(''),
  comment: ['add', 'Comment', 'To', 'Jira', 'Issue'].join('')
};

test('Jira MCP TicketPort lists backlog issues through discovered and allowed MCP tools', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, toolNames.search, (input) => ({
      content: {
        issues: [
          {
            key: 'LK-201',
            self: 'https://jira.example.test/rest/api/3/issue/LK-201',
            fields: {
              summary: 'Build MCP ticket adapter',
              description: 'Read backlog through Atlassian MCP.',
              status: { name: 'To Do' },
              priority: { name: 'High' },
              labels: ['mcp', 'jira'],
              assignee: { displayName: 'Agent One' },
              reporter: { displayName: 'Founder' },
              created: '2026-06-03T09:00:00.000Z',
              updated: '2026-06-03T09:05:00.000Z'
            }
          }
        ]
      },
      isError: false
    }))
  ]);
  const port: TicketPort = new JiraMcpTicketPort({
    client,
    serverId,
    baseUrl: 'https://jira.example.test',
    projectKeys: ['LK']
  });

  const tickets = await port.listBacklog();

  assert.equal(tickets.length, 1);
  assert.deepEqual(tickets[0], {
    ref: {
      provider: 'jira',
      key: 'LK-201',
      url: 'https://jira.example.test/browse/LK-201'
    },
    summary: 'Build MCP ticket adapter',
    description: 'Read backlog through Atlassian MCP.',
    status: 'To Do',
    priority: 'high',
    labels: ['mcp', 'jira'],
    assignee: 'Agent One',
    reporter: 'Founder',
    createdAt: '2026-06-03T09:00:00.000Z',
    updatedAt: '2026-06-03T09:05:00.000Z'
  });
  assert.deepEqual(client.listToolRequests, [{ serverId }]);
  assert.deepEqual(client.toolCallRequests.map((call) => ({ toolName: call.toolName, arguments: call.arguments })), [
    {
      toolName: toolNames.search,
      arguments: { jql: 'project in (LK) ORDER BY updated DESC' }
    }
  ]);
});

test('Jira MCP TicketPort emits started and completed audit records for each operation', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, toolNames.search, () => ({ content: { issues: [jiraIssue('LK-301')] }, isError: false })),
    createMockMcpTool(serverId, toolNames.get, () => ({ content: { issue: jiraIssue('LK-302') }, isError: false })),
    createMockMcpTool(serverId, toolNames.comment, () => ({ content: { ok: true }, isError: false }))
  ]);
  const port = new JiraMcpTicketPort({
    client,
    serverId,
    baseUrl: 'https://jira.example.test',
    projectKeys: ['LK'],
    auditSink: (records) => auditRecords.push(...records)
  });

  await port.listBacklog();
  await port.getTicket('LK-302');
  await port.comment('LK-302', 'Implementation started.');

  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'listBacklog:started',
    'listBacklog:succeeded',
    'getTicket:started',
    'getTicket:succeeded',
    'comment:started',
    'comment:succeeded'
  ]);
});

test('Jira MCP TicketPort builds safe JQL from multiple valid project keys', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, toolNames.search, () => ({
      content: { issues: [] },
      isError: false
    }))
  ]);
  const port: TicketPort = new JiraMcpTicketPort({
    client,
    serverId,
    baseUrl: 'https://jira.example.test',
    projectKeys: ['LK2', 'LK_API']
  });

  await port.listBacklog();

  assert.deepEqual(client.toolCallRequests.map((call) => ({ toolName: call.toolName, arguments: call.arguments })), [
    {
      toolName: toolNames.search,
      arguments: { jql: 'project in (LK2, LK_API) ORDER BY updated DESC' }
    }
  ]);
});

test('Jira MCP TicketPort constructor rejects invalid project keys before any MCP calls', () => {
  assert.throws(
    () => new JiraMcpTicketPort({
      client: new MockMcpClient(),
      serverId,
      baseUrl: 'https://jira.example.test',
      projectKeys: ['LK) OR status IS NOT EMPTY', 'lk', '', ' LK', '1LK', 'LK!']
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'JiraProjectKeyValidationError');
      assert.match(error.message, /Invalid Jira MCP project keys at indexes: 0, 1, 2, 3, 4, 5/u);
      assert.match(error.message, /must start with an uppercase letter and contain only uppercase letters, digits, or underscores/u);
      return true;
    }
  );
});

test('Jira MCP TicketPort supports custom configured MCP tool names', async () => {
  const customTools = {
    listBacklog: 'customJiraSearch',
    getTicket: 'customJiraGet',
    comment: 'customJiraComment'
  };
  const client = new MockMcpClient([
    createMockMcpTool(serverId, customTools.listBacklog, () => ({ content: { issues: [jiraIssue('LK-401')] }, isError: false })),
    createMockMcpTool(serverId, customTools.getTicket, () => ({ content: { issue: jiraIssue('LK-402') }, isError: false })),
    createMockMcpTool(serverId, customTools.comment, () => ({ content: { ok: true }, isError: false }))
  ]);
  const port = new JiraMcpTicketPort({ client, serverId, baseUrl: 'https://jira.example.test', projectKeys: ['LK'], toolNames: customTools });

  await port.listBacklog();
  await port.getTicket('LK-402');
  await port.comment('LK-402', 'Using custom tool names.');

  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [customTools.listBacklog, customTools.getTicket, customTools.comment]);
});

test('Jira MCP TicketPort gets one issue and comments through MCP without live calls', async () => {
  let liveCallAttempts = 0;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, toolNames.get, (input) => ({
      content: {
        issue: {
          key: input.arguments.issueKey,
          fields: {
            summary: 'Fetch one ticket',
            description: { text: 'Fetch by key through MCP.' },
            status: { name: 'In Progress' },
            priority: { name: 'Medium' },
            labels: [],
            created: '2026-06-03T10:00:00.000Z',
            updated: '2026-06-03T10:10:00.000Z'
          }
        }
      },
      isError: false
    })),
    createMockMcpTool(serverId, toolNames.comment, (input) => {
      assert.deepEqual(input.arguments, { issueKey: 'LK-202', comment: 'Implementation started.' });
      return { content: { ok: true }, isError: false };
    })
  ]);
  const port = new JiraMcpTicketPort({ client, serverId, baseUrl: 'https://jira.example.test', projectKeys: ['LK'] });

  const ticket = await port.getTicket('LK-202');
  await port.comment('LK-202', 'Implementation started.');

  assert.equal(liveCallAttempts, 0);
  assert.equal(ticket.ref.key, 'LK-202');
  assert.equal(ticket.description, 'Fetch by key through MCP.');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [toolNames.get, toolNames.comment]);
});

test('Jira MCP TicketPort missing tools fail with actionable MCP tool errors', async () => {
  const port = new JiraMcpTicketPort({
    client: new MockMcpClient([createMockMcpTool(serverId, toolNames.get, () => ({ content: {}, isError: false }))]),
    serverId,
    baseUrl: 'https://jira.example.test',
    projectKeys: ['LK']
  });

  await assert.rejects(() => port.listBacklog(), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.serverId, serverId);
    assert.equal(error.toolName, toolNames.search);
    assert.match(error.message, /Configure or allow the MCP server tool before retrying/u);
    return true;
  });
});

test('Jira MCP TicketPort missing configured tools fail with actionable MCP tool errors', async () => {
  const port = new JiraMcpTicketPort({
    client: new MockMcpClient([createMockMcpTool(serverId, toolNames.search, () => ({ content: { issues: [] }, isError: false }))]),
    serverId,
    baseUrl: 'https://jira.example.test',
    projectKeys: ['LK'],
    toolNames: { listBacklog: 'customJiraSearch', getTicket: 'customJiraGet', comment: 'customJiraComment' }
  });

  await assert.rejects(() => port.listBacklog(), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.toolName, 'customJiraSearch');
    assert.match(error.message, /Configure or allow the MCP server tool before retrying/u);
    return true;
  });
});

test('workspace config accepts jira.mode mcp and top-level Atlassian mcp-remote server config only for Jira', () => {
  const config = parseWorkspaceConfig(workspaceWithJiraMcp());

  assert.equal(config.jira.mode, 'mcp');
  assert.equal(config.jira.mcpServerId, serverId);
  assert.equal(config.mcpServers.length, 1);
  assert.deepEqual(config.mcpServers[0], {
    id: serverId,
    displayName: 'Atlassian MCP',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.atlassian.com/v1/mcp/authv2'],
    timeoutMs: 30000,
    envVarNames: []
  });
  assert.deepEqual(config.jira.mcpToolNames, {
    listBacklog: toolNames.search,
    getTicket: toolNames.get,
    comment: toolNames.comment
  });
});

test('workspace config accepts custom Jira MCP tool names', () => {
  const config = parseWorkspaceConfig(workspaceWithJiraMcp().replace(
    '  mcp_server: atlassian',
    `  mcp_server: atlassian
  mcp_tools:
    list_backlog: customJiraSearch
    get_ticket: customJiraGet
    comment: customJiraComment`
  ));

  assert.deepEqual(config.jira.mcpToolNames, {
    listBacklog: 'customJiraSearch',
    getTicket: 'customJiraGet',
    comment: 'customJiraComment'
  });
});

test('workspace config rejects invalid Jira project keys when Jira uses MCP mode', () => {
  for (const invalidKey of ['LK) OR status IS NOT EMPTY', 'lk', ' LK', '1LK', 'LK!']) {
    assert.throws(
      () => parseWorkspaceConfig(workspaceWithJiraMcp().replace('    - LK', `    - ${JSON.stringify(invalidKey)}`)),
      (error: unknown) => {
        assert.ok(error instanceof WorkspaceConfigError);
        assert.equal(error.issues[0]?.path, 'jira.project_keys[0]');
        assert.match(error.issues[0]?.message ?? '', /must start with an uppercase letter and contain only uppercase letters, digits, or underscores/u);
        assert.match(error.issues[0]?.action ?? '', /Use keys like LK, LK2, or LK_API/u);
        return true;
      }
    );
  }

  assert.throws(
    () => parseWorkspaceConfig(workspaceWithJiraMcp().replace('    - LK', '    - ""')),
    (error: unknown) => {
      assert.ok(error instanceof WorkspaceConfigError);
      assert.equal(error.issues[0]?.path, 'jira.project_keys[0]');
      assert.match(error.message, /must be a non-empty string/u);
      assert.match(error.message, /Add at least one Jira project key/u);
      return true;
    }
  );
});

test('workspace config rejects jira.mode mcp when jira.mcp_server is not configured', () => {
  assert.throws(
    () => parseWorkspaceConfig(workspaceWithJiraMcp().replace('  atlassian:\n    display_name: Atlassian MCP', '  linear:\n    display_name: Linear MCP')),
    /jira\.mcp_server references 'atlassian', but no matching top-level mcp_servers entry exists/u
  );
});

test('Jira factory defaults to mock, keeps real fail-fast, and requires injected MCP clients by server id', async () => {
  const exampleSource = await readFile(resolve('config/workspace.example.yml'), 'utf8');
  const mockConfig = parseWorkspaceConfig(exampleSource);
  assert.ok(createJiraConnector({ config: mockConfig }) instanceof MockJiraConnector);

  const realConfig = parseWorkspaceConfig(exampleSource.replace('jira:\n  mode: mock', 'jira:\n  mode: real'));
  assert.throws(() => createJiraConnector({ config: realConfig, environment: {} }), /Jira real adapter requires JIRA_EMAIL/u);

  const mcpConfig = parseWorkspaceConfig(workspaceWithJiraMcp());
  assert.throws(() => createJiraConnector({ config: mcpConfig }), /Jira MCP adapter requires an injected McpClient for server 'atlassian'/u);

  const auditRecords: McpToolCallAuditRecord[] = [];
  const adapter = createJiraConnector({ config: mcpConfig, mcpClients: { [serverId]: new MockMcpClient() }, jiraMcpAuditSink: (records) => auditRecords.push(...records) });
  assert.ok(adapter instanceof JiraMcpTicketPort);
});

function jiraIssue(key: string) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      description: `Description for ${key}`,
      status: { name: 'To Do' },
      priority: { name: 'Medium' },
      labels: [],
      created: '2026-06-03T09:00:00.000Z',
      updated: '2026-06-03T09:05:00.000Z'
    }
  };
}

function workspaceWithJiraMcp(): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - LK
  mcp_server: atlassian
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
mcp_servers:
  atlassian:
    display_name: Atlassian MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.atlassian.com/v1/mcp/authv2
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`;
}
