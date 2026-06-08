import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import type { JsonObject, JsonValue, McpClient, McpServerConfig, McpToolDefinition } from '../../mcp/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface McpCommandOptions {
  readonly args: readonly string[];
  readonly configPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly io: CliProgramIO;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
}

export async function runMcpCommand(options: McpCommandOptions): Promise<number> {
  const [subcommand, serverId, ...flags] = options.args;

  if (subcommand !== 'inspect') {
    options.io.stderr('Unknown mcp command. Use: ewokbot mcp inspect <server-id> [--schema|--json]\n');
    return 1;
  }

  if (serverId === undefined || serverId.trim().length === 0) {
    options.io.stderr('Missing MCP server id. Use: ewokbot mcp inspect <server-id> [--schema|--json]\n');
    return 1;
  }

  const inspectOptions = parseMcpInspectOptions(flags);

  if (inspectOptions.kind === 'error') {
    options.io.stderr(`${inspectOptions.message}\n`);
    return 1;
  }

  return runMcpInspectCommand(serverId, inspectOptions.options, options);
}

interface McpInspectRenderOptions {
  readonly includeSchemas: boolean;
  readonly outputJson: boolean;
}

async function runMcpInspectCommand(serverId: string, inspectOptions: McpInspectRenderOptions, options: McpCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveMcpConfigPath(cwd, options.configPath);
  const config = await loadWorkspaceConfig(configPath, { workspaceRoot: cwd });
  const server = config.mcpServers.find((candidate) => candidate.id === serverId);

  if (server === undefined) {
    options.io.stderr(`MCP server '${serverId}' is not configured in ${ewokbotWorkspaceConfigPath}.\n`);
    return 1;
  }

  const client = await resolveMcpClient(server, cwd, options);
  const tools = await client.listTools({ serverId: server.id });

  if (inspectOptions.outputJson) {
    options.io.stdout(`${JSON.stringify(createMcpInspectJsonPayload(server, tools), null, 2)}\n`);
    return 0;
  }

  options.io.stdout(`MCP server: ${server.id}\n`);
  options.io.stdout(`Transport: ${server.transport}\n`);

  if (server.transport === 'stdio') {
    options.io.stdout(`Command: ${[server.command, ...(server.args ?? [])].filter((value): value is string => value !== undefined && value.length > 0).join(' ')}\n`);
  } else if (server.url !== undefined) {
    options.io.stdout(`URL: ${server.url}\n`);
  }

  options.io.stdout(`Tools: ${tools.length}\n`);

  for (const tool of tools) {
    const description = tool.description.trim();
    options.io.stdout(`- ${tool.name}${description.length > 0 ? `: ${description}` : ''}\n`);

    if (inspectOptions.includeSchemas) {
      writeSchemaBlock('inputSchema', tool.inputSchema, options.io);

      if (tool.outputSchema !== undefined) {
        writeSchemaBlock('outputSchema', tool.outputSchema, options.io);
      }

      if (tool.outputMetadata !== undefined) {
        writeSchemaBlock('outputMetadata', tool.outputMetadata, options.io);
      }
    }
  }

  options.io.stdout('Inspect mode only listed MCP tools; no MCP tool was called.\n');
  return 0;
}

function parseMcpInspectOptions(flags: readonly string[]): { readonly kind: 'ok'; readonly options: McpInspectRenderOptions } | { readonly kind: 'error'; readonly message: string } {
  let includeSchemas = false;
  let outputJson = false;

  for (const flag of flags) {
    if (flag === '--schema') {
      includeSchemas = true;
    } else if (flag === '--json') {
      outputJson = true;
    } else {
      return { kind: 'error', message: `Unsupported MCP inspect option '${flag}'. Supported options: --schema, --json.` };
    }
  }

  return { kind: 'ok', options: { includeSchemas, outputJson } };
}

function createMcpInspectJsonPayload(server: McpServerConfig, tools: readonly McpToolDefinition[]): JsonObject {
  return {
    server: sanitizeJsonValue({
      id: server.id,
      transport: server.transport,
      command: server.transport === 'stdio' ? server.command : undefined,
      args: server.transport === 'stdio' ? server.args : undefined,
      url: server.transport === 'http' ? server.url : undefined
    }),
    tools: tools.map((tool) => sanitizeJsonValue({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      outputMetadata: tool.outputMetadata
    })),
    safety: {
      inspectOnly: true,
      mcpMethodsCalled: ['listTools'],
      toolCallsPerformed: 0
    }
  };
}

function writeSchemaBlock(label: string, value: JsonObject, io: CliProgramIO): void {
  io.stdout(`  ${label}:\n${indentJson(sanitizeJsonValue(value), 4)}\n`);
}

function indentJson(value: JsonValue, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n');
}

function sanitizeJsonValue(value: JsonValue, path: readonly string[] = []): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeJsonValue(item, [...path, String(index)]));
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, JsonValue | undefined> = {};

    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        sanitized[key] = sanitizeJsonValue(child, [...path, key]);
      }
    }

    return sanitized;
  }

  if (shouldRedactPrimitive(value, path)) {
    return '[redacted]';
  }

  return value;
}

function shouldRedactPrimitive(value: JsonValue, path: readonly string[]): boolean {
  const currentKey = path[path.length - 1] ?? '';
  const parentKey = path[path.length - 2] ?? '';
  const parentPath = path.slice(0, -1);
  const hasSensitiveParent = parentPath.some((segment) => isSensitiveName(segment));
  const hasSecretValueContainer = path.some((segment) => isSecretValueName(segment));

  if (hasSensitiveParent && hasSecretValueContainer) {
    return true;
  }

  if (isSensitiveName(currentKey)) {
    return true;
  }

  if (value === null || typeof value === 'boolean') {
    return false;
  }

  return typeof value === 'string' && (isSecretValueName(currentKey) || isSecretValueName(parentKey)) && looksCredentialLike(value);
}

function isSensitiveName(value: string): boolean {
  const normalized = value.replace(/[-_\s]/gu, '').toLowerCase();
  return normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('apikey')
    || normalized.includes('clientsecret')
    || normalized.includes('accesstoken')
    || normalized.includes('refreshtoken');
}

function isSecretValueName(value: string): boolean {
  return value === 'default' || value === 'example' || value === 'examples' || value === 'const' || value === 'enum';
}

function looksCredentialLike(value: string): boolean {
  return /^(bearer\s+)?(gh[pousr]_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|xox[a-z]-[a-z0-9-]{20,}|[a-z0-9_+./=-]{32,})$/iu.test(value.trim());
}

async function resolveMcpClient(server: McpServerConfig, cwd: string, options: McpCommandOptions): Promise<McpClient> {
  const injected = options.runtimeMcp?.mcpClients?.[server.id];

  if (injected !== undefined) {
    return injected;
  }

  if (options.runtimeMcp?.createMcpClient === undefined) {
    throw new Error(`MCP inspect requires an injected or constructed McpClient for server '${server.id}'. Provide runtime MCP construction or run from the public CLI.`);
  }

  return await options.runtimeMcp.createMcpClient(server);
}

function resolveMcpConfigPath(cwd: string, configPath: string | undefined): string {
  if (configPath !== undefined) {
    return resolve(cwd, configPath);
  }

  return resolve(cwd, ewokbotWorkspaceConfigPath);
}
