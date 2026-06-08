import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { McpCallToolInput, McpClient, McpListToolsInput, McpToolCallResult, McpToolDefinition } from './client.js';
import type { JsonObject, JsonValue } from './json.js';
import type { McpServerConfig, McpServerTransport } from './server-config.js';

export interface RuntimeMcpSdkClient {
  connect(transport: RuntimeMcpSdkTransport, options?: RuntimeMcpRequestOptions): Promise<void>;
  listTools(params?: JsonObject, options?: RuntimeMcpRequestOptions): Promise<unknown>;
  callTool(params: { readonly name: string; readonly arguments: JsonObject }, resultSchema?: unknown, options?: RuntimeMcpRequestOptions): Promise<unknown>;
  close(): Promise<void>;
}

export interface RuntimeMcpSdkTransport {
  close(): Promise<void>;
}

export interface RuntimeMcpRequestOptions {
  readonly timeout?: number | undefined;
}

export interface RuntimeMcpStdioTransportParameters {
  readonly command: string;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
  readonly stderr?: 'inherit' | 'pipe' | 'ignore' | undefined;
}

export interface CreateSdkRuntimeMcpClientOptions {
  readonly clientFactory?: ((server: McpServerConfig) => RuntimeMcpSdkClient) | undefined;
  readonly transportFactory?: ((parameters: RuntimeMcpStdioTransportParameters) => RuntimeMcpSdkTransport) | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly cwd?: string | undefined;
}

export class RuntimeMcpUnsupportedTransportError extends Error {
  readonly serverId: string;
  readonly transport: McpServerTransport;

  constructor(server: McpServerConfig) {
    super(
      `MCP server ${server.id} (${server.displayName}) uses transport '${server.transport}', but the public CLI currently supports only stdio MCP servers. Configure mcp_servers.${server.id}.command and args, for example npx -y mcp-remote <server-url>.`
    );
    this.name = 'RuntimeMcpUnsupportedTransportError';
    this.serverId = server.id;
    this.transport = server.transport;
  }
}

export class RuntimeMcpClientStartupError extends Error {
  readonly serverId: string;
  readonly serverDisplayName: string;
  readonly originalError: unknown;

  constructor(server: McpServerConfig, originalError: unknown) {
    super(`MCP server ${server.id} (${server.displayName}) could not be started or initialized: ${formatUnknownError(originalError)}`);
    this.name = 'RuntimeMcpClientStartupError';
    this.serverId = server.id;
    this.serverDisplayName = server.displayName;
    this.originalError = originalError;
  }
}

const safeInheritedEnvironmentVariables = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP'] as const;

export async function createSdkRuntimeMcpClient(server: McpServerConfig, options: CreateSdkRuntimeMcpClientOptions = {}): Promise<McpClient> {
  if (server.transport !== 'stdio') {
    throw new RuntimeMcpUnsupportedTransportError(server);
  }

  if (server.command === undefined || server.command.trim().length === 0) {
    throw new RuntimeMcpClientStartupError(server, new Error(`mcp_servers.${server.id}.command must be configured for stdio MCP runtime construction.`));
  }

  const environment = options.environment ?? process.env;
  const client = options.clientFactory?.(server) ?? createDefaultSdkClient(server);
  const transportParameters: RuntimeMcpStdioTransportParameters = {
    command: server.command,
    args: server.args,
    env: createInheritedEnvironment(server, environment),
    cwd: options.cwd,
    stderr: 'inherit'
  };
  const transport = options.transportFactory?.(transportParameters) ?? createDefaultStdioTransport(transportParameters);

  try {
    await client.connect(transport, { timeout: server.timeoutMs });
  } catch (error) {
    await closeQuietly(client, transport);
    throw new RuntimeMcpClientStartupError(server, error);
  }

  return new SdkRuntimeMcpClient(server, client, transport);
}

class SdkRuntimeMcpClient implements McpClient {
  constructor(
    private readonly server: McpServerConfig,
    private readonly client: RuntimeMcpSdkClient,
    private readonly transport: RuntimeMcpSdkTransport
  ) {}

  async listTools(_input: McpListToolsInput): Promise<readonly McpToolDefinition[]> {
    const result = await this.client.listTools({}, { timeout: this.server.timeoutMs });
    const resultObject = expectRecord(result, `MCP server ${this.server.id} listTools result`);
    const tools = resultObject.tools;

    if (!Array.isArray(tools)) {
      throw new Error(`MCP server ${this.server.id} listTools result must include a tools array.`);
    }

    return tools.map((tool, index) => normalizeToolDefinition(this.server.id, tool, index));
  }

  async callTool(input: McpCallToolInput): Promise<McpToolCallResult> {
    const result = await this.client.callTool(
      {
        name: input.toolName,
        arguments: input.arguments
      },
      undefined,
      { timeout: input.timeoutMs ?? this.server.timeoutMs }
    );

    return normalizeToolCallResult(this.server.id, result);
  }

  async close(): Promise<void> {
    await closeQuietly(this.client, this.transport);
  }
}

function createDefaultSdkClient(server: McpServerConfig): RuntimeMcpSdkClient {
  return new Client({ name: `ewokbot-${server.id}`, version: '0.1.0' });
}

function createDefaultStdioTransport(parameters: RuntimeMcpStdioTransportParameters): RuntimeMcpSdkTransport {
  return new StdioClientTransport({
    command: parameters.command,
    args: [...(parameters.args ?? [])],
    env: { ...(parameters.env ?? {}) },
    cwd: parameters.cwd,
    stderr: parameters.stderr
  });
}

function createInheritedEnvironment(server: McpServerConfig, environment: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const names = new Set<string>([...safeInheritedEnvironmentVariables, ...(server.envVarNames ?? [])]);
  const inherited: Record<string, string> = {};

  for (const name of names) {
    const value = environment[name];
    if (value !== undefined) {
      inherited[name] = value;
    }
  }

  return inherited;
}

function normalizeToolDefinition(serverId: string, tool: unknown, index: number): McpToolDefinition {
  const object = expectRecord(tool, `MCP server ${serverId} tools[${index}]`);
  const name = object.name;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`MCP server ${serverId} tools[${index}].name must be a non-empty string.`);
  }

  const definition: McpToolDefinition = {
    name,
    description: typeof object.description === 'string' ? object.description : '',
    inputSchema: toJsonObject(object.inputSchema ?? {})
  };

  const outputSchema = toOptionalJsonObject(object.outputSchema, `MCP server ${serverId} tools[${index}].outputSchema`);
  const outputMetadata = toOptionalJsonObject(object.outputMetadata, `MCP server ${serverId} tools[${index}].outputMetadata`);

  return {
    ...definition,
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(outputMetadata !== undefined ? { outputMetadata } : {})
  };
}

function normalizeToolCallResult(serverId: string, result: unknown): McpToolCallResult {
  const object = expectRecord(result, `MCP server ${serverId} callTool result`);
  const isError = object.isError === true;

  if (object.structuredContent !== undefined) {
    return { content: toJsonValue(object.structuredContent), isError };
  }

  if (object.toolResult !== undefined) {
    return { content: toJsonValue(object.toolResult), isError };
  }

  if (Array.isArray(object.content)) {
    return { content: normalizeContentArray(object.content), isError };
  }

  return { content: toJsonObject(object), isError };
}

function normalizeContentArray(content: readonly unknown[]): JsonValue {
  if (content.length === 1) {
    const first = content[0];
    if (isRecord(first) && first.type === 'text' && typeof first.text === 'string') {
      return parseJsonText(first.text);
    }
  }

  return { content: toJsonValue(content) };
}

function parseJsonText(text: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(text));
  } catch (parseError) {
    void parseError;
    return text;
  }
}

function toJsonObject(value: unknown): JsonObject {
  const jsonValue = toJsonValue(value);
  if (isJsonObjectValue(jsonValue)) {
    return jsonValue;
  }

  throw new Error('Expected a JSON object.');
}

function toOptionalJsonObject(value: unknown, path: string): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }

  const jsonValue = toJsonValue(value);
  if (isJsonObjectValue(jsonValue)) {
    return jsonValue;
  }

  throw new Error(`${path} must be a JSON object.`);
}

function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (isRecord(value)) {
    const object: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        object[key] = toJsonValue(child);
      }
    }
    return object;
  }

  return String(value);
}

function expectRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (isRecord(value)) {
    return value;
  }

  throw new Error(`${path} must be an object.`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function closeQuietly(client: RuntimeMcpSdkClient, transport: RuntimeMcpSdkTransport): Promise<void> {
  try {
    await client.close();
  } catch (clientCloseError) {
    void clientCloseError;
  }

  try {
    await transport.close();
  } catch (transportCloseError) {
    void transportCloseError;
    return;
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
