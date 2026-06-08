import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import type { McpClient, McpServerConfig } from '../../mcp/index.js';
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
  const [subcommand, serverId] = options.args;

  if (subcommand !== 'inspect') {
    options.io.stderr('Unknown mcp command. Use: ewokbot mcp inspect <server-id>\n');
    return 1;
  }

  if (serverId === undefined || serverId.trim().length === 0) {
    options.io.stderr('Missing MCP server id. Use: ewokbot mcp inspect <server-id>\n');
    return 1;
  }

  return runMcpInspectCommand(serverId, options);
}

async function runMcpInspectCommand(serverId: string, options: McpCommandOptions): Promise<number> {
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
  }

  options.io.stdout('Inspect mode only listed MCP tools; no MCP tool was called.\n');
  return 0;
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
