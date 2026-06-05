import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RuntimeMcpClientStartupError,
  RuntimeMcpUnsupportedTransportError,
  createSdkRuntimeMcpClient,
  type McpServerConfig,
  type RuntimeMcpRequestOptions,
  type RuntimeMcpSdkClient,
  type RuntimeMcpSdkTransport,
  type RuntimeMcpStdioTransportParameters
} from '../src/index.js';

test('SDK runtime MCP client constructs stdio transport with a restricted environment', async () => {
  const transports: RuntimeMcpStdioTransportParameters[] = [];
  const client = new FakeSdkClient();

  await createSdkRuntimeMcpClient(stdioServer({ envVarNames: ['ATLASSIAN_TOKEN', 'PATH'] }), {
    clientFactory: () => client,
    transportFactory: (parameters) => {
      transports.push(parameters);
      return new FakeTransport();
    },
    environment: {
      PATH: '/usr/bin',
      HOME: '/home/operator',
      ATLASSIAN_TOKEN: 'token-value',
      UNLISTED_SECRET: 'must-not-leak'
    }
  });

  assert.equal(client.connectCalls.length, 1);
  assert.equal(transports.length, 1);
  assert.equal(transports[0]?.command, 'npx');
  assert.deepEqual(transports[0]?.args, ['-y', 'mcp-remote', 'https://mcp.example.test/atlassian']);
  assert.deepEqual(transports[0]?.env, {
    PATH: '/usr/bin',
    HOME: '/home/operator',
    ATLASSIAN_TOKEN: 'token-value'
  });
});

test('SDK runtime MCP client maps listTools and structured tool results', async () => {
  const client = new FakeSdkClient({ callToolResult: { structuredContent: { issue: { key: 'AD-100' } }, isError: false } });
  const mcpClient = await createSdkRuntimeMcpClient(stdioServer(), {
    clientFactory: () => client,
    transportFactory: () => new FakeTransport()
  });

  const tools = await mcpClient.listTools({ serverId: 'atlassian' });
  const result = await mcpClient.callTool({ serverId: 'atlassian', toolName: 'jira.search', arguments: { jql: 'project = AD' } });

  assert.deepEqual(tools, [{ name: 'jira.search', description: 'Search Jira', inputSchema: { type: 'object' } }]);
  assert.deepEqual(client.callToolCalls, [
    {
      params: { name: 'jira.search', arguments: { jql: 'project = AD' } },
      resultSchema: undefined,
      options: { timeout: 15_000 }
    }
  ]);
  assert.deepEqual(result, { content: { issue: { key: 'AD-100' } }, isError: false });
});

test('SDK runtime MCP client parses JSON text content and preserves plain text', async () => {
  const jsonClient = new FakeSdkClient({ callToolResult: { content: [{ type: 'text', text: '{"ok":true}' }], isError: false } });
  const textClient = new FakeSdkClient({ callToolResult: { content: [{ type: 'text', text: 'not json' }], isError: true } });

  const jsonMcpClient = await createSdkRuntimeMcpClient(stdioServer(), {
    clientFactory: () => jsonClient,
    transportFactory: () => new FakeTransport()
  });
  const textMcpClient = await createSdkRuntimeMcpClient(stdioServer(), {
    clientFactory: () => textClient,
    transportFactory: () => new FakeTransport()
  });

  assert.deepEqual(await jsonMcpClient.callTool({ serverId: 'atlassian', toolName: 'json', arguments: {} }), { content: { ok: true }, isError: false });
  assert.deepEqual(await textMcpClient.callTool({ serverId: 'atlassian', toolName: 'text', arguments: {} }), { content: 'not json', isError: true });
});

test('SDK runtime MCP client rejects unsupported HTTP runtime configs before startup', async () => {
  const server: McpServerConfig = {
    id: 'atlassian',
    displayName: 'Atlassian MCP',
    transport: 'http',
    url: 'https://mcp.example.test/atlassian',
    timeoutMs: 15_000
  };

  await assert.rejects(() => createSdkRuntimeMcpClient(server), (error: unknown) => {
    assert.ok(error instanceof RuntimeMcpUnsupportedTransportError);
    assert.equal(error.serverId, 'atlassian');
    assert.match(error.message, /supports only stdio/u);
    return true;
  });
});

test('SDK runtime MCP client wraps missing command and startup failures with server context', async () => {
  await assert.rejects(() => createSdkRuntimeMcpClient({ ...stdioServer(), command: '' }), (error: unknown) => {
    assert.ok(error instanceof RuntimeMcpClientStartupError);
    assert.equal(error.serverId, 'atlassian');
    assert.match(error.message, /command must be configured/u);
    return true;
  });

  const client = new FakeSdkClient({ connectError: new Error('OAuth session missing') });
  const transport = new FakeTransport();

  await assert.rejects(
    () =>
      createSdkRuntimeMcpClient(stdioServer(), {
        clientFactory: () => client,
        transportFactory: () => transport
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeMcpClientStartupError);
      assert.equal(error.serverId, 'atlassian');
      assert.match(error.message, /OAuth session missing/u);
      return true;
    }
  );
  assert.equal(client.closed, true);
  assert.equal(transport.closed, true);
});

test('SDK runtime MCP client closes constructed client lifecycle', async () => {
  const client = new FakeSdkClient();
  const transport = new FakeTransport();
  const mcpClient = await createSdkRuntimeMcpClient(stdioServer(), {
    clientFactory: () => client,
    transportFactory: () => transport
  });

  await mcpClient.close?.();

  assert.equal(client.closed, true);
  assert.equal(transport.closed, true);
});

test('SDK runtime MCP client closes transport when client close throws', async () => {
  const client = new FakeSdkClient({ closeError: new Error('client already closed') });
  const transport = new FakeTransport();
  const mcpClient = await createSdkRuntimeMcpClient(stdioServer(), {
    clientFactory: () => client,
    transportFactory: () => transport
  });

  await mcpClient.close?.();

  assert.equal(client.closed, true);
  assert.equal(transport.closed, true);
});

class FakeSdkClient implements RuntimeMcpSdkClient {
  readonly connectCalls: { readonly transport: RuntimeMcpSdkTransport; readonly options?: RuntimeMcpRequestOptions }[] = [];
  readonly callToolCalls: { readonly params: { readonly name: string; readonly arguments: Record<string, unknown> }; readonly resultSchema?: unknown; readonly options?: RuntimeMcpRequestOptions }[] = [];
  closed = false;

  constructor(
    private readonly options: {
      readonly connectError?: Error | undefined;
      readonly closeError?: Error | undefined;
      readonly callToolResult?: unknown;
    } = {}
  ) {}

  async connect(transport: RuntimeMcpSdkTransport, options?: RuntimeMcpRequestOptions): Promise<void> {
    this.connectCalls.push({ transport, options });
    if (this.options.connectError !== undefined) {
      throw this.options.connectError;
    }
  }

  async listTools(): Promise<unknown> {
    return {
      tools: [{ name: 'jira.search', description: 'Search Jira', inputSchema: { type: 'object' } }]
    };
  }

  async callTool(
    params: { readonly name: string; readonly arguments: Record<string, unknown> },
    resultSchema?: unknown,
    options?: RuntimeMcpRequestOptions
  ): Promise<unknown> {
    this.callToolCalls.push({ params, resultSchema, options });
    return this.options.callToolResult ?? { structuredContent: { ok: true }, isError: false };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.options.closeError !== undefined) {
      throw this.options.closeError;
    }
  }
}

class FakeTransport implements RuntimeMcpSdkTransport {
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }
}

function stdioServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'atlassian',
    displayName: 'Atlassian MCP',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.example.test/atlassian'],
    timeoutMs: 15_000,
    ...overrides
  };
}
