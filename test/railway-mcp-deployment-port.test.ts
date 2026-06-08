import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type DeploymentRef,
  type JsonObject,
  McpToolNotFoundError,
  MockMcpClient,
  RailwayMcpDeploymentPort,
  defaultRailwayMcpToolNames,
  createMockMcpTool,
  type McpToolCallAuditRecord,
  type RepositoryRef
} from '../src/index.js';

const serverId = 'railway';

test('Railway MCP default tool names use inspected read-only railway mcp tools', () => {
  assert.deepEqual(defaultRailwayMcpToolNames, {
    waitForDeployment: 'list_deployments',
    readDeployment: 'list_deployments',
    getServiceUrl: '',
    environmentStatus: 'environment_status',
    listDeployments: 'list_deployments',
    listProjects: 'list_projects',
    listServices: 'list_services',
    getServiceConfig: 'get_service_config',
    getLogs: 'get_logs',
    serviceMetrics: 'service_metrics'
  });
});

test('Railway MCP DeploymentPort reads deployment state through default tool names', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployment: railwayDeployment('wait-for-deployment')
      },
      isError: false
    })),
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });
  const repository = railwayRepository();

  const waited = await adapter.waitForDeployment({ repository, branch: 'develop', commitSha: 'abc123', environment: 'staging' });
  const read = await adapter.readDeployment({ ref: waited.ref });

  assert.equal(waited.status, 'success');
  assert.equal(read.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.equal(read.serviceUrl, 'https://delivery-cli-staging.mock-railway.local');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.readDeployment
  ]);
  assert.deepEqual(client.toolCallRequests.map((call) => call.arguments), [
    {},
    { limit: 25 },
    { project_id: 'mock-project-agentic', service_id: 'mock-service-delivery-cli', limit: 25 }
  ]);
});

test('Railway MCP DeploymentPort does not assume get_service_config returns service URLs by default', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({
      content: { service: { variableCount: 3 } },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  await assert.rejects(
    () => adapter.getServiceUrl({ ref: railwayDeploymentRef() as unknown as DeploymentRef }),
    /Railway MCP service URL lookup is not configured/u
  );
  assert.deepEqual(client.toolCallRequests, []);
});

test('Railway MCP DeploymentPort supports custom configured MCP tool names', async () => {
  const toolNames = {
    waitForDeployment: 'customRailwayWait',
    readDeployment: 'customRailwayRead',
    getServiceUrl: 'customRailwayServiceUrl',
    environmentStatus: 'customRailwayEnvironmentStatus'
  };
  const client = new MockMcpClient([
    createMockMcpTool(serverId, toolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, toolNames.waitForDeployment, () => ({
      content: { deployment: railwayDeployment('wait-for-deployment') },
      isError: false
    })),
    createMockMcpTool(serverId, toolNames.readDeployment, () => ({
      content: { deployment: railwayDeployment('read-deployment') },
      isError: false
    })),
    createMockMcpTool(serverId, toolNames.getServiceUrl, () => ({
      content: { deployment: { serviceUrl: 'https://custom.mock-railway.local' } },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, toolNames });
  const repository = railwayRepository();
  const deploymentRef = railwayDeploymentRef() as unknown as DeploymentRef;

  await adapter.waitForDeployment({ repository, branch: 'develop', commitSha: 'abc123', environment: 'staging' });
  await adapter.readDeployment({ ref: deploymentRef });
  const serviceUrl = await adapter.getServiceUrl({ ref: deploymentRef });

  assert.equal(serviceUrl, 'https://custom.mock-railway.local');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [toolNames.environmentStatus, toolNames.waitForDeployment, toolNames.readDeployment, toolNames.getServiceUrl]);
});

test('Railway MCP DeploymentPort emits audit records for successful MCP operations', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: { deployment: railwayDeployment('wait-for-deployment') },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, auditSink: (records) => auditRecords.push(...records) });

  await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'waitForDeployment:started',
    'waitForDeployment:succeeded',
    'waitForDeployment:started',
    'waitForDeployment:succeeded'
  ]);
});

test('Railway MCP DeploymentPort emits failed audit records before rethrowing failed calls', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({
      content: { message: 'remote Railway lookup failed' },
      isError: true
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, toolNames: { getServiceUrl: defaultRailwayMcpToolNames.getServiceConfig }, auditSink: (records) => auditRecords.push(...records) });

  await assert.rejects(() => adapter.getServiceUrl({ ref: railwayDeploymentRef() as unknown as DeploymentRef }), /returned an error result/u);

  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'getServiceUrl:started',
    'getServiceUrl:failed'
  ]);
  assert.equal(auditRecords[1]?.error?.kind, 'provider_error');
  assert.match(auditRecords[1]?.error?.message ?? '', /remote Railway lookup failed/u);
});

test('Railway MCP DeploymentPort missing tools fail with actionable MCP tool errors', async () => {
  const adapter = new RailwayMcpDeploymentPort({
    client: new MockMcpClient([
      createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({ content: { environment: { status: 'ready' } }, isError: false }))
    ]),
    serverId
  });

  await assert.rejects(() => adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' }), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.serverId, serverId);
    assert.equal(error.toolName, defaultRailwayMcpToolNames.waitForDeployment);
    assert.match(error.message, /Configure or allow the MCP server tool before retrying/u);
    return true;
  });
});

test('Railway MCP DeploymentPort accepts wait results without service URL', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: { deployment: railwayDeploymentWithoutServiceUrl('wait-for-deployment') },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  const deployment = await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

  assert.equal(deployment.status, 'success');
  assert.equal(deployment.serviceUrl, 'unavailable');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultRailwayMcpToolNames.environmentStatus, defaultRailwayMcpToolNames.waitForDeployment]);
});

test('Railway MCP DeploymentPort accepts read results without service URL', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.readDeployment, () => ({
      content: { deployment: railwayDeploymentWithoutServiceUrl('read-deployment') },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  const deployment = await adapter.readDeployment({ ref: railwayDeploymentRef() as unknown as DeploymentRef });

  assert.equal(deployment.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.equal(deployment.serviceUrl, 'unavailable');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultRailwayMcpToolNames.readDeployment]);
});

test('Railway MCP DeploymentPort selects requested deployments from list_deployments arrays', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployments: [
          {
            ...railwayDeployment('wrong-branch'),
            branch: 'main',
            commitSha: 'different-sha',
            ref: {
              ...railwayDeploymentRef(),
              deploymentId: 'mock-main-deployment'
            }
          },
          railwayDeployment('wait-for-deployment')
        ]
      },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  const deployment = await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

  assert.equal(deployment.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.equal(deployment.branch, 'develop');
});

test('Railway MCP DeploymentPort reads service URLs only from explicitly configured URL tools', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({
      content: {
        service_config: {
          service_url: 'https://service-config.mock-railway.local'
        }
      },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, toolNames: { getServiceUrl: defaultRailwayMcpToolNames.getServiceConfig } });

  const serviceUrl = await adapter.getServiceUrl({ ref: railwayDeploymentRef() as unknown as DeploymentRef });

  assert.equal(serviceUrl, 'https://service-config.mock-railway.local');
});

test('Railway MCP DeploymentPort rejects wait results that do not match requested deployment identity', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployment: {
          ...railwayDeployment('wait-for-deployment'),
          branch: 'main',
          commitSha: 'different-sha',
          ref: {
            ...railwayDeploymentRef(),
            environment: 'production'
          }
        }
      },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  await assert.rejects(
    () => adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' }),
    /does not match requested branch develop/u
  );
});

test('Railway MCP DeploymentPort rejects read results whose deployment ref does not match the request', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.readDeployment, () => ({
      content: {
        deployment: {
          ...railwayDeployment('read-deployment'),
          ref: {
            ...railwayDeploymentRef(),
            deploymentId: 'different-deployment'
          }
        }
      },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  await assert.rejects(
    () => adapter.readDeployment({ ref: railwayDeploymentRef() as unknown as DeploymentRef }),
    /does not match requested deploymentId/u
  );
});

test('Railway MCP DeploymentPort rejects non-http staging service URLs', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({
      content: { deployment: { serviceUrl: 'ftp://delivery-cli-staging.mock-railway.local' } },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, toolNames: { getServiceUrl: defaultRailwayMcpToolNames.getServiceConfig } });

  await assert.rejects(
    () => adapter.getServiceUrl({ ref: railwayDeploymentRef() as unknown as DeploymentRef }),
    /must be an HTTP\(S\) URL/u
  );
});

test('Railway MCP DeploymentPort rejects missing staging service URLs in getServiceUrl', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({
      content: { deployment: {} },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, toolNames: { getServiceUrl: defaultRailwayMcpToolNames.getServiceConfig } });

  await assert.rejects(
    () => adapter.getServiceUrl({ ref: railwayDeploymentRef() as unknown as DeploymentRef }),
    /content\.serviceUrl must be a non-empty string/u
  );
});

function railwayRepository(): RepositoryRef {
  return {
    provider: 'github',
    owner: 'agentic',
    name: 'delivery-cli',
    defaultBranch: 'develop',
    url: 'https://github.com/agentic/delivery-cli'
  };
}

function railwayDeployment(label: string): JsonObject {
  return {
    ref: railwayDeploymentRef(),
    status: 'success',
    branch: 'develop',
    commitSha: 'abc123',
    serviceUrl: 'https://delivery-cli-staging.mock-railway.local',
    smokeChecks: [],
    startedAt: '2026-06-03T10:30:00.000Z',
    finishedAt: '2026-06-03T10:31:00.000Z',
    summary: `Mock Railway deployment ${label}.`
  };
}

function railwayDeploymentWithoutServiceUrl(label: string): JsonObject {
  const deployment = { ...railwayDeployment(label) };
  delete deployment.serviceUrl;
  return deployment;
}

function railwayDeploymentRef(): JsonObject {
  return {
    provider: 'railway',
    projectId: 'mock-project-agentic',
    serviceId: 'mock-service-delivery-cli',
    deploymentId: 'mock-agentic-delivery-cli-staging-develop-abc123',
    environment: 'staging'
  };
}
