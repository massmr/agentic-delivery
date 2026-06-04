import type { WorkspaceConfig } from '../config/index.js';
import { createGitHubMcpToolRequirements } from '../connectors/github/index.js';
import { createJiraMcpToolRequirements } from '../connectors/jira/index.js';
import { createRailwayMcpToolRequirements } from '../connectors/railway/index.js';
import type { DeliveryTicket } from '../domain/index.js';
import type { McpClient, McpServerConfig, McpToolAllowlistRule, McpToolCallAuditRecord } from '../mcp/index.js';
import { assertMcpToolAllowed, discoverMcpTools, requireDiscoveredMcpTool } from '../mcp/index.js';
import type { TicketPort } from '../ports/index.js';
import { createJiraConnector, createWorkspaceAdapters } from './adapter-factory.js';
import type { ProviderFactoryEnvironment, WorkspaceAdapters } from './adapter-factory.js';

export type RuntimeMcpClientFactory = (server: McpServerConfig) => McpClient | Promise<McpClient>;
export type RuntimeMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;

export interface RuntimeProviderFactoryOptions {
  readonly config: WorkspaceConfig;
  readonly environment?: ProviderFactoryEnvironment | undefined;
  readonly mockTickets?: readonly DeliveryTicket[] | undefined;
  readonly mcpClients?: Readonly<Record<string, McpClient | undefined>> | undefined;
  readonly createMcpClient?: RuntimeMcpClientFactory | undefined;
  readonly mcpAllowlist?: readonly McpToolAllowlistRule[] | undefined;
  readonly mcpAuditSink?: RuntimeMcpAuditSink | undefined;
}

export class RuntimeMcpClientResolutionError extends Error {
  readonly provider: string;
  readonly serverId: string;

  constructor(provider: string, serverId: string) {
    super(`${provider} MCP runtime requires an injected or constructed McpClient for server '${serverId}'. Provide mcpClients['${serverId}'] or createMcpClient.`);
    this.name = 'RuntimeMcpClientResolutionError';
    this.provider = provider;
    this.serverId = serverId;
  }
}

export class RuntimeMcpServerConfigError extends Error {
  readonly provider: string;
  readonly serverId: string;

  constructor(provider: string, serverId: string) {
    super(`${provider} MCP runtime references server '${serverId}', but that server is not configured in workspace mcp_servers.`);
    this.name = 'RuntimeMcpServerConfigError';
    this.provider = provider;
    this.serverId = serverId;
  }
}

interface RuntimeMcpBinding {
  readonly provider: 'Jira' | 'GitHub' | 'Railway';
  readonly serverId: string;
  readonly requirements: readonly McpToolAllowlistRule[];
}

export async function createRuntimeWorkspaceAdapters(options: RuntimeProviderFactoryOptions): Promise<WorkspaceAdapters> {
  const bindings = collectRuntimeMcpBindings(options.config);
  const mcpClients = await resolveRuntimeMcpClients(options, bindings);
  const requirements = bindings.flatMap((binding) => [...binding.requirements]);

  await validateRuntimeMcpReadiness(mcpClients, bindings, options.mcpAllowlist ?? requirements);

  const auditSink = options.mcpAuditSink;

  return createWorkspaceAdapters({
    config: options.config,
    environment: options.environment,
    mockTickets: options.mockTickets,
    mcpClients,
    jiraMcpAuditSink: auditSink,
    githubMcpAuditSink: auditSink,
    railwayMcpAuditSink: auditSink
  });
}

export async function createRuntimeTicketPort(options: RuntimeProviderFactoryOptions): Promise<TicketPort> {
  const binding = collectRuntimeJiraMcpBinding(options.config);

  if (binding === undefined) {
    return createJiraConnector({
      config: options.config,
      environment: options.environment,
      mockTickets: options.mockTickets,
      mcpClients: options.mcpClients,
      jiraMcpAuditSink: options.mcpAuditSink
    });
  }

  const mcpClients = await resolveRuntimeMcpClients(options, [binding]);
  await validateRuntimeMcpReadiness(mcpClients, [binding], options.mcpAllowlist ?? binding.requirements);

  return createJiraConnector({
    config: options.config,
    environment: options.environment,
    mockTickets: options.mockTickets,
    mcpClients,
    jiraMcpAuditSink: options.mcpAuditSink
  });
}

export function collectRuntimeMcpRequirements(config: WorkspaceConfig): readonly McpToolAllowlistRule[] {
  return collectRuntimeMcpBindings(config).flatMap((binding) => [...binding.requirements]);
}

function collectRuntimeMcpBindings(config: WorkspaceConfig): readonly RuntimeMcpBinding[] {
  const bindings: RuntimeMcpBinding[] = [];

  if (config.jira.mode === 'mcp') {
    const jiraBinding = collectRuntimeJiraMcpBinding(config);
    if (jiraBinding !== undefined) {
      bindings.push(jiraBinding);
    }
  }

  if (config.github.mode === 'mcp') {
    bindings.push({
      provider: 'GitHub',
      serverId: requireRuntimeServerId('GitHub', config.github.mcpServerId),
      requirements: createGitHubMcpToolRequirements(requireRuntimeServerId('GitHub', config.github.mcpServerId), config.github.mcpToolNames)
    });
  }

  if (config.railway.mode === 'mcp') {
    bindings.push({
      provider: 'Railway',
      serverId: requireRuntimeServerId('Railway', config.railway.mcpServerId),
      requirements: createRailwayMcpToolRequirements(requireRuntimeServerId('Railway', config.railway.mcpServerId), config.railway.mcpToolNames)
    });
  }

  return bindings;
}

function collectRuntimeJiraMcpBinding(config: WorkspaceConfig): RuntimeMcpBinding | undefined {
  if (config.jira.mode !== 'mcp') {
    return undefined;
  }

  const serverId = requireRuntimeServerId('Jira', config.jira.mcpServerId);

  return {
    provider: 'Jira',
    serverId,
    requirements: createJiraMcpToolRequirements(serverId, config.jira.mcpToolNames)
  };
}

async function resolveRuntimeMcpClients(
  options: RuntimeProviderFactoryOptions,
  bindings: readonly RuntimeMcpBinding[]
): Promise<Readonly<Record<string, McpClient | undefined>>> {
  const clients: Record<string, McpClient | undefined> = { ...options.mcpClients };
  const resolvedServerIds = new Set<string>();

  for (const binding of bindings) {
    if (resolvedServerIds.has(binding.serverId)) {
      continue;
    }

    const existingClient = clients[binding.serverId];
    if (existingClient !== undefined) {
      resolvedServerIds.add(binding.serverId);
      continue;
    }

    const server = findRuntimeMcpServer(options.config, binding.provider, binding.serverId);
    if (options.createMcpClient === undefined) {
      throw new RuntimeMcpClientResolutionError(binding.provider, binding.serverId);
    }

    clients[binding.serverId] = await options.createMcpClient(server);
    resolvedServerIds.add(binding.serverId);
  }

  return clients;
}

async function validateRuntimeMcpReadiness(
  clients: Readonly<Record<string, McpClient | undefined>>,
  bindings: readonly RuntimeMcpBinding[],
  allowlist: readonly McpToolAllowlistRule[]
): Promise<void> {
  const catalogsByServer = new Map<string, Awaited<ReturnType<typeof discoverMcpTools>>>();

  for (const binding of bindings) {
    const client = clients[binding.serverId];
    if (client === undefined) {
      throw new RuntimeMcpClientResolutionError(binding.provider, binding.serverId);
    }

    let catalog = catalogsByServer.get(binding.serverId);
    if (catalog === undefined) {
      catalog = await discoverMcpTools(client, binding.serverId);
      catalogsByServer.set(binding.serverId, catalog);
    }

    for (const requirement of binding.requirements) {
      requireDiscoveredMcpTool(catalog, requirement.toolName);
      assertMcpToolAllowed(
        allowlist,
        { serverId: requirement.serverId, toolName: requirement.toolName, arguments: {} },
        { port: requirement.port, action: requirement.action }
      );
    }
  }
}

function findRuntimeMcpServer(config: WorkspaceConfig, provider: string, serverId: string): McpServerConfig {
  const server = config.mcpServers.find((candidate) => candidate.id === serverId);

  if (server === undefined) {
    throw new RuntimeMcpServerConfigError(provider, serverId);
  }

  return server;
}

function requireRuntimeServerId(provider: string, serverId: string | undefined): string {
  if (serverId === undefined) {
    throw new RuntimeMcpServerConfigError(provider, '');
  }

  return serverId;
}
