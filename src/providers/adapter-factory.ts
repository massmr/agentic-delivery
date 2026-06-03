import type { WorkspaceConfig } from '../config/workspace-config.js';
import { MockGitHubConnector } from '../connectors/github/mock-github-connector.js';
import type { GitHubConnector } from '../connectors/github/github-connector.js';
import { MockJiraConnector } from '../connectors/jira/mock-jira-connector.js';
import type { JiraConnector } from '../connectors/jira/jira-connector.js';
import { MockRailwayConnector } from '../connectors/railway/mock-railway-connector.js';
import type { RailwayConnector } from '../connectors/railway/railway-connector.js';
import type { DeliveryTicket } from '../domain/ticket.js';
import type { DevRunner } from '../domain/dev-runner.js';
import { MockOpenCodeRunner } from '../runners/opencode/mock-opencode-runner.js';
import { OpenCodeSubprocessRunner } from '../runners/opencode/opencode-runner.js';

export type ProviderFactoryEnvironment = Readonly<Record<string, string | undefined>>;

export interface ProviderFactoryOptions {
  readonly config: WorkspaceConfig;
  readonly environment?: ProviderFactoryEnvironment;
  readonly mockTickets?: readonly DeliveryTicket[];
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

  requireCredential(options.environment, 'Jira', 'JIRA_EMAIL');
  requireCredential(options.environment, 'Jira', 'JIRA_API_TOKEN');
  throw new RealProviderAdapterUnavailableError('Jira', 'Milestone N');
}

export function createGitHubConnector(options: ProviderFactoryOptions): GitHubConnector {
  if (options.config.github.mode === 'mock') {
    return new MockGitHubConnector();
  }

  requireCredential(options.environment, 'GitHub', 'GITHUB_TOKEN');
  throw new RealProviderAdapterUnavailableError('GitHub', 'Milestone O');
}

export function createRailwayConnector(options: ProviderFactoryOptions): RailwayConnector {
  if (options.config.railway.mode === 'mock') {
    return new MockRailwayConnector();
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
