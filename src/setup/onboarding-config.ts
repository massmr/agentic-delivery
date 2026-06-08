import { parseWorkspaceConfig } from '../config/index.js';
import { defaultDevRunnerEnvVarNames } from '../config/workspace-config.js';
import { atlassianJiraMcpPreset, railwayCliMcpPreset } from './connector-presets.js';
import { defaultSetupSelections, getDeploymentMonitors, getRequiredEnvPlaceholders, type McpServerSelection, type SetupSelections } from './provider-capability.js';

export interface OnboardingFiles {
  readonly workspaceYaml: string;
  readonly env: string;
  readonly envExample: string;
}

interface NormalizedSetupSelections {
  readonly deploymentMonitor: SetupSelections['deploymentMonitor'];
  readonly includeOhMyOpenAgent: boolean;
  readonly devRunnerMode: NonNullable<SetupSelections['devRunnerMode']>;
  readonly opencodeCommand: string;
  readonly opencodeArgs: readonly string[];
  readonly opencodeEnvVarNames: readonly string[];
  readonly modelProviderEnvVarNames: readonly string[];
  readonly ticketProvider: NonNullable<SetupSelections['ticketProvider']>;
  readonly jiraBaseUrl: string;
  readonly jiraProjectKeys: readonly string[];
  readonly jiraMcpServer: McpServerSelection;
  readonly codeHostProvider: NonNullable<SetupSelections['codeHostProvider']>;
  readonly githubOrganization?: string | undefined;
  readonly githubMcpServer: McpServerSelection;
  readonly railwayProvider: NonNullable<SetupSelections['railwayProvider']>;
  readonly railwayMcpServer: McpServerSelection;
  readonly envValues: Readonly<Record<string, string | undefined>>;
}

export function renderOnboardingWorkspaceConfig(selections: SetupSelections): string {
  const normalized = normalizeSelections(selections);
  const monitors = getDeploymentMonitors(normalized.deploymentMonitor);
  const optionalTools = normalized.includeOhMyOpenAgent ? ['oh-my-openagent'] : [];
  const mcpServers = collectMcpServers(normalized);
  const opencodeEnvNames = uniqueNames([...defaultDevRunnerEnvVarNames]);

  return `workspace:
  name: Ewokbot Workspace
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1

setup:
  version: 1
  dev_runner: opencode
  optional_tools:${renderYamlList(optionalTools, 4)}
  code_host: ${normalized.codeHostProvider === 'github-mcp' ? 'github-mcp' : 'mock'}
  ticket_provider: ${normalized.ticketProvider === 'jira-mcp' ? 'jira-mcp' : 'mock'}
  deployment_monitors:${renderYamlList(monitors, 4)}
  control_plane: cli

jira:
  mode: ${normalized.ticketProvider === 'jira-mcp' ? 'mcp' : 'mock'}
  base_url: ${normalized.jiraBaseUrl}
  project_keys:${renderYamlList(normalized.jiraProjectKeys, 4)}${normalized.ticketProvider === 'jira-mcp' ? `
  mcp_server: ${normalized.jiraMcpServer.id}` : ''}

github:
  mode: ${normalized.codeHostProvider === 'github-mcp' ? 'mcp' : 'mock'}${normalized.githubOrganization === undefined ? '' : `
  organization: ${normalized.githubOrganization}`}${normalized.codeHostProvider === 'github-mcp' ? `
  mcp_server: ${normalized.githubMcpServer.id}` : ''}

railway:
  mode: ${normalized.railwayProvider === 'railway-mcp' && (normalized.deploymentMonitor === 'railway' || normalized.deploymentMonitor === 'both') ? 'mcp' : 'mock'}
  staging_branch: develop
  production_branch: main${normalized.railwayProvider === 'railway-mcp' && (normalized.deploymentMonitor === 'railway' || normalized.deploymentMonitor === 'both') ? `
  mcp_server: ${normalized.railwayMcpServer.id}` : ''}

mcp_policy:
  mode: read_only
  providers: {}
  servers: {}
  tools: {}

dev_runner:
  mode: ${normalized.devRunnerMode === 'opencode' ? 'real' : 'mock'}
  provider: opencode
  command: ${normalized.opencodeCommand}
  args:${renderYamlList(normalized.opencodeArgs, 4)}
  timeout_ms: 1800000
  env_var_names:${renderYamlList(opencodeEnvNames, 4)}
  max_attempts: 2

${renderMcpServers(mcpServers)}quality:
  default_profile: node

repos:
  discovery: sibling-git-directories
  exclude: []
`;
}

export function renderEnvExample(selections: SetupSelections): string {
  return renderEnvFile(selections, true);
}

export function renderEnv(selections: SetupSelections): string {
  return renderEnvFile(selections, false);
}

export function createOnboardingFiles(selections: SetupSelections): OnboardingFiles {
  const workspaceYaml = renderOnboardingWorkspaceConfig(selections);
  parseWorkspaceConfig(workspaceYaml);

  return {
    workspaceYaml,
    env: renderEnv(selections),
    envExample: renderEnvExample(selections)
  };
}

function renderEnvFile(selections: SetupSelections, placeholderOnly: boolean): string {
  const normalized = normalizeSelections(selections);
  const names = collectEnvNames(normalized, selections);
  const lines = names.map((name) => `${name}=${placeholderOnly ? '' : normalized.envValues[name] ?? defaultNonSecretEnvValue(name, normalized)}`);

  return `${lines.join('\n')}\n`;
}

function normalizeSelections(selections: SetupSelections): NormalizedSetupSelections {
  return {
    deploymentMonitor: selections.deploymentMonitor,
    includeOhMyOpenAgent: selections.includeOhMyOpenAgent,
    devRunnerMode: selections.devRunnerMode ?? defaultSetupSelections.devRunnerMode ?? 'mock',
    opencodeCommand: nonEmpty(selections.opencodeCommand, defaultSetupSelections.opencodeCommand ?? 'opencode'),
    opencodeArgs: selections.opencodeArgs ?? defaultSetupSelections.opencodeArgs ?? [],
    opencodeEnvVarNames: uniqueNames(selections.opencodeEnvVarNames ?? []),
    modelProviderEnvVarNames: uniqueNames(selections.modelProviderEnvVarNames ?? []),
    ticketProvider: selections.ticketProvider ?? defaultSetupSelections.ticketProvider ?? 'mock',
    jiraBaseUrl: nonEmpty(selections.jiraBaseUrl, defaultSetupSelections.jiraBaseUrl ?? 'https://jira.example.test'),
    jiraProjectKeys: normalizedList(selections.jiraProjectKeys ?? defaultSetupSelections.jiraProjectKeys ?? []),
    jiraMcpServer: selections.jiraMcpServer ?? atlassianJiraMcpPreset.server,
    codeHostProvider: selections.codeHostProvider ?? defaultSetupSelections.codeHostProvider ?? 'mock',
    githubOrganization: optionalNonEmpty(selections.githubOrganization),
    githubMcpServer: selections.githubMcpServer ?? { id: 'github', command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'], envVarNames: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
    railwayProvider: selections.railwayProvider ?? defaultSetupSelections.railwayProvider ?? 'mock',
    railwayMcpServer: selections.railwayMcpServer ?? railwayCliMcpPreset.server,
    envValues: selections.envValues ?? {}
  };
}

function collectMcpServers(selections: NormalizedSetupSelections): readonly McpServerSelection[] {
  const servers: McpServerSelection[] = [];

  if (selections.ticketProvider === 'jira-mcp') {
    servers.push(selections.jiraMcpServer);
  }

  if (selections.codeHostProvider === 'github-mcp') {
    servers.push(selections.githubMcpServer);
  }

  if (selections.railwayProvider === 'railway-mcp' && (selections.deploymentMonitor === 'railway' || selections.deploymentMonitor === 'both')) {
    servers.push(selections.railwayMcpServer);
  }

  return dedupeServers(servers);
}

function collectEnvNames(normalized: NormalizedSetupSelections, selections: SetupSelections): readonly string[] {
  const names = [
    'OPENCODE_COMMAND',
    normalized.ticketProvider === 'jira-mcp' ? undefined : 'JIRA_BASE_URL',
    ...getRequiredEnvPlaceholders(selections),
    ...collectMcpServers(normalized).flatMap((server) => server.envVarNames)
  ].filter((name): name is string => name !== undefined);

  return uniqueNames(names);
}

function renderMcpServers(servers: readonly McpServerSelection[]): string {
  if (servers.length === 0) {
    return '';
  }

  return `mcp_servers:\n${servers.map(renderMcpServer).join('')}\n`;
}

function renderMcpServer(server: McpServerSelection): string {
  return `  ${server.id}:\n    transport: stdio\n    command: ${server.command}\n    args:${renderYamlList(server.args, 6)}\n    env_var_names:${renderYamlList(server.envVarNames, 6)}\n`;
}

function defaultNonSecretEnvValue(name: string, selections: NormalizedSetupSelections): string {
  if (name === 'OPENCODE_COMMAND') {
    return selections.opencodeCommand;
  }

  if (name === 'JIRA_BASE_URL' || name === 'ATLASSIAN_BASE_URL') {
    return selections.jiraBaseUrl;
  }

  return '';
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? fallback : trimmed;
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function nonEmptyList(values: readonly string[] | undefined, fallback: readonly string[]): readonly string[] {
  const normalized = values?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
  return normalized.length === 0 ? fallback : normalized;
}

function normalizedList(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function uniqueNames(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function dedupeServers(servers: readonly McpServerSelection[]): readonly McpServerSelection[] {
  const seen = new Set<string>();
  const unique: McpServerSelection[] = [];

  for (const server of servers) {
    if (!seen.has(server.id)) {
      seen.add(server.id);
      unique.push(server);
    }
  }

  return unique;
}

function renderYamlList(values: readonly string[], indent: number): string {
  if (values.length === 0) {
    return ' []';
  }

  const prefix = ' '.repeat(indent);
  return `\n${values.map((value) => `${prefix}- ${value}`).join('\n')}`;
}
