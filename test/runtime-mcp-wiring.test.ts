import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  McpToolAllowlistError,
  McpToolNotFoundError,
  MockGitHubConnector,
  MockJiraConnector,
  MockMcpClient,
  MockOpenCodeRunner,
  MockRailwayConnector,
  RuntimeMcpClientResolutionError,
  RuntimeMcpPolicyError,
  collectRuntimeMcpRequirements,
  createMockMcpTool,
  createRuntimeTicketPort,
  createRuntimeWorkspaceAdapters,
  defaultGitHubMcpToolNames,
  defaultJiraMcpToolNames,
  defaultRailwayMcpToolNames,
  parseWorkspaceConfig,
  type McpClient,
  type McpServerConfig,
  type McpToolAllowlistRule,
  type McpToolCallAuditRecord
} from '../src/index.js';

const exampleConfigPath = resolve('config/workspace.example.yml');

test('runtime MCP wiring preserves mock defaults without constructing MCP clients', async () => {
  const config = parseWorkspaceConfig(await readFile(exampleConfigPath, 'utf8'));
  let factoryCalls = 0;

  const adapters = await createRuntimeWorkspaceAdapters({
    config,
    createMcpClient: () => {
      factoryCalls += 1;
      throw new Error('mock mode must not construct MCP clients');
    }
  });

  assert.equal(factoryCalls, 0);
  assert.ok(adapters.jira instanceof MockJiraConnector);
  assert.ok(adapters.github instanceof MockGitHubConnector);
  assert.ok(adapters.railway instanceof MockRailwayConnector);
  assert.ok(adapters.devRunner instanceof MockOpenCodeRunner);
});

test('runtime MCP wiring constructs configured server clients, validates tools, and captures adapter audit records', async () => {
  const config = parseWorkspaceConfig(workspaceWithAllMcpProviders());
  const clients = createRuntimeMcpClients();
  const createdServers: string[] = [];
  const auditRecords: McpToolCallAuditRecord[] = [];

  const adapters = await createRuntimeWorkspaceAdapters({
    config,
    createMcpClient: (server: McpServerConfig): McpClient => {
      createdServers.push(server.id);
      return clients[server.id] ?? new MockMcpClient();
    },
    mcpAuditSink: (records) => auditRecords.push(...records)
  });

  assert.deepEqual(createdServers.sort(), ['atlassian', 'github', 'railway']);
  assert.deepEqual(clients.atlassian.listToolRequests, [{ serverId: 'atlassian' }]);
  assert.deepEqual(clients.github.listToolRequests, [{ serverId: 'github' }]);
  assert.deepEqual(clients.railway.listToolRequests, [{ serverId: 'railway' }]);
  assert.deepEqual(clients.github.toolCallRequests, []);

  const repository = {
    provider: 'github',
    owner: 'agentic',
    name: 'frontend',
    defaultBranch: 'develop',
    url: 'https://github.com/agentic/frontend'
  } as const;
  const branch = { repository, name: 'agent/runtime-mcp', baseBranch: 'develop' } as const;
  const createdBranch = await adapters.github.createBranch({ repository, branch });

  assert.equal(createdBranch.headSha, 'runtime-sha');
  const githubToolCalls: readonly { readonly toolName: string }[] = clients.github.toolCallRequests;
  assert.deepEqual(githubToolCalls.map((call) => call.toolName), [defaultGitHubMcpToolNames.createBranch]);
  assert.deepEqual(auditRecords.map((record) => record.status), ['started', 'succeeded']);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}`), [
    'CodeHostPort.createBranch',
    'CodeHostPort.createBranch'
  ]);
});

test('runtime TicketPort wiring validates only Jira intake and captures typed comment audits', async () => {
  const config = parseWorkspaceConfig(workspaceWithAllMcpProviders());
  const clients = createRuntimeMcpClients();
  const createdServers: string[] = [];
  const auditRecords: McpToolCallAuditRecord[] = [];

  const ticketPort = await createRuntimeTicketPort({
    config,
    createMcpClient: (server: McpServerConfig): McpClient => {
      createdServers.push(server.id);
      return clients[server.id] ?? new MockMcpClient();
    },
    mcpAuditSink: (records) => auditRecords.push(...records)
  });

  assert.deepEqual(createdServers, ['atlassian']);
  assert.deepEqual(clients.github.listToolRequests, []);
  await ticketPort.comment('AD-701', 'Milestone V intake report handoff.');

  assert.deepEqual(clients.atlassian.toolCallRequests.map((call) => call.toolName), [defaultJiraMcpToolNames.comment]);
  assert.deepEqual(auditRecords.map((record) => `${record.port}.${record.action}:${record.status}`), [
    'TicketPort.comment:started',
    'TicketPort.comment:succeeded'
  ]);
});

test('runtime MCP wiring fails before delivery side effects when an MCP client cannot be resolved', async () => {
  const config = parseWorkspaceConfig(workspaceWithGitHubMcpOnly());

  await assert.rejects(
    () => createRuntimeWorkspaceAdapters({ config }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpClientResolutionError);
      assert.equal(error.provider, 'GitHub');
      assert.equal(error.serverId, 'github');
      return true;
    }
  );
});

test('runtime MCP wiring fails readiness when a configured tool is not discovered', async () => {
  const config = parseWorkspaceConfig(workspaceWithGitHubMcpOnly());
  const client = new MockMcpClient([
    createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: {}, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.getChecks, () => ({ content: {}, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.commentOnPullRequest, () => ({ content: {}, isError: false }))
  ]);

  await assert.rejects(
    () => createRuntimeWorkspaceAdapters({ config, mcpClients: { github: client } }),
    (error: unknown) => {
      assert.ok(error instanceof McpToolNotFoundError);
      assert.equal(error.serverId, 'github');
      assert.equal(error.toolName, defaultGitHubMcpToolNames.createBranch);
      return true;
    }
  );
  assert.deepEqual(client.toolCallRequests, []);
});

test('runtime MCP wiring fails readiness when a configured tool is not allowlisted', async () => {
  const config = parseWorkspaceConfig(workspaceWithGitHubMcpOnly());
  const client = createRuntimeMcpClients().github;
  const allowlistWithoutCreateBranch = collectRuntimeMcpRequirements(config).filter(
    (rule) => rule.action !== 'createBranch'
  );

  await assert.rejects(
    () => createRuntimeWorkspaceAdapters({ config, mcpClients: { github: client }, mcpAllowlist: allowlistWithoutCreateBranch }),
    (error: unknown) => {
      assert.ok(error instanceof McpToolAllowlistError);
      assert.equal(error.serverId, 'github');
      assert.equal(error.toolName, defaultGitHubMcpToolNames.createBranch);
      assert.equal(error.port, 'CodeHostPort');
      assert.equal(error.action, 'createBranch');
      return true;
    }
  );
  assert.deepEqual(client.toolCallRequests, []);
});

test('runtime MCP wiring fails readiness before side effects when policy denies a required tool', async () => {
  const config = parseWorkspaceConfig(workspaceWithMcpProviders(['github'], `mcp_policy:
  mode: read_only
`));
  const client = createRuntimeMcpClients().github;

  await assert.rejects(
    () => createRuntimeWorkspaceAdapters({ config, mcpClients: { github: client } }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpPolicyError);
      assert.equal(error.provider, 'GitHub');
      assert.equal(error.serverId, 'github');
      assert.equal(error.toolName, defaultGitHubMcpToolNames.createBranch);
      assert.equal(error.decision, 'deny');
      return true;
    }
  );
  assert.deepEqual(client.toolCallRequests, []);
});

test('runtime MCP requirements stay typed and exclude GitHub branch pushes', () => {
  const config = parseWorkspaceConfig(workspaceWithAllMcpProviders());
  const requirements = collectRuntimeMcpRequirements(config);

  assert.ok(requirements.some((rule) => rule.port === 'TicketPort' && rule.action === 'listBacklog'));
  assert.ok(requirements.some((rule) => rule.port === 'CodeHostPort' && rule.action === 'createBranch'));
  assert.ok(requirements.some((rule) => rule.port === 'DeploymentPort' && rule.action === 'waitForDeployment'));
  assert.equal(requirements.some((rule) => rule.action === 'pushBranch'), false);
});

function createRuntimeMcpClients(): Record<string, MockMcpClient> {
  return {
    atlassian: new MockMcpClient(createTools('atlassian', [
      defaultJiraMcpToolNames.listBacklog,
      defaultJiraMcpToolNames.getTicket,
      defaultJiraMcpToolNames.comment
    ])),
    github: new MockMcpClient([
      createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({
        content: { branch: { name: 'agent/runtime-mcp', baseBranch: 'develop', headSha: 'runtime-sha' } },
        isError: false
      })),
      ...createTools('github', [
        defaultGitHubMcpToolNames.openPullRequest,
        defaultGitHubMcpToolNames.getChecks,
        defaultGitHubMcpToolNames.commentOnPullRequest
      ])
    ]),
    railway: new MockMcpClient(createTools('railway', [
      defaultRailwayMcpToolNames.waitForDeployment,
      defaultRailwayMcpToolNames.readDeployment,
      defaultRailwayMcpToolNames.getServiceUrl
    ]))
  };
}

function createTools(serverId: string, toolNames: readonly string[]): ReturnType<typeof createMockMcpTool>[] {
  return toolNames.map((toolName) => createMockMcpTool(serverId, toolName, () => ({ content: { ok: true }, isError: false })));
}

function workspaceWithGitHubMcpOnly(): string {
  return workspaceWithMcpProviders(['github']);
}

function workspaceWithAllMcpProviders(): string {
  return workspaceWithMcpProviders(['jira', 'github', 'railway']);
}

function workspaceWithMcpProviders(providers: readonly ('jira' | 'github' | 'railway')[], policyBlock = trustedRuntimePolicyBlock()): string {
  const jiraMode = providers.includes('jira') ? 'mcp' : 'mock';
  const githubMode = providers.includes('github') ? 'mcp' : 'mock';
  const railwayMode = providers.includes('railway') ? 'mcp' : 'mock';
  const jiraServer = jiraMode === 'mcp' ? '  mcp_server: atlassian\n' : '';
  const githubServer = githubMode === 'mcp' ? '  mcp_server: github\n' : '';
  const railwayServer = railwayMode === 'mcp' ? '  mcp_server: railway\n' : '';
  const serverEntries = providers.map((provider) => mcpServerEntry(provider)).join('\n');

  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: ${jiraMode}
  base_url: https://jira.example.test
  project_keys:
    - AD
${jiraServer}github:
  mode: ${githubMode}
  organization: agentic
${githubServer}railway:
  mode: ${railwayMode}
  staging_branch: develop
  production_branch: main
${railwayServer}dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
${policyBlock}mcp_servers:
${serverEntries}
repos:
  - name: frontend
    url: git@github.com:agentic/frontend.git
    local_path: ../frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls: []
`;
}

function trustedRuntimePolicyBlock(): string {
  return `mcp_policy:
  mode: trusted
  tools:
    ${defaultGitHubMcpToolNames.openPullRequest}:
      decision: allow
      reason: Opening a staging pull request is allowed by the runtime fixture.
    ${defaultRailwayMcpToolNames.waitForDeployment}:
      decision: allow
      reason: Waiting for a staging deployment is allowed by the runtime fixture.
`;
}

function mcpServerEntry(provider: 'jira' | 'github' | 'railway'): string {
  const serverId = provider === 'jira' ? 'atlassian' : provider;
  return `  ${serverId}:
    display_name: ${serverId} MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.example.test/${serverId}`;
}
