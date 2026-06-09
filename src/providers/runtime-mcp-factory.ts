import type { WorkspaceConfig } from '../config/index.js';
import type { GitHubConnector } from '../connectors/github/index.js';
import { createGitHubMcpToolRequirements } from '../connectors/github/index.js';
import { createJiraMcpToolRequirements } from '../connectors/jira/index.js';
import { createRailwayMcpToolRequirements } from '../connectors/railway/index.js';
import type { DeliveryTicket } from '../domain/index.js';
import type { McpClient, McpPolicyConfig, McpPolicyDecision, McpServerConfig, McpToolAllowlistRule, McpToolCallAuditRecord } from '../mcp/index.js';
import { assertMcpToolAllowed, createMcpToolRegistry, discoverMcpTools, evaluateMcpToolPolicy, inferMcpToolRegistryProvider, requireDiscoveredMcpTool } from '../mcp/index.js';
import type { TicketPort } from '../ports/index.js';
import { createGitHubConnector, createJiraConnector, createWorkspaceAdapters } from './adapter-factory.js';
import type { ProviderFactoryEnvironment, WorkspaceAdapters } from './adapter-factory.js';

export type RuntimeMcpClientFactory = (server: McpServerConfig) => McpClient | Promise<McpClient>;
export type RuntimeMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;
export type RuntimeJiraMcpAction = 'listBacklog' | 'getTicket' | 'comment';
export type RuntimeGitHubMcpAction = 'createBranch' | 'openPullRequest' | 'getChecks' | 'commentOnPullRequest';

export interface RuntimeProviderFactoryOptions {
  readonly config: WorkspaceConfig;
  readonly environment?: ProviderFactoryEnvironment | undefined;
  readonly mockTickets?: readonly DeliveryTicket[] | undefined;
  readonly mcpClients?: Readonly<Record<string, McpClient | undefined>> | undefined;
  readonly createMcpClient?: RuntimeMcpClientFactory | undefined;
  readonly mcpAllowlist?: readonly McpToolAllowlistRule[] | undefined;
  readonly mcpAuditSink?: RuntimeMcpAuditSink | undefined;
  readonly requiredJiraMcpActions?: readonly RuntimeJiraMcpAction[] | undefined;
  readonly requiredGitHubMcpActions?: readonly RuntimeGitHubMcpAction[] | undefined;
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

export class RuntimeMcpPolicyError extends Error {
  readonly provider: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly decision: McpPolicyDecision;

  constructor(input: { readonly provider: string; readonly serverId: string; readonly toolName: string; readonly decision: McpPolicyDecision; readonly reason: string }) {
    super(`${input.provider} MCP runtime tool '${input.toolName}' on server '${input.serverId}' is blocked by MCP policy (${input.decision}): ${input.reason}${formatPolicyNextAction(input)}`);
    this.name = 'RuntimeMcpPolicyError';
    this.provider = input.provider;
    this.serverId = input.serverId;
    this.toolName = input.toolName;
    this.decision = input.decision;
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

  await validateRuntimeMcpReadiness(mcpClients, bindings, options.mcpAllowlist ?? requirements, options.config.mcpPolicy);

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

  const scopedBinding = scopeJiraMcpBinding(binding, options.requiredJiraMcpActions);
  const mcpClients = await resolveRuntimeMcpClients(options, [scopedBinding]);
  await validateRuntimeMcpReadiness(mcpClients, [scopedBinding], options.mcpAllowlist ?? scopedBinding.requirements, options.config.mcpPolicy);

  return createJiraConnector({
    config: options.config,
    environment: options.environment,
    mockTickets: options.mockTickets,
    mcpClients,
    jiraMcpAuditSink: options.mcpAuditSink
  });
}

export async function createRuntimeCodeHostPort(options: RuntimeProviderFactoryOptions): Promise<GitHubConnector> {
  const binding = collectRuntimeGitHubMcpBinding(options.config);

  if (binding === undefined) {
    return createGitHubConnector({
      config: options.config,
      environment: options.environment,
      mcpClients: options.mcpClients,
      githubMcpAuditSink: options.mcpAuditSink
    });
  }

  const scopedBinding = scopeMcpBinding(binding, options.requiredGitHubMcpActions);
  const mcpClients = await resolveRuntimeMcpClients(options, [scopedBinding]);
  await validateRuntimeMcpReadiness(mcpClients, [scopedBinding], options.mcpAllowlist ?? scopedBinding.requirements, options.config.mcpPolicy);

  return createGitHubConnector({
    config: options.config,
    environment: options.environment,
    mcpClients,
    githubMcpAuditSink: options.mcpAuditSink
  });
}

function scopeJiraMcpBinding(binding: RuntimeMcpBinding, actions: readonly RuntimeJiraMcpAction[] | undefined): RuntimeMcpBinding {
  return scopeMcpBinding(binding, actions);
}

function scopeMcpBinding(binding: RuntimeMcpBinding, actions: readonly string[] | undefined): RuntimeMcpBinding {
  if (actions === undefined) {
    return binding;
  }

  const actionSet = new Set<string>(actions);

  return {
    ...binding,
    requirements: binding.requirements.filter((requirement) => actionSet.has(requirement.action))
  };
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

function collectRuntimeGitHubMcpBinding(config: WorkspaceConfig): RuntimeMcpBinding | undefined {
  if (config.github.mode !== 'mcp') {
    return undefined;
  }

  const serverId = requireRuntimeServerId('GitHub', config.github.mcpServerId);

  return {
    provider: 'GitHub',
    serverId,
    requirements: createGitHubMcpToolRequirements(serverId, config.github.mcpToolNames)
  };
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
  allowlist: readonly McpToolAllowlistRule[],
  policy: McpPolicyConfig
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
      assertRuntimeMcpPolicyAllowsRequirement(binding, catalog, requirement, policy);
      assertMcpToolAllowed(
        allowlist,
        { serverId: requirement.serverId, toolName: requirement.toolName, arguments: {} },
        { port: requirement.port, action: requirement.action }
      );
    }
  }
}

function assertRuntimeMcpPolicyAllowsRequirement(
  binding: RuntimeMcpBinding,
  catalog: Awaited<ReturnType<typeof discoverMcpTools>>,
  requirement: McpToolAllowlistRule,
  policy: McpPolicyConfig
): void {
  const registry = createMcpToolRegistry({
    provider: inferMcpToolRegistryProvider(binding.serverId),
    serverId: binding.serverId,
    tools: catalog.tools
  });
  const entry = registry.entries.find((candidate) => candidate.toolName === requirement.toolName);

  if (entry === undefined) {
    return;
  }

  const evaluation = evaluateMcpToolPolicy({ entry, policy });

  if (evaluation.decision === 'allow') {
    return;
  }

  throw new RuntimeMcpPolicyError({
    provider: binding.provider,
    serverId: binding.serverId,
    toolName: requirement.toolName,
    decision: evaluation.decision,
    reason: evaluation.reason
  });
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

function formatPolicyNextAction(input: { readonly provider: string; readonly toolName: string }): string {
  if (input.provider !== 'GitHub' || input.toolName !== 'create_pull_request') {
    return '';
  }

  return ' To allow BA develop PR handoff, configure mcp_policy.tools.create_pull_request.decision: allow with reason: Develop PR handoff is allowed after local evidence.';
}
