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

test('Railway MCP DeploymentPort reads deployment state and service URL through default tool names', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployment: railwayDeployment('wait-for-deployment')
      },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.readDeployment, () => ({
      content: {
        deployment: railwayDeployment('read-deployment')
      },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceUrl, () => ({
      content: {
        deployment: {
          serviceUrl: 'https://delivery-cli-staging.mock-railway.local'
        }
      },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });
  const repository = railwayRepository();

  const waited = await adapter.waitForDeployment({ repository, branch: 'develop', commitSha: 'abc123', environment: 'staging' });
  const read = await adapter.readDeployment({ ref: waited.ref });
  const serviceUrl = await adapter.getServiceUrl({ ref: read.ref });

  assert.equal(waited.status, 'success');
  assert.equal(read.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.equal(serviceUrl, 'https://delivery-cli-staging.mock-railway.local');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.readDeployment,
    defaultRailwayMcpToolNames.getServiceUrl
  ]);
});

test('Railway MCP DeploymentPort supports custom configured MCP tool names', async () => {
  const toolNames = {
    waitForDeployment: 'customRailwayWait',
    readDeployment: 'customRailwayRead',
    getServiceUrl: 'customRailwayServiceUrl'
  };
  const client = new MockMcpClient([
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
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [toolNames.waitForDeployment, toolNames.readDeployment, toolNames.getServiceUrl]);
});

test('Railway MCP DeploymentPort emits audit records for successful MCP operations', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: { deployment: railwayDeployment('wait-for-deployment') },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, auditSink: (records) => auditRecords.push(...records) });

  await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'waitForDeployment:started',
    'waitForDeployment:succeeded'
  ]);
});

test('Railway MCP DeploymentPort emits failed audit records before rethrowing failed calls', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceUrl, () => ({
      content: { message: 'remote Railway lookup failed' },
      isError: true
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, auditSink: (records) => auditRecords.push(...records) });

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
    client: new MockMcpClient([createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceUrl, () => ({ content: { deployment: { serviceUrl: 'https://delivery-cli-staging.mock-railway.local' } }, isError: false }))]),
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

function railwayDeploymentRef(): JsonObject {
  return {
    provider: 'railway',
    projectId: 'mock-project-agentic',
    serviceId: 'mock-service-delivery-cli',
    deploymentId: 'mock-agentic-delivery-cli-staging-develop-abc123',
    environment: 'staging'
  };
}
