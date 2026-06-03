import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MockMcpClient,
  McpToolAllowlistError,
  McpToolCallTimeoutError,
  McpToolNotFoundError,
  assertMcpToolAllowed,
  callAllowedMcpTool,
  createMcpToolCallAuditRecord,
  createMockMcpTool,
  createStdioMcpServerConfig,
  discoverMcpTools,
  mapMcpError,
  requireDiscoveredMcpTool,
  validateMcpServerConfig,
  withMcpTimeout,
  type McpToolCallAuditRecord,
  type McpToolCallResult
} from '../src/index.js';

const serverId = 'atlassian';
const readTicketTool = 'jira.search';
const commentTool = 'jira.comment';

test('MCP server config model validates local server settings without secrets', () => {
  const config = createStdioMcpServerConfig({
    id: serverId,
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.example.test/auth'],
    envVarNames: ['ATLASSIAN_MCP_TOKEN'],
    timeoutMs: 5000
  });

  assert.equal(config.transport, 'stdio');
  assert.equal(config.displayName, serverId);
  assert.deepEqual(validateMcpServerConfig(config), []);
  assert.deepEqual(
    validateMcpServerConfig({ ...config, command: '', timeoutMs: 0 }).map((issue) => issue.field),
    ['timeoutMs', 'command']
  );
});

test('MockMcpClient discovers and calls deterministic registered tools only', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, readTicketTool, (input) => ({
      content: {
        tool: input.toolName,
        jql: input.arguments.jql ?? null
      },
      isError: false
    }))
  ]);

  const catalog = await discoverMcpTools(client, serverId);
  const tool = requireDiscoveredMcpTool(catalog, readTicketTool);
  const result = await client.callTool({ serverId, toolName: readTicketTool, arguments: { jql: 'project = AD' } });

  assert.equal(tool.serverId, serverId);
  assert.equal(tool.name, readTicketTool);
  assert.deepEqual(client.listToolRequests, [{ serverId }]);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [readTicketTool]);
  assert.deepEqual(result.content, { tool: readTicketTool, jql: 'project = AD' });
});

test('tool discovery fails with an actionable missing-tool error', async () => {
  const catalog = await discoverMcpTools(new MockMcpClient(), serverId);

  assert.throws(() => requireDiscoveredMcpTool(catalog, 'jira.missing'), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.serverId, serverId);
    assert.equal(error.toolName, 'jira.missing');
    return true;
  });
});

test('allowlist enforcement authorizes typed port actions and blocks unapproved tools', () => {
  const allowlist = [
    {
      serverId,
      toolName: readTicketTool,
      port: 'TicketPort',
      action: 'listBacklog',
      safety: 'read'
    },
    {
      serverId,
      toolName: 'github.merge',
      port: 'CodeHostPort',
      action: 'mergeProduction',
      safety: 'danger'
    }
  ] as const;

  const authorization = assertMcpToolAllowed(
    allowlist,
    { serverId, toolName: readTicketTool, arguments: {} },
    { port: 'TicketPort', action: 'listBacklog' }
  );

  assert.equal(authorization.rule.safety, 'read');
  assert.throws(
    () =>
      assertMcpToolAllowed(allowlist, { serverId, toolName: commentTool, arguments: {} }, { port: 'TicketPort', action: 'comment' }),
    McpToolAllowlistError
  );
  assert.throws(
    () =>
      assertMcpToolAllowed(
        allowlist,
        { serverId, toolName: 'github.merge', arguments: {} },
        { port: 'CodeHostPort', action: 'mergeProduction' }
      ),
    McpToolAllowlistError
  );
});

test('audit records are deterministic and omit raw argument values from ids', () => {
  const startedAt = '2026-06-03T12:00:00.000Z';
  const first = createMcpToolCallAuditRecord({
    runId: 'run-1',
    serverId,
    toolName: readTicketTool,
    port: 'TicketPort',
    action: 'listBacklog',
    safety: 'read',
    arguments: { jql: 'project = AD', maxResults: 10 },
    status: 'started',
    startedAt
  });
  const second = createMcpToolCallAuditRecord({
    runId: 'run-1',
    serverId,
    toolName: readTicketTool,
    port: 'TicketPort',
    action: 'listBacklog',
    safety: 'read',
    arguments: { maxResults: 10, jql: 'project = AD' },
    status: 'started',
    startedAt
  });

  assert.equal(first.auditId, second.auditId);
  assert.equal(first.inputHash, second.inputHash);
  assert.equal(first.auditId.includes('project = AD'), false);
  assert.equal(first.status, 'started');
});

test('audit input hashes are stable for nested JSON objects and preserve array order', () => {
  const startedAt = '2026-06-03T12:00:00.000Z';
  const base = {
    runId: 'run-1',
    serverId,
    toolName: readTicketTool,
    port: 'TicketPort',
    action: 'listBacklog',
    safety: 'read' as const,
    status: 'started' as const,
    startedAt
  };
  const first = createMcpToolCallAuditRecord({
    ...base,
    arguments: {
      filter: {
        project: 'AD',
        order: { direction: 'asc', field: 'created' }
      },
      labels: [
        { name: 'bug', priority: 1 },
        { priority: 2, name: 'agent' }
      ],
      omitted: undefined
    }
  });
  const second = createMcpToolCallAuditRecord({
    ...base,
    arguments: {
      labels: [
        { priority: 1, name: 'bug' },
        { name: 'agent', priority: 2 }
      ],
      filter: {
        order: { field: 'created', direction: 'asc', omitted: undefined },
        project: 'AD'
      }
    }
  });
  const reorderedArray = createMcpToolCallAuditRecord({
    ...base,
    arguments: {
      filter: {
        project: 'AD',
        order: { direction: 'asc', field: 'created' }
      },
      labels: [
        { name: 'agent', priority: 2 },
        { name: 'bug', priority: 1 }
      ]
    }
  });

  assert.equal(first.inputHash, second.inputHash);
  assert.notEqual(first.inputHash, reorderedArray.inputHash);
});

test('callAllowedMcpTool enforces allowlist and writes started plus completed audits', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, commentTool, (): McpToolCallResult => ({ content: { ok: true }, isError: false }))
  ]);
  const clock = fixedClock();
  const execution = await callAllowedMcpTool({
    client,
    allowlist: [
      {
        serverId,
        toolName: commentTool,
        port: 'TicketPort',
        action: 'comment',
        safety: 'write'
      }
    ],
    call: { serverId, toolName: commentTool, arguments: { key: 'AD-1' }, timeoutMs: 1000 },
    context: { port: 'TicketPort', action: 'comment' },
    runId: 'run-1',
    now: clock
  });

  assert.deepEqual(execution.result.content, { ok: true });
  assert.deepEqual(execution.auditRecords.map((record) => record.status), ['started', 'succeeded']);
  assert.equal(execution.auditRecords[1]?.finishedAt, '2026-06-03T12:00:01.000Z');
});

test('timeout and auth/session errors map to deterministic policy outcomes', async () => {
  const timeoutError = new McpToolCallTimeoutError(serverId, readTicketTool, 5);

  assert.deepEqual(mapMcpError(timeoutError), {
    kind: 'timeout',
    message: 'MCP tool atlassian.jira.search timed out after 5ms.',
    retryable: true,
    requiresHumanAction: false
  });
  assert.equal(mapMcpError(new Error('OAuth token expired')).kind, 'auth');
  assert.equal(mapMcpError(new Error('session expired')).kind, 'session');
  await assert.rejects(
    () =>
      withMcpTimeout({
        serverId,
        toolName: readTicketTool,
        timeoutMs: 1,
        operation: new Promise<string>(() => undefined)
      }),
    McpToolCallTimeoutError
  );
});

test('mock-only MCP behavior performs no live call side effects', async () => {
  let liveCallAttempts = 0;
  const recordLiveCallAttempt = (): void => {
    liveCallAttempts += 1;
  };
  const client = new MockMcpClient([
    createMockMcpTool(serverId, readTicketTool, () => {
      assert.equal(typeof recordLiveCallAttempt, 'function');
      return { content: { issues: [] }, isError: false };
    })
  ]);

  const result = await client.callTool({ serverId, toolName: readTicketTool, arguments: { query: 'mock backlog' } });

  assert.equal(liveCallAttempts, 0);
  assert.deepEqual(result.content, { issues: [] });
  assert.deepEqual(client.toolCallRequests, [{ serverId, toolName: readTicketTool, arguments: { query: 'mock backlog' } }]);
});

function fixedClock(): () => Date {
  let offset = 0;
  const base = Date.parse('2026-06-03T12:00:00.000Z');

  return () => {
    const current = new Date(base + offset);
    offset += 1000;
    return current;
  };
}

function hasAuditRecords(error: unknown): error is Error & { readonly auditRecords: readonly McpToolCallAuditRecord[] } {
  return error instanceof Error && 'auditRecords' in error;
}

test('failed allowed MCP calls expose failed audit records for callers to persist', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, commentTool, () => {
      throw new Error('provider failed');
    })
  ]);

  await assert.rejects(
    async () =>
      callAllowedMcpTool({
        client,
        allowlist: [{ serverId, toolName: commentTool, port: 'TicketPort', action: 'comment', safety: 'write' }],
        call: { serverId, toolName: commentTool, arguments: { key: 'AD-1' } },
        context: { port: 'TicketPort', action: 'comment' },
        now: fixedClock()
      }),
    (error: unknown) => {
      assert.ok(hasAuditRecords(error));
      assert.deepEqual(error.auditRecords.map((record) => record.status), ['started', 'failed']);
      assert.equal(error.auditRecords[1]?.error?.kind, 'provider_error');
      return true;
    }
  );
});

test('resolved MCP tool error results reject with failed audit records', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, commentTool, (): McpToolCallResult => ({ content: { message: 'remote validation failed' }, isError: true }))
  ]);

  await assert.rejects(
    async () =>
      callAllowedMcpTool({
        client,
        allowlist: [{ serverId, toolName: commentTool, port: 'TicketPort', action: 'comment', safety: 'write' }],
        call: { serverId, toolName: commentTool, arguments: { key: 'AD-1' } },
        context: { port: 'TicketPort', action: 'comment' },
        now: fixedClock()
      }),
    (error: unknown) => {
      assert.ok(hasAuditRecords(error));
      assert.match(error.message, /MCP tool atlassian\.jira\.comment returned an error result/);
      assert.deepEqual(error.auditRecords.map((record) => record.status), ['started', 'failed']);
      assert.equal(error.auditRecords[1]?.error?.kind, 'provider_error');
      assert.match(error.auditRecords[1]?.error?.message ?? '', /remote validation failed/);
      return true;
    }
  );
});
