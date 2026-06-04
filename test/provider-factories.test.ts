import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  GitHubMcpCodeHostPort,
  defaultGitHubMcpToolNames,
  defaultRailwayMcpToolNames,
  MockGitHubConnector,
  MockJiraConnector,
  MockMcpClient,
  MockOpenCodeRunner,
  MockRailwayConnector,
  RailwayMcpDeploymentPort,
  ProviderMcpClientError,
  OpenCodeSubprocessRunner,
  ProviderCredentialError,
  RealProviderAdapterUnavailableError,
  createMockMcpTool,
  createDevRunner,
  createGitHubConnector,
  createJiraConnector,
  createRailwayConnector,
  createWorkspaceAdapters,
  parseWorkspaceConfig
} from '../src/index.js';

const exampleConfigPath = resolve('config/workspace.example.yml');

test('provider factories keep mock mode as the default connector surface', async () => {
  const config = parseWorkspaceConfig(await readFile(exampleConfigPath, 'utf8'));
  const adapters = createWorkspaceAdapters({ config });

  assert.ok(adapters.jira instanceof MockJiraConnector);
  assert.ok(adapters.github instanceof MockGitHubConnector);
  assert.ok(adapters.railway instanceof MockRailwayConnector);
  assert.ok(adapters.devRunner instanceof MockOpenCodeRunner);
});

test('real Jira factory fails fast on missing credentials before live adapter creation', async () => {
  const config = parseWorkspaceConfig((await readFile(exampleConfigPath, 'utf8')).replace('jira:\n  mode: mock', 'jira:\n  mode: real'));

  assert.throws(() => createJiraConnector({ config, environment: {} }), (error: unknown) => {
    assert.ok(error instanceof ProviderCredentialError);
    assert.equal(error.provider, 'Jira');
    assert.equal(error.variableName, 'JIRA_EMAIL');
    return true;
  });
  assert.throws(
    () => createJiraConnector({ config, environment: { JIRA_EMAIL: 'founder@example.test', JIRA_API_TOKEN: 'placeholder' } }),
    RealProviderAdapterUnavailableError
  );
});

test('real GitHub and Railway factories fail fast on missing credentials before live adapter creation', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const githubConfig = parseWorkspaceConfig(source.replace('github:\n  mode: mock', 'github:\n  mode: real'));
  const railwayConfig = parseWorkspaceConfig(source.replace('railway:\n  mode: mock', 'railway:\n  mode: real'));

  assert.throws(() => createGitHubConnector({ config: githubConfig, environment: {} }), (error: unknown) => {
    assert.ok(error instanceof ProviderCredentialError);
    assert.equal(error.provider, 'GitHub');
    assert.equal(error.variableName, 'GITHUB_TOKEN');
    return true;
  });
  assert.throws(() => createGitHubConnector({ config: githubConfig, environment: { GITHUB_TOKEN: 'placeholder' } }), RealProviderAdapterUnavailableError);
  assert.throws(() => createRailwayConnector({ config: railwayConfig, environment: {} }), (error: unknown) => {
    assert.ok(error instanceof ProviderCredentialError);
    assert.equal(error.provider, 'Railway');
    assert.equal(error.variableName, 'RAILWAY_TOKEN');
    return true;
  });
  assert.throws(() => createRailwayConnector({ config: railwayConfig, environment: { RAILWAY_TOKEN: 'placeholder' } }), RealProviderAdapterUnavailableError);
});

test('GitHub factory keeps mock default and selects the injected MCP adapter in mcp mode', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const mockConfig = parseWorkspaceConfig(source);
  assert.ok(createGitHubConnector({ config: mockConfig }) instanceof MockGitHubConnector);

  const mcpConfig = parseWorkspaceConfig(workspaceWithGitHubMcpDefaults());
  assert.throws(() => createGitHubConnector({ config: mcpConfig }), (error: unknown) => {
    assert.ok(error instanceof ProviderMcpClientError);
    assert.equal(error.provider, 'GitHub');
    assert.equal(error.serverId, 'github');
    return true;
  });

  const client = new MockMcpClient([
    createMockMcpTool('github', defaultGitHubMcpToolNames.createBranch, () => ({ content: { branch: { name: 'agent/test', baseBranch: 'develop', headSha: 'sha-default-create' } }, isError: false })),
    createMockMcpTool('github', defaultGitHubMcpToolNames.openPullRequest, () => ({ content: { pullRequest: { number: 9, title: 'Default tool names', sourceBranch: 'agent/test', targetBranch: 'develop', url: 'https://github.com/agentic/frontend/pull/9', status: 'open' } }, isError: false }))
  ]);

  const adapter = createGitHubConnector({
    config: mcpConfig,
    mcpClients: { github: client }
  });

  assert.ok(adapter instanceof GitHubMcpCodeHostPort);

  const repository = {
    provider: 'github',
    owner: 'agentic',
    name: 'frontend',
    defaultBranch: 'develop',
    url: 'https://github.com/agentic/frontend'
  } as const;
  const branch = {
    repository,
    name: 'agent/test',
    baseBranch: 'develop'
  } as const;

  const createdBranch = await adapter.createBranch({ repository, branch });

  const pullRequest = await adapter.openPullRequest({
    repository,
    title: 'Default tool names',
    body: 'Body',
    sourceBranch: createdBranch.name,
    targetBranch: 'develop'
  });

  assert.equal(createdBranch.headSha, 'sha-default-create');
  assert.equal(pullRequest.number, 9);
  assert.deepEqual(client.toolCallRequests.map((call: { readonly toolName: string }) => call.toolName), [
    defaultGitHubMcpToolNames.createBranch,
    defaultGitHubMcpToolNames.openPullRequest
  ]);
});

test('Railway factory keeps mock default and selects the injected MCP adapter in mcp mode', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const mockConfig = parseWorkspaceConfig(source);
  assert.ok(createRailwayConnector({ config: mockConfig }) instanceof MockRailwayConnector);

  const mcpConfig = parseWorkspaceConfig(workspaceWithRailwayMcpDefaults());
  assert.throws(() => createRailwayConnector({ config: mcpConfig }), (error: unknown) => {
    assert.ok(error instanceof ProviderMcpClientError);
    assert.equal(error.provider, 'Railway');
    assert.equal(error.serverId, 'railway');
    return true;
  });

  const client = new MockMcpClient([
    createMockMcpTool('railway', defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployment: {
          ref: {
            provider: 'railway',
            projectId: 'mock-project-agentic',
            serviceId: 'mock-service-delivery-cli',
            deploymentId: 'mock-agentic-delivery-cli-staging-develop-abc123',
            environment: 'staging'
          },
          status: 'success',
          branch: 'develop',
          commitSha: 'abc123',
          serviceUrl: 'https://delivery-cli-staging.mock-railway.local',
          smokeChecks: [],
          startedAt: '2026-06-03T10:30:00.000Z',
          finishedAt: '2026-06-03T10:31:00.000Z',
          summary: 'Default Railway MCP deployment.'
        }
      },
      isError: false
    })),
    createMockMcpTool('railway', defaultRailwayMcpToolNames.getServiceUrl, () => ({
      content: {
        deployment: {
          serviceUrl: 'https://delivery-cli-staging.mock-railway.local'
        }
      },
      isError: false
    }))
  ]);

  const adapter = createRailwayConnector({
    config: mcpConfig,
    mcpClients: { railway: client }
  });

  assert.ok(adapter instanceof RailwayMcpDeploymentPort);

  const repository = {
    provider: 'github',
    owner: 'agentic',
    name: 'delivery-cli',
    defaultBranch: 'develop',
    url: 'https://github.com/agentic/delivery-cli'
  } as const;

  const deployment = await adapter.waitForDeployment({ repository, branch: 'develop', commitSha: 'abc123', environment: 'staging' });
  const serviceUrl = await adapter.getServiceUrl({ ref: deployment.ref });

  assert.equal(deployment.serviceUrl, 'https://delivery-cli-staging.mock-railway.local');
  assert.equal(serviceUrl, 'https://delivery-cli-staging.mock-railway.local');
  assert.deepEqual(client.toolCallRequests.map((call: { readonly toolName: string }) => call.toolName), [
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.getServiceUrl
  ]);
});

test('real OpenCode factory returns subprocess runner without executing a command', async () => {
  const config = parseWorkspaceConfig(
    (await readFile(exampleConfigPath, 'utf8')).replace('dev_runner:\n  provider: opencode', 'dev_runner:\n  mode: real\n  provider: opencode')
  );

  assert.ok(createDevRunner({ config }) instanceof OpenCodeSubprocessRunner);
});

function workspaceWithGitHubMcpDefaults(): string {
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
  mode: mcp
  organization: agentic
  mcp_server: github
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
  github:
    display_name: GitHub MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.github.com/v1/mcp
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

function workspaceWithRailwayMcpDefaults(): string {
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
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  railway:
    display_name: Railway MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.railway.com/v1/mcp
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
