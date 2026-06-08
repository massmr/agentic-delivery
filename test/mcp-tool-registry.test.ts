import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAtlassianMcpToolRegistry,
  createCustomMcpToolRegistry,
  createGitHubMcpToolRegistry,
  createRailwayMcpToolRegistry,
  type JsonObject,
  type McpToolDefinition
} from '../src/index.js';

test('MCP tool registry builds sanitized Atlassian entries from fake inspection data', () => {
  const secretDefault = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const registry = createAtlassianMcpToolRegistry('atlassian', [
    tool('search_jira_issues', {
      type: 'object',
      properties: {
        jql: { type: 'string' },
        apiToken: { type: 'string', default: secretDefault }
      }
    }),
    tool('add_jira_comment'),
    tool('mystery_jira_magic')
  ]);

  assert.equal(registry.provider, 'atlassian');
  assert.equal(registry.serverId, 'atlassian');
  assert.deepEqual(registry.safety, {
    source: 'inspection',
    defaultAuthorization: 'deny',
    unknownToolsDeniedByDefault: true,
    mcpMethodsCalled: ['listTools'],
    toolCallsPerformed: 0
  });
  assertEntry(registry.entries[0], 'search_jira_issues', 'read', 'ticketing');
  assertEntry(registry.entries[1], 'add_jira_comment', 'write', 'ticketing');
  assertEntry(registry.entries[2], 'mystery_jira_magic', 'unknown', 'unknown');
  assert.equal(registry.entries[2]?.unknownReason, 'Tool was discovered from MCP inspection data but has no built-in AV classification.');
  assert.equal(JSON.stringify(registry).includes(secretDefault), false);
  assert.deepEqual(registry.entries[0]?.inputSchema, {
    type: 'object',
    properties: {
      jql: { type: 'string' },
      apiToken: { type: 'string', default: '[redacted]' }
    }
  });
});

test('MCP tool registry classifies Railway inspection data without provider execution', () => {
  const registry = createRailwayMcpToolRegistry('railway', [
    tool('list-projects'),
    tool('get_deployment_status'),
    tool('deploy-service'),
    tool('set-environment-variable')
  ]);

  assertEntry(registry.entries[0], 'list-projects', 'read', 'deployment');
  assertEntry(registry.entries[1], 'get_deployment_status', 'read', 'deployment');
  assertEntry(registry.entries[2], 'deploy-service', 'destructive', 'deployment');
  assertEntry(registry.entries[3], 'set-environment-variable', 'secret_sensitive', 'deployment');
});

test('MCP tool registry classifies inspected Railway read tools from railway mcp safely', () => {
  const readTools = [
    'environment_status',
    'list_deployments',
    'list_projects',
    'list_services',
    'get_service_config',
    'get_logs',
    'service_metrics'
  ];
  const registry = createRailwayMcpToolRegistry('railway', readTools.map((toolName) => tool(toolName)));

  for (const [index, toolName] of readTools.entries()) {
    assertEntry(registry.entries[index], toolName, 'read', 'deployment');
  }
});

test('MCP tool registry classifies real Railway variables observability and mutation tools safely', () => {
  const registry = createRailwayMcpToolRegistry('railway', [
    tool('list_variables', {
      type: 'object',
      properties: {
        cachedVariableValue: { type: 'string', default: 'railway-secret-value' }
      }
    }),
    tool('set_variables'),
    tool('add_reference_variable'),
    tool('environment_status'),
    tool('whoami'),
    tool('http_error_rate'),
    tool('http_requests'),
    tool('http_response_time'),
    tool('generate_domain'),
    tool('deploy'),
    tool('remove_service'),
    tool('scale_service'),
    tool('connect_service_source'),
    tool('disconnect_service_source'),
    tool('link_service'),
    tool('link_environment')
  ]);

  assertEntry(registry.entries[0], 'list_variables', 'secret_sensitive', 'deployment');
  assert.equal(JSON.stringify(registry).includes('railway-secret-value'), false);
  assert.deepEqual(registry.entries[0]?.inputSchema, {
    type: 'object',
    properties: {
      cachedVariableValue: { type: 'string', default: '[redacted]' }
    }
  });
  assertEntry(registry.entries[1], 'set_variables', 'secret_sensitive', 'deployment');
  assertEntry(registry.entries[2], 'add_reference_variable', 'secret_sensitive', 'deployment');
  assertEntry(registry.entries[3], 'environment_status', 'read', 'deployment');
  assertEntry(registry.entries[4], 'whoami', 'unknown', 'unknown');
  assertEntry(registry.entries[5], 'http_error_rate', 'unknown', 'unknown');
  assertEntry(registry.entries[6], 'http_requests', 'unknown', 'unknown');
  assertEntry(registry.entries[7], 'http_response_time', 'unknown', 'unknown');
  assertEntry(registry.entries[8], 'generate_domain', 'destructive', 'deployment');
  assertEntry(registry.entries[9], 'deploy', 'destructive', 'deployment');
  assertEntry(registry.entries[10], 'remove_service', 'destructive', 'deployment');
  assertEntry(registry.entries[11], 'scale_service', 'destructive', 'deployment');
  assertEntry(registry.entries[12], 'connect_service_source', 'destructive', 'deployment');
  assertEntry(registry.entries[13], 'disconnect_service_source', 'destructive', 'deployment');
  assertEntry(registry.entries[14], 'link_service', 'destructive', 'deployment');
  assertEntry(registry.entries[15], 'link_environment', 'destructive', 'deployment');
});

test('MCP tool registry classifies GitHub inspection data and preserves output metadata', () => {
  const registry = createGitHubMcpToolRegistry('github', [
    tool('search_repositories'),
    tool('create_pull_request', {}, { contentType: 'application/json', example: { number: 123 } }),
    tool('merge_pull_request')
  ]);

  assertEntry(registry.entries[0], 'search_repositories', 'read', 'code_hosting');
  assertEntry(registry.entries[1], 'create_pull_request', 'destructive', 'code_hosting');
  assert.deepEqual(registry.entries[1]?.outputMetadata, { contentType: 'application/json', example: { number: 123 } });
  assertEntry(registry.entries[2], 'merge_pull_request', 'destructive', 'code_hosting');
});

test('MCP tool registry represents custom and unknown tools explicitly', () => {
  const registry = createCustomMcpToolRegistry('internal-tools', [
    tool('custom_lookup'),
    tool('frobnicate')
  ]);

  assertEntry(registry.entries[0], 'custom_lookup', 'custom', 'custom');
  assertEntry(registry.entries[1], 'frobnicate', 'unknown', 'unknown');
  assert.equal(registry.entries.every((entry) => entry.defaultAuthorization === 'deny' && entry.policyRequired), true);
});

function tool(name: string, inputSchema: JsonObject = {}, outputMetadata?: JsonObject): McpToolDefinition {
  return {
    name,
    description: `Fake inspected ${name}`,
    inputSchema,
    outputSchema: { type: 'object' },
    outputMetadata
  };
}

function assertEntry(
  entry: { readonly toolName: string; readonly classification: string; readonly category: string; readonly defaultAuthorization: string; readonly policyRequired: boolean } | undefined,
  toolName: string,
  classification: string,
  category: string
): void {
  assert.equal(entry?.toolName, toolName);
  assert.equal(entry?.classification, classification);
  assert.equal(entry?.category, category);
  assert.equal(entry?.defaultAuthorization, 'deny');
  assert.equal(entry?.policyRequired, true);
}
