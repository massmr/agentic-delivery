import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import { createMcpToolRegistry, inferMcpToolRegistryProvider, sanitizeMcpJsonValue } from '../../mcp/index.js';
import type { JsonObject, JsonValue, McpClient, McpServerConfig, McpToolDefinition, McpToolRegistry } from '../../mcp/index.js';
import { ewokbotMcpToolsCacheDirectory, ewokbotWorkspaceConfigPath, getEwokbotMcpToolRegistrySnapshotPath } from '../../workspace-layout.js';
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
    options.io.stderr('Unknown mcp command. Use: ewokbot mcp inspect <server-id> [--schema|--json] [--cache-registry]\n');
    return 1;
  }

  if (serverId === undefined || serverId.trim().length === 0) {
    options.io.stderr('Missing MCP server id. Use: ewokbot mcp inspect <server-id> [--schema|--json] [--cache-registry]\n');
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
  readonly cacheRegistry: boolean;
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
  const registry = createMcpToolRegistry({ provider: inferMcpToolRegistryProvider(server.id), serverId: server.id, tools });
  const payload = createMcpInspectJsonPayload(server, tools, registry);

  if (inspectOptions.cacheRegistry) {
    await writeMcpToolRegistrySnapshot(cwd, server.id, payload);
  }

  if (inspectOptions.outputJson) {
    options.io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
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
  options.io.stdout(`Registry entries: ${registry.entries.length}\n`);

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

  if (inspectOptions.cacheRegistry) {
    options.io.stdout(`Registry cache snapshot: ${getEwokbotMcpToolRegistrySnapshotPath(server.id)}\n`);
  }

  options.io.stdout('Inspect mode only listed MCP tools; no MCP tool was called.\n');
  return 0;
}

function parseMcpInspectOptions(flags: readonly string[]): { readonly kind: 'ok'; readonly options: McpInspectRenderOptions } | { readonly kind: 'error'; readonly message: string } {
  let includeSchemas = false;
  let outputJson = false;
  let cacheRegistry = false;

  for (const flag of flags) {
    if (flag === '--schema') {
      includeSchemas = true;
    } else if (flag === '--json') {
      outputJson = true;
    } else if (flag === '--cache-registry') {
      cacheRegistry = true;
    } else {
      return { kind: 'error', message: `Unsupported MCP inspect option '${flag}'. Supported options: --schema, --json, --cache-registry.` };
    }
  }

  return { kind: 'ok', options: { includeSchemas, outputJson, cacheRegistry } };
}

function createMcpInspectJsonPayload(server: McpServerConfig, tools: readonly McpToolDefinition[], registry: McpToolRegistry): JsonObject {
  return {
    server: sanitizeMcpJsonValue({
      id: server.id,
      transport: server.transport,
      command: server.transport === 'stdio' ? server.command : undefined,
      args: server.transport === 'stdio' ? server.args : undefined,
      url: server.transport === 'http' ? server.url : undefined
    }) as JsonObject,
    tools: tools.map((tool) => sanitizeMcpJsonValue({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      outputMetadata: tool.outputMetadata
    }) as JsonObject),
    registry: registryToJsonObject(registry),
    safety: {
      inspectOnly: true,
      mcpMethodsCalled: ['listTools'],
      toolCallsPerformed: 0
    }
  };
}

function registryToJsonObject(registry: McpToolRegistry): JsonObject {
  return {
    provider: registry.provider,
    serverId: registry.serverId,
    entries: registry.entries.map((entry) => {
      return {
        provider: entry.provider,
        serverId: entry.serverId,
        toolName: entry.toolName,
        description: entry.description,
        inputSchema: entry.inputSchema,
        category: entry.category,
        classification: entry.classification,
        source: entry.source,
        defaultAuthorization: entry.defaultAuthorization,
        policyRequired: entry.policyRequired,
        ...(entry.outputSchema === undefined ? {} : { outputSchema: entry.outputSchema }),
        ...(entry.outputMetadata === undefined ? {} : { outputMetadata: entry.outputMetadata }),
        ...(entry.unknownReason === undefined ? {} : { unknownReason: entry.unknownReason })
      };
    }),
    safety: {
      source: registry.safety.source,
      defaultAuthorization: registry.safety.defaultAuthorization,
      unknownToolsDeniedByDefault: registry.safety.unknownToolsDeniedByDefault,
      mcpMethodsCalled: registry.safety.mcpMethodsCalled,
      toolCallsPerformed: registry.safety.toolCallsPerformed
    }
  };
}

function writeSchemaBlock(label: string, value: JsonObject, io: CliProgramIO): void {
  io.stdout(`  ${label}:\n${indentJson(sanitizeMcpJsonValue(value), 4)}\n`);
}

function indentJson(value: JsonValue, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n');
}

async function writeMcpToolRegistrySnapshot(cwd: string, serverId: string, payload: JsonObject): Promise<void> {
  await mkdir(resolve(cwd, ewokbotMcpToolsCacheDirectory), { recursive: true });
  await writeFile(resolve(cwd, getEwokbotMcpToolRegistrySnapshotPath(serverId)), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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
