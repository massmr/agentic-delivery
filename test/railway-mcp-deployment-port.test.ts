import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type DeploymentRef,
  type JsonObject,
  McpToolNotFoundError,
  MockMcpClient,
  RailwayMcpDiscoveryPort,
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

test('Railway MCP DiscoveryPort lists projects and services through setup-only read tools', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.listProjects, () => ({
      content: {
        projects: [
          { id: 'project-web', name: 'Web Platform' },
          { id: 'project-api', name: 'API Platform' }
        ]
      },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.listServices, (input) => ({
      content: {
        services: input.arguments.project_id === 'project-web'
          ? [{ id: 'service-frontend', name: 'frontend', projectId: 'project-web', environment: { id: 'env-web-staging', name: 'staging' }, branch: 'develop' }]
          : [{ id: 'service-api', name: 'api', project_id: 'project-api', staging_environment_id: 'env-api-staging', staging_environment_name: 'staging', staging_branch: 'develop' }]
      },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({ content: { variableCount: 3 }, isError: false }))
  ]);
  const adapter = new RailwayMcpDiscoveryPort({ client, serverId, auditSink: (records) => auditRecords.push(...records) });

  const snapshot = await adapter.discover();

  assert.deepEqual(snapshot.projects, [
    { id: 'project-web', name: 'Web Platform' },
    { id: 'project-api', name: 'API Platform' }
  ]);
  assert.deepEqual(snapshot.services, [
    { id: 'service-frontend', name: 'frontend', projectId: 'project-web', projectName: 'Web Platform', environmentId: 'env-web-staging', environmentName: 'staging', branch: 'develop' },
    { id: 'service-api', name: 'api', projectId: 'project-api', projectName: 'API Platform', environmentId: 'env-api-staging', environmentName: 'staging', branch: 'develop' }
  ]);
  assert.deepEqual(client.toolCallRequests.map((call) => [call.toolName, call.arguments]), [
    [defaultRailwayMcpToolNames.listProjects, {}],
    [defaultRailwayMcpToolNames.listServices, { project_id: 'project-web' }],
    [defaultRailwayMcpToolNames.listServices, { project_id: 'project-api' }]
  ]);
  assert.equal(auditRecords.every((record) => record.port === 'RailwayDiscoveryPort' && record.safety === 'read'), true);
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

test('Railway MCP DeploymentPort passes explicit repository mapping IDs to read-only Railway tools', async () => {
  const mapping = {
    provider: 'railway' as const,
    projectId: 'project-api',
    environmentId: 'env-staging',
    serviceId: 'service-api',
    branch: 'develop',
    verification: {
      mode: 'railway_mcp' as const,
      smokeUrls: []
    }
  };
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployment: {
          ...railwayDeployment('mapped-wait'),
          ref: {
            ...railwayDeploymentRef(),
            projectId: 'project-api',
            environmentId: 'env-staging',
            serviceId: 'service-api'
          }
        }
      },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.getServiceConfig, () => ({
      content: { deployment: { serviceUrl: 'https://api-staging.example.test' } },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId, toolNames: { getServiceUrl: defaultRailwayMcpToolNames.getServiceConfig } });

  const waited = await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging', mapping });
  const serviceUrl = await adapter.getServiceUrl({ ref: waited.ref, mapping });

  assert.equal(waited.mapping, mapping);
  assert.equal(waited.ref.environmentId, 'env-staging');
  assert.equal(serviceUrl, 'https://api-staging.example.test');
  assert.deepEqual(client.toolCallRequests.map((call) => call.arguments), [
    { project_id: 'project-api', environment_id: 'env-staging' },
    { project_id: 'project-api', environment_id: 'env-staging', service_id: 'service-api', limit: 25 },
    { project_id: 'project-api', service_id: 'service-api', environment_id: 'env-staging' }
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

test('Railway MCP DeploymentPort polls pending and deploying deployments until Railway reports success', async () => {
  const sleeps: number[] = [];
  let listCalls = 0;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => {
      listCalls += 1;
      const status = listCalls === 1 ? 'pending' : listCalls === 2 ? 'deploying' : 'success';
      return {
        content: { deployment: railwayDeploymentWithStatus(status) },
        isError: false
      };
    })
  ]);
  const adapter = new RailwayMcpDeploymentPort({
    client,
    serverId,
    waitMaxAttempts: 4,
    waitPollIntervalMs: 10,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });

  const deployment = await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

  assert.equal(deployment.status, 'success');
  assert.equal(deployment.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.deepEqual(sleeps, [10, 10]);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment
  ]);
});

test('Railway MCP DeploymentPort returns terminal failed and cancelled deployments without polling again', async () => {
  for (const status of ['failed', 'cancelled'] as const) {
    const sleeps: number[] = [];
    const client = new MockMcpClient([
      createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
        content: { environment: { status: 'ready' } },
        isError: false
      })),
      createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
        content: { deployment: railwayDeploymentWithStatus(status) },
        isError: false
      }))
    ]);
    const adapter = new RailwayMcpDeploymentPort({
      client,
      serverId,
      waitMaxAttempts: 3,
      waitPollIntervalMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    const deployment = await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

    assert.equal(deployment.status, status);
    assert.deepEqual(sleeps, []);
    assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
      defaultRailwayMcpToolNames.environmentStatus,
      defaultRailwayMcpToolNames.waitForDeployment
    ]);
  }
});

test('Railway MCP DeploymentPort times out persistent pending deployments with actionable context', async () => {
  const mapping = {
    provider: 'railway' as const,
    projectId: 'project-api',
    environmentId: 'env-staging',
    serviceId: 'service-api',
    branch: 'develop',
    verification: {
      mode: 'railway_mcp' as const,
      smokeUrls: []
    }
  };
  const sleeps: number[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: {
        deployment: {
          ...railwayDeploymentWithStatus('pending'),
          ref: {
            ...railwayDeploymentRef(),
            projectId: 'project-api',
            environmentId: 'env-staging',
            serviceId: 'service-api'
          }
        }
      },
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({
    client,
    serverId,
    waitMaxAttempts: 2,
    waitPollIntervalMs: 7,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });

  await assert.rejects(
    () => adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging', mapping }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /timed out after 2 attempt\(s\)/u);
      assert.match(error.message, /agentic\/delivery-cli/u);
      assert.match(error.message, /branch develop/u);
      assert.match(error.message, /commit abc123/u);
      assert.match(error.message, /project_id=project-api/u);
      assert.match(error.message, /environment_id=env-staging/u);
      assert.match(error.message, /service_id=service-api/u);
      assert.match(error.message, /Last status: pending/u);
      return true;
    }
  );
  assert.deepEqual(sleeps, [7]);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment
  ]);
});

test('Railway MCP DeploymentPort keeps polling when the matching deployment is initially absent', async () => {
  const sleeps: number[] = [];
  let listCalls = 0;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => {
      listCalls += 1;
      return {
        content: listCalls === 1 ? { deployments: [] } : { deployment: railwayDeployment('wait-for-deployment') },
        isError: false
      };
    })
  ]);
  const adapter = new RailwayMcpDeploymentPort({
    client,
    serverId,
    waitMaxAttempts: 3,
    waitPollIntervalMs: 5,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });

  const deployment = await adapter.waitForDeployment({ repository: railwayRepository(), branch: 'develop', commitSha: 'abc123', environment: 'staging' });

  assert.equal(deployment.status, 'success');
  assert.deepEqual(sleeps, [5]);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment,
    defaultRailwayMcpToolNames.environmentStatus,
    defaultRailwayMcpToolNames.waitForDeployment
  ]);
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

test('Railway MCP DeploymentPort parses Railway list_deployments text table output', async () => {
  const mapping = {
    provider: 'railway' as const,
    projectId: 'project-frontend',
    environmentId: 'staging',
    serviceId: 'frontend',
    branch: 'develop',
    verification: {
      mode: 'railway_mcp' as const,
      smokeUrls: []
    }
  };
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.environmentStatus, () => ({
      content: { environment: { status: 'ready' } },
      isError: false
    })),
    createMockMcpTool(serverId, defaultRailwayMcpToolNames.waitForDeployment, () => ({
      content: [
        {
          type: 'text',
          text: [
            '05601e48-5421-4f47-a90a-0272034ca189 | SUCCESS | 2026-06-11 15:56:23.500 UTC | merge-sha',
            '52a4e891-2d3d-4bd9-8004-0693d7ebf134 | REMOVED | 2026-06-11 15:53:22.808 UTC | old-sha'
          ].join('\n')
        }
      ],
      isError: false
    }))
  ]);
  const adapter = new RailwayMcpDeploymentPort({ client, serverId });

  const deployment = await adapter.waitForDeployment({
    repository: railwayRepository(),
    branch: 'develop',
    commitSha: 'merge-sha',
    environment: 'staging',
    mapping
  });

  assert.equal(deployment.ref.deploymentId, '05601e48-5421-4f47-a90a-0272034ca189');
  assert.equal(deployment.ref.projectId, 'project-frontend');
  assert.equal(deployment.ref.environmentId, 'staging');
  assert.equal(deployment.ref.serviceId, 'frontend');
  assert.equal(deployment.status, 'success');
  assert.equal(deployment.branch, 'develop');
  assert.equal(deployment.commitSha, 'merge-sha');
  assert.equal(deployment.serviceUrl, 'unavailable');
  assert.deepEqual(deployment.smokeChecks, []);
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

function railwayDeploymentWithStatus(status: 'pending' | 'deploying' | 'success' | 'failed' | 'cancelled'): JsonObject {
  return {
    ...railwayDeployment(status),
    status,
    summary: `Mock Railway deployment status ${status}.`
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
