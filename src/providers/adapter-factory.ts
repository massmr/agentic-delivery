import type { WorkspaceConfig } from '../config/workspace-config.js';
import { MockGitHubConnector } from '../connectors/github/mock-github-connector.js';
import type { GitHubConnector } from '../connectors/github/github-connector.js';
import { GitHubMcpCodeHostPort } from '../connectors/github/github-mcp-code-host-port.js';
import type { GitHubMcpAuditSink } from '../connectors/github/github-mcp-code-host-port.js';
import { MockJiraConnector } from '../connectors/jira/mock-jira-connector.js';
import { JiraMcpTicketPort } from '../connectors/jira/jira-mcp-ticket-port.js';
import type { JiraMcpAuditSink } from '../connectors/jira/jira-mcp-ticket-port.js';
import type { JiraConnector } from '../connectors/jira/jira-connector.js';
import { MockRailwayConnector } from '../connectors/railway/mock-railway-connector.js';
import { RailwayMcpDeploymentPort } from '../connectors/railway/railway-mcp-deployment-port.js';
import type { RailwayMcpAuditSink } from '../connectors/railway/railway-mcp-deployment-port.js';
import type { RailwayConnector } from '../connectors/railway/railway-connector.js';
import type { DeliveryTicket } from '../domain/ticket.js';
import type { DevRunner } from '../domain/dev-runner.js';
import type { McpClient } from '../mcp/index.js';
import { MockOpenCodeRunner } from '../runners/opencode/mock-opencode-runner.js';
import { OpenCodeSubprocessRunner } from '../runners/opencode/opencode-runner.js';

export type ProviderFactoryEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProviderFactoryOptions {
  readonly config: WorkspaceConfig;
  readonly environment?: ProviderFactoryEnvironment;
  readonly mockTickets?: readonly DeliveryTicket[];
  readonly mcpClients?: Readonly<Record<string, McpClient | undefined>> | undefined;
  readonly jiraMcpAuditSink?: JiraMcpAuditSink | undefined;
  readonly githubMcpAuditSink?: GitHubMcpAuditSink | undefined;
  readonly railwayMcpAuditSink?: RailwayMcpAuditSink | undefined;
}

export interface WorkspaceAdapters {
  readonly jira: JiraConnector;
  readonly github: GitHubConnector;
  readonly railway: RailwayConnector;
  readonly devRunner: DevRunner;
}

export class ProviderCredentialError extends Error {
  readonly provider: string;
  readonly variableName: string;

  constructor(provider: string, variableName: string) {
    super(`${provider} real adapter requires ${variableName}. Set ${variableName} before selecting real mode.`);
    this.name = 'ProviderCredentialError';
    this.provider = provider;
    this.variableName = variableName;
  }
}

export class RealProviderAdapterUnavailableError extends Error {
  readonly provider: string;

  constructor(provider: string, milestone: string) {
    super(`${provider} real adapter is not implemented yet. Complete ${milestone} before live provider calls are allowed.`);
    this.name = 'RealProviderAdapterUnavailableError';
    this.provider = provider;
  }
}

export class ProviderMcpClientError extends Error {
  readonly provider: string;
  readonly serverId: string;

  constructor(provider: string, serverId: string) {
    super(`${provider} MCP adapter requires an injected McpClient for server '${serverId}'. Pass mcpClients['${serverId}'] to the provider factory.`);
    this.name = 'ProviderMcpClientError';
    this.provider = provider;
    this.serverId = serverId;
  }
}

export function createWorkspaceAdapters(options: ProviderFactoryOptions): WorkspaceAdapters {
  return {
    jira: createJiraConnector(options),
    github: createGitHubConnector(options),
    railway: createRailwayConnector(options),
    devRunner: createDevRunner(options)
  };
}

export function createJiraConnector(options: ProviderFactoryOptions): JiraConnector {
  if (options.config.jira.mode === 'mock') {
    return new MockJiraConnector(options.config, options.mockTickets);
  }

  if (options.config.jira.mode === 'mcp') {
    const serverId = options.config.jira.mcpServerId;
    const client = serverId === undefined ? undefined : options.mcpClients?.[serverId];

    if (serverId === undefined || client === undefined) {
      throw new ProviderMcpClientError('Jira', serverId ?? '');
    }

    const server = options.config.mcpServers.find((candidate) => candidate.id === serverId);

    return new JiraMcpTicketPort({
      client,
      serverId,
      baseUrl: options.config.jira.baseUrl,
      projectKeys: options.config.jira.projectKeys,
      timeoutMs: server?.timeoutMs,
      toolNames: options.config.jira.mcpToolNames,
      auditSink: options.jiraMcpAuditSink
    });
  }

  requireCredential(options.environment, 'Jira', 'JIRA_EMAIL');
  requireCredential(options.environment, 'Jira', 'JIRA_API_TOKEN');
  throw new RealProviderAdapterUnavailableError('Jira', 'Milestone N');
}

export function createGitHubConnector(options: ProviderFactoryOptions): GitHubConnector {
  if (options.config.github.mode === 'mock') {
    return new MockGitHubConnector();
  }

  if (options.config.github.mode === 'mcp') {
    const serverId = options.config.github.mcpServerId;
    const client = serverId === undefined ? undefined : options.mcpClients?.[serverId];

    if (serverId === undefined || client === undefined) {
      throw new ProviderMcpClientError('GitHub', serverId ?? '');
    }

    const server = options.config.mcpServers.find((candidate) => candidate.id === serverId);

    return new GitHubMcpCodeHostPort({
      client,
      serverId,
      timeoutMs: server?.timeoutMs,
      toolNames: options.config.github.mcpToolNames,
      auditSink: options.githubMcpAuditSink
    });
  }

  requireCredential(options.environment, 'GitHub', 'GITHUB_TOKEN');
  throw new RealProviderAdapterUnavailableError('GitHub', 'Milestone O');
}

export function createRailwayConnector(options: ProviderFactoryOptions): RailwayConnector {
  if (options.config.railway.mode === 'mock') {
    return new MockRailwayConnector();
  }

  if (options.config.railway.mode === 'mcp') {
    const serverId = options.config.railway.mcpServerId;
    const client = serverId === undefined ? undefined : options.mcpClients?.[serverId];

    if (serverId === undefined || client === undefined) {
      throw new ProviderMcpClientError('Railway', serverId ?? '');
    }

    const server = options.config.mcpServers.find((candidate) => candidate.id === serverId);

    return new RailwayMcpDeploymentPort({
      client,
      serverId,
      timeoutMs: server?.timeoutMs,
      toolNames: options.config.railway.mcpToolNames,
      auditSink: options.railwayMcpAuditSink
    });
  }

  requireCredential(options.environment, 'Railway', 'RAILWAY_TOKEN');
  throw new RealProviderAdapterUnavailableError('Railway', 'Milestone P');
}

export function createDevRunner(options: ProviderFactoryOptions): DevRunner {
  if (options.config.devRunner.mode === 'mock') {
    return new MockOpenCodeRunner();
  }

  return new OpenCodeSubprocessRunner();
}

function requireCredential(environment: ProviderFactoryEnvironment | undefined, provider: string, variableName: string): void {
  const value = environment?.[variableName];

  if (value === undefined || value.trim().length === 0) {
    throw new ProviderCredentialError(provider, variableName);
  }
}
