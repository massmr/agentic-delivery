import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';

import type { McpServerConfig, McpServerTransport } from '../mcp/index.js';
import { defaultMcpToolTimeoutMs } from '../mcp/index.js';
import { validateJiraProjectKeys } from '../connectors/jira/jira-project-key-validation.js';
import { defaultRailwayMcpToolNames } from '../connectors/railway/index.js';

export type ProviderMode = 'mock' | 'real';
export type JiraProviderMode = ProviderMode | 'mcp';
export type GitHubProviderMode = ProviderMode | 'mcp';
export type RailwayProviderMode = ProviderMode | 'mcp';
export type DevRunnerProvider = 'opencode';

export interface JiraMcpToolNameConfig {
  readonly listBacklog: string;
  readonly getTicket: string;
  readonly comment: string;
}

export interface GitHubMcpToolNameConfig {
  readonly createBranch: string;
  readonly openPullRequest: string;
  readonly getChecks: string;
  readonly commentOnPullRequest: string;
}

export interface WorkspaceConfigIssue {
  readonly path: string;
  readonly message: string;
  readonly action: string;
}

export class WorkspaceConfigError extends Error {
  readonly issues: readonly WorkspaceConfigIssue[];

  constructor(issues: readonly WorkspaceConfigIssue[]) {
    super(formatWorkspaceConfigIssues(issues));
    this.name = 'WorkspaceConfigError';
    this.issues = issues;
  }
}

export interface WorkspaceConfig {
  readonly workspace: WorkspaceSettings;
  readonly jira: JiraWorkspaceConfig;
  readonly github: GitHubWorkspaceConfig;
  readonly railway: RailwayWorkspaceConfig;
  readonly devRunner: DevRunnerWorkspaceConfig;
  readonly quality: QualityWorkspaceConfig;
  readonly mcpServers: readonly McpServerConfig[];
  readonly repos: readonly WorkspaceRepositoryConfig[];
}

export interface WorkspaceSettings {
  readonly name: string;
  readonly autonomy: string;
  readonly stagingBranch: string;
  readonly productionBranch: string;
  readonly maxConcurrentTickets: number;
}

export interface JiraWorkspaceConfig {
  readonly mode: JiraProviderMode;
  readonly baseUrl: string;
  readonly projectKeys: readonly string[];
  readonly mcpServerId?: string | undefined;
  readonly mcpToolNames: JiraMcpToolNameConfig;
}

export interface GitHubWorkspaceConfig {
  readonly mode: GitHubProviderMode;
  readonly organization: string;
  readonly mcpServerId?: string | undefined;
  readonly mcpToolNames: GitHubMcpToolNameConfig;
}

export interface RailwayWorkspaceConfig {
  readonly mode: RailwayProviderMode;
  readonly stagingBranch: string;
  readonly productionBranch: string;
  readonly mcpServerId?: string | undefined;
  readonly mcpToolNames: RailwayMcpToolNameConfig;
}

export interface RailwayMcpToolNameConfig {
  readonly waitForDeployment: string;
  readonly readDeployment: string;
  readonly getServiceUrl: string;
}

export interface DevRunnerWorkspaceConfig {
  readonly mode: ProviderMode;
  readonly provider: DevRunnerProvider;
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly envVarNames: readonly string[];
  readonly maxAttempts: number;
}

export interface QualityWorkspaceConfig {
  readonly defaultProfile: string;
}

export interface WorkspaceRepositoryConfig {
  readonly name: string;
  readonly url: string;
  readonly localPath: string;
  readonly defaultBranch: string;
  readonly productionBranch: string;
  readonly qualityProfile: string;
  readonly hints: readonly string[];
  readonly stagingSmokeUrls: readonly string[];
}

type StringField = {
  readonly yamlKey: string;
  readonly propertyName: string;
  readonly action: string;
};

type WorkspaceConfigInput = Record<string, unknown>;

const requiredTopLevelSections = ['workspace', 'jira', 'github', 'railway', 'dev_runner', 'quality', 'repos'] as const;
const defaultJiraMcpToolNames: JiraMcpToolNameConfig = {
  listBacklog: 'searchJiraIssuesUsingJql',
  getTicket: 'getJiraIssue',
  comment: 'addCommentToJiraIssue'
};
const defaultGitHubMcpToolNames: GitHubMcpToolNameConfig = {
  createBranch: 'createGitHubBranch',
  openPullRequest: 'openGitHubPullRequest',
  getChecks: 'getGitHubChecks',
  commentOnPullRequest: 'commentOnGitHubPullRequest'
};
const defaultDevRunnerTimeoutMs = 30 * 60 * 1000;
const defaultDevRunnerEnvVarNames = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP'] as const;

export async function loadWorkspaceConfig(filePath: string): Promise<WorkspaceConfig> {
  const source = await readFile(filePath, 'utf8');
  return parseWorkspaceConfig(source);
}

export function parseWorkspaceConfig(source: string): WorkspaceConfig {
  const document = parseDocument(source, { prettyErrors: false });
  const syntaxIssues = document.errors.map((error) => ({
    path: 'yaml',
    message: `YAML syntax error: ${error.message}`,
    action: 'Fix the YAML syntax before validating workspace settings.'
  }));

  if (syntaxIssues.length > 0) {
    throw new WorkspaceConfigError(syntaxIssues);
  }

  const input: unknown = document.toJS({});
  const validation = validateWorkspaceConfig(input);

  if (!validation.valid) {
    throw new WorkspaceConfigError(validation.issues);
  }

  return validation.config;
}

export type WorkspaceConfigValidationResult =
  | {
      readonly valid: true;
      readonly config: WorkspaceConfig;
      readonly issues: readonly [];
    }
  | {
      readonly valid: false;
      readonly issues: readonly WorkspaceConfigIssue[];
    };

export function validateWorkspaceConfig(input: unknown): WorkspaceConfigValidationResult {
  const issues: WorkspaceConfigIssue[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [
        {
          path: 'root',
          message: 'Workspace config must be a YAML mapping.',
          action: 'Define the top-level workspace, jira, github, railway, dev_runner, quality, and repos sections.'
        }
      ]
    };
  }

  for (const section of requiredTopLevelSections) {
    if (!(section in input)) {
      issues.push({
        path: section,
        message: `Missing required top-level section '${section}'.`,
        action: `Add a '${section}' section matching config/workspace.example.yml.`
      });
    }
  }

  const workspace = readSection(input, 'workspace', issues);
  const jira = readSection(input, 'jira', issues);
  const github = readSection(input, 'github', issues);
  const railway = readSection(input, 'railway', issues);
  const devRunner = readSection(input, 'dev_runner', issues);
  const quality = readSection(input, 'quality', issues);
  const mcpServers = readOptionalSection(input, 'mcp_servers', issues);
  const reposValue = input.repos;

  const parsedWorkspace = workspace === undefined ? undefined : parseWorkspaceSettings(workspace, issues);
  const parsedJira = jira === undefined ? undefined : parseJiraConfig(jira, issues);
  const parsedGitHub = github === undefined ? undefined : parseGitHubConfig(github, issues);
  const parsedRailway = railway === undefined ? undefined : parseRailwayConfig(railway, issues);
  const parsedDevRunner = devRunner === undefined ? undefined : parseDevRunnerConfig(devRunner, issues);
  const parsedQuality = quality === undefined ? undefined : parseQualityConfig(quality, issues);
  const parsedMcpServers = mcpServers === undefined ? [] : parseMcpServers(mcpServers, issues);
  const parsedRepos = parseRepositoryList(reposValue, issues);

  if (parsedJira !== undefined && parsedMcpServers !== undefined) {
    validateJiraMcpServerReference(parsedJira, parsedMcpServers, issues);
  }

  if (parsedGitHub !== undefined && parsedMcpServers !== undefined) {
    validateGitHubMcpServerReference(parsedGitHub, parsedMcpServers, issues);
  }

  if (parsedRailway !== undefined && parsedMcpServers !== undefined) {
    validateRailwayMcpServerReference(parsedRailway, parsedMcpServers, issues);
  }

  if (
    issues.length > 0 ||
    parsedWorkspace === undefined ||
    parsedJira === undefined ||
    parsedGitHub === undefined ||
    parsedRailway === undefined ||
    parsedDevRunner === undefined ||
    parsedQuality === undefined ||
    parsedMcpServers === undefined ||
    parsedRepos === undefined
  ) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    issues: [],
    config: {
      workspace: parsedWorkspace,
      jira: parsedJira,
      github: parsedGitHub,
      railway: parsedRailway,
      devRunner: parsedDevRunner,
      quality: parsedQuality,
      mcpServers: parsedMcpServers,
      repos: parsedRepos
    }
  };
}

export function formatWorkspaceConfigIssues(issues: readonly WorkspaceConfigIssue[]): string {
  if (issues.length === 0) {
    return 'Workspace config validation failed.';
  }

  const formattedIssues = issues.map((issue) => `${issue.path}: ${issue.message} Action: ${issue.action}`);
  return ['Workspace config validation failed:', ...formattedIssues].join('\n');
}

function parseWorkspaceSettings(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): WorkspaceSettings | undefined {
  const strings = readStringFields(
    section,
    'workspace',
    [
      { yamlKey: 'name', propertyName: 'name', action: 'Set workspace.name to a non-empty workspace identifier.' },
      { yamlKey: 'autonomy', propertyName: 'autonomy', action: 'Set workspace.autonomy to the Milestone B autonomy policy.' },
      { yamlKey: 'staging_branch', propertyName: 'stagingBranch', action: 'Set workspace.staging_branch to the staging branch name.' },
      { yamlKey: 'production_branch', propertyName: 'productionBranch', action: 'Set workspace.production_branch to the production branch name.' }
    ],
    issues
  );
  const maxConcurrentTickets = readPositiveInteger(section, 'workspace', 'max_concurrent_tickets', issues);

  if (strings === undefined || maxConcurrentTickets === undefined) {
    return undefined;
  }

  return {
    name: strings.name,
    autonomy: strings.autonomy,
    stagingBranch: strings.stagingBranch,
    productionBranch: strings.productionBranch,
    maxConcurrentTickets
  };
}

function parseJiraConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): JiraWorkspaceConfig | undefined {
  const mode = readJiraProviderMode(section, issues);
  const baseUrl = readNonEmptyString(section, 'jira.base_url', 'Set jira.base_url to the Jira workspace URL.', issues);
  const projectKeys = readNonEmptyStringArray(section.project_keys, 'jira.project_keys', 'Add at least one Jira project key.', issues);
  const mcpServerId = mode === 'mcp'
    ? readNonEmptyString(section, 'jira.mcp_server', 'Set jira.mcp_server to the id of a configured top-level mcp_servers entry.', issues)
    : readOptionalNonEmptyString(section.mcp_server, 'jira.mcp_server', 'Remove jira.mcp_server unless jira.mode is mcp, or set it to a non-empty MCP server id.', issues);
  const mcpToolNames = parseJiraMcpToolNames(section.mcp_tools, issues);

  if (mode === 'mcp' && projectKeys !== undefined) {
    validateJiraProjectKeysInWorkspaceConfig(projectKeys, issues);
  }

  if (mode === undefined || baseUrl === undefined || projectKeys === undefined || (mode === 'mcp' && mcpServerId === undefined)) {
    return undefined;
  }

  return { mode, baseUrl, projectKeys, mcpServerId, mcpToolNames };
}

function parseJiraMcpToolNames(value: unknown, issues: WorkspaceConfigIssue[]): JiraMcpToolNameConfig {
  if (value === undefined) {
    return defaultJiraMcpToolNames;
  }

  if (!isRecord(value)) {
    issues.push({
      path: 'jira.mcp_tools',
      message: 'jira.mcp_tools must be a YAML mapping when provided.',
      action: 'Set jira.mcp_tools.list_backlog, get_ticket, and comment to MCP tool names, or remove jira.mcp_tools to use defaults.'
    });
    return defaultJiraMcpToolNames;
  }

  return {
    listBacklog: readOptionalNonEmptyString(value.list_backlog, 'jira.mcp_tools.list_backlog', 'Set jira.mcp_tools.list_backlog to the Jira MCP search tool name.', issues) ?? defaultJiraMcpToolNames.listBacklog,
    getTicket: readOptionalNonEmptyString(value.get_ticket, 'jira.mcp_tools.get_ticket', 'Set jira.mcp_tools.get_ticket to the Jira MCP issue fetch tool name.', issues) ?? defaultJiraMcpToolNames.getTicket,
    comment: readOptionalNonEmptyString(value.comment, 'jira.mcp_tools.comment', 'Set jira.mcp_tools.comment to the Jira MCP comment tool name.', issues) ?? defaultJiraMcpToolNames.comment
  };
}

function validateJiraProjectKeysInWorkspaceConfig(projectKeys: readonly string[], issues: WorkspaceConfigIssue[]): void {
  for (const issue of validateJiraProjectKeys(projectKeys)) {
    issues.push({
      path: `jira.project_keys[${issue.index}]`,
      message: issue.message,
      action: issue.action
    });
  }
}

function parseGitHubConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): GitHubWorkspaceConfig | undefined {
  const mode = readGitHubProviderMode(section, issues);
  const organization = readNonEmptyString(section, 'github.organization', 'Set github.organization to the GitHub organization name.', issues);
  const mcpServerId = mode === 'mcp'
    ? readNonEmptyString(section, 'github.mcp_server', 'Set github.mcp_server to the id of a configured top-level mcp_servers entry.', issues)
    : readOptionalNonEmptyString(section.mcp_server, 'github.mcp_server', 'Remove github.mcp_server unless github.mode is mcp, or set it to a non-empty MCP server id.', issues);
  const mcpToolNames = parseGitHubMcpToolNames(section.mcp_tools, issues);

  if (mode === undefined || organization === undefined || (mode === 'mcp' && mcpServerId === undefined)) {
    return undefined;
  }

  return { mode, organization, mcpServerId, mcpToolNames };
}

function parseGitHubMcpToolNames(value: unknown, issues: WorkspaceConfigIssue[]): GitHubMcpToolNameConfig {
  if (value === undefined) {
    return defaultGitHubMcpToolNames;
  }

  if (!isRecord(value)) {
    issues.push({
      path: 'github.mcp_tools',
      message: 'github.mcp_tools must be a YAML mapping when provided.',
      action: 'Set github.mcp_tools.create_branch, open_pull_request, get_checks, and comment_pull_request to MCP tool names, or remove github.mcp_tools to use defaults.'
    });
    return defaultGitHubMcpToolNames;
  }

  return {
    createBranch: readOptionalNonEmptyString(value.create_branch, 'github.mcp_tools.create_branch', 'Set github.mcp_tools.create_branch to the GitHub MCP branch-creation tool name.', issues) ?? defaultGitHubMcpToolNames.createBranch,
    openPullRequest: readOptionalNonEmptyString(value.open_pull_request, 'github.mcp_tools.open_pull_request', 'Set github.mcp_tools.open_pull_request to the GitHub MCP pull-request tool name.', issues) ?? defaultGitHubMcpToolNames.openPullRequest,
    getChecks: readOptionalNonEmptyString(value.get_checks, 'github.mcp_tools.get_checks', 'Set github.mcp_tools.get_checks to the GitHub MCP checks tool name.', issues) ?? defaultGitHubMcpToolNames.getChecks,
    commentOnPullRequest: readOptionalNonEmptyString(value.comment_pull_request, 'github.mcp_tools.comment_pull_request', 'Set github.mcp_tools.comment_pull_request to the GitHub MCP comment tool name.', issues) ?? defaultGitHubMcpToolNames.commentOnPullRequest
  };
}

function parseRailwayMcpToolNames(value: unknown, issues: WorkspaceConfigIssue[]): RailwayMcpToolNameConfig {
  if (value === undefined) {
    return defaultRailwayMcpToolNames;
  }

  if (!isRecord(value)) {
    issues.push({
      path: 'railway.mcp_tools',
      message: 'railway.mcp_tools must be a YAML mapping when provided.',
      action: 'Set railway.mcp_tools.wait_for_deployment, read_deployment, and get_service_url to MCP tool names, or remove railway.mcp_tools to use defaults.'
    });
    return defaultRailwayMcpToolNames;
  }

  return {
    waitForDeployment: readOptionalNonEmptyString(value.wait_for_deployment, 'railway.mcp_tools.wait_for_deployment', 'Set railway.mcp_tools.wait_for_deployment to the Railway MCP deployment polling tool name.', issues) ?? defaultRailwayMcpToolNames.waitForDeployment,
    readDeployment: readOptionalNonEmptyString(value.read_deployment, 'railway.mcp_tools.read_deployment', 'Set railway.mcp_tools.read_deployment to the Railway MCP deployment lookup tool name.', issues) ?? defaultRailwayMcpToolNames.readDeployment,
    getServiceUrl: readOptionalNonEmptyString(value.get_service_url, 'railway.mcp_tools.get_service_url', 'Set railway.mcp_tools.get_service_url to the Railway MCP service URL tool name.', issues) ?? defaultRailwayMcpToolNames.getServiceUrl
  };
}

function validateGitHubMcpServerReference(github: GitHubWorkspaceConfig, mcpServers: readonly McpServerConfig[], issues?: WorkspaceConfigIssue[]): void {
  if (github.mode !== 'mcp' || github.mcpServerId === undefined) {
    return;
  }

  if (mcpServers.some((candidate) => candidate.id === github.mcpServerId)) {
    return;
  }

  issues?.push({
    path: 'github.mcp_server',
    message: `github.mcp_server references '${github.mcpServerId}', but no matching top-level mcp_servers entry exists.`,
    action: 'Set github.mcp_server to the id of a configured top-level mcp_servers entry, or add a matching mcp_servers entry.'
  });
}

function validateRailwayMcpServerReference(railway: RailwayWorkspaceConfig, mcpServers: readonly McpServerConfig[], issues?: WorkspaceConfigIssue[]): void {
  if (railway.mode !== 'mcp' || railway.mcpServerId === undefined) {
    return;
  }

  if (mcpServers.some((candidate) => candidate.id === railway.mcpServerId)) {
    return;
  }

  issues?.push({
    path: 'railway.mcp_server',
    message: `railway.mcp_server references '${railway.mcpServerId}', but no matching top-level mcp_servers entry exists.`,
    action: 'Set railway.mcp_server to the id of a configured top-level mcp_servers entry, or add a matching mcp_servers entry.'
  });
}

function parseRailwayConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): RailwayWorkspaceConfig | undefined {
  const mode = readRailwayProviderMode(section, issues);
  const stagingBranch = readNonEmptyString(section, 'railway.staging_branch', 'Set railway.staging_branch to the staging branch name.', issues);
  const productionBranch = readNonEmptyString(section, 'railway.production_branch', 'Set railway.production_branch to the production branch name.', issues);
  const mcpServerId = mode === 'mcp'
    ? readNonEmptyString(section, 'railway.mcp_server', 'Set railway.mcp_server to the id of a configured top-level mcp_servers entry.', issues)
    : readOptionalNonEmptyString(section.mcp_server, 'railway.mcp_server', 'Remove railway.mcp_server unless railway.mode is mcp, or set it to a non-empty MCP server id.', issues);
  const mcpToolNames = parseRailwayMcpToolNames(section.mcp_tools, issues);

  if (mode === undefined || stagingBranch === undefined || productionBranch === undefined || (mode === 'mcp' && mcpServerId === undefined)) {
    return undefined;
  }

  return { mode, stagingBranch, productionBranch, mcpServerId, mcpToolNames };
}

function parseDevRunnerConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): DevRunnerWorkspaceConfig | undefined {
  const mode = readOptionalProviderMode(section, 'dev_runner', issues);
  const provider = readDevRunnerProvider(section, issues);
  const command = readNonEmptyString(section, 'dev_runner.command', 'Set dev_runner.command to the local OpenCode command.', issues);
  const args = section.args === undefined
    ? []
    : readStringArray(section.args, 'dev_runner.args', 'Set dev_runner.args to an array of OpenCode command arguments.', issues);
  const timeoutMs = section.timeout_ms === undefined ? defaultDevRunnerTimeoutMs : readPositiveInteger(section, 'dev_runner', 'timeout_ms', issues);
  const envVarNames = section.env_var_names === undefined
    ? defaultDevRunnerEnvVarNames
    : readStringArray(section.env_var_names, 'dev_runner.env_var_names', 'Set dev_runner.env_var_names to an array of allowed environment variable names.', issues);
  const maxAttempts = readPositiveInteger(section, 'dev_runner', 'max_attempts', issues);

  if (mode === undefined || provider === undefined || command === undefined || args === undefined || timeoutMs === undefined || envVarNames === undefined || maxAttempts === undefined) {
    return undefined;
  }

  return { mode, provider, command, args, timeoutMs, envVarNames, maxAttempts };
}

function parseQualityConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): QualityWorkspaceConfig | undefined {
  const defaultProfile = readNonEmptyString(section, 'quality.default_profile', 'Set quality.default_profile to a configured quality profile name.', issues);

  if (defaultProfile === undefined) {
    return undefined;
  }

  return { defaultProfile };
}

function parseRepositoryList(value: unknown, issues: WorkspaceConfigIssue[]): readonly WorkspaceRepositoryConfig[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path: 'repos',
      message: 'repos must be a non-empty array of repository entries.',
      action: 'Add repository entries matching config/workspace.example.yml.'
    });
    return undefined;
  }

  if (value.length === 0) {
    issues.push({
      path: 'repos',
      message: 'repos must include at least one repository.',
      action: 'Add at least one repository entry with name, url, local_path, branches, quality_profile, and hints.'
    });
    return undefined;
  }

  const repositories: WorkspaceRepositoryConfig[] = [];

  for (const [index, entry] of value.entries()) {
    const path = `repos[${index}]`;

    if (!isRecord(entry)) {
      issues.push({
        path,
        message: 'Repository entry must be a YAML mapping.',
        action: 'Replace this entry with name, url, local_path, default_branch, production_branch, quality_profile, and hints fields.'
      });
      continue;
    }

    const repository = parseRepositoryConfig(entry, path, issues);

    if (repository !== undefined) {
      repositories.push(repository);
    }
  }

  if (repositories.length !== value.length) {
    return undefined;
  }

  return repositories;
}

function parseRepositoryConfig(section: WorkspaceConfigInput, path: string, issues: WorkspaceConfigIssue[]): WorkspaceRepositoryConfig | undefined {
  const strings = readStringFields(
    section,
    path,
    [
      { yamlKey: 'name', propertyName: 'name', action: 'Set repository name to a non-empty identifier.' },
      { yamlKey: 'url', propertyName: 'url', action: 'Set repository url to the Git remote URL.' },
      { yamlKey: 'local_path', propertyName: 'localPath', action: 'Set repository local_path to the local checkout path.' },
      { yamlKey: 'default_branch', propertyName: 'defaultBranch', action: 'Set repository default_branch to the staging branch used for work.' },
      { yamlKey: 'production_branch', propertyName: 'productionBranch', action: 'Set repository production_branch to the production branch.' },
      { yamlKey: 'quality_profile', propertyName: 'qualityProfile', action: 'Set repository quality_profile to a configured quality profile.' }
    ],
    issues
  );
  const hints = readNonEmptyStringArray(section.hints, `${path}.hints`, 'Add at least one non-empty repository hint.', issues);
  const stagingSmokeUrls = readStringArray(
    section.staging_smoke_urls,
    `${path}.staging_smoke_urls`,
    'Set staging_smoke_urls to an array of smoke paths or URLs; use [] to skip smoke checks for this repository.',
    issues
  );

  if (strings === undefined || hints === undefined || stagingSmokeUrls === undefined) {
    return undefined;
  }

  return {
    name: strings.name,
    url: strings.url,
    localPath: strings.localPath,
    defaultBranch: strings.defaultBranch,
    productionBranch: strings.productionBranch,
    qualityProfile: strings.qualityProfile,
    hints,
    stagingSmokeUrls
  };
}

function parseMcpServers(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): readonly McpServerConfig[] | undefined {
  const servers: McpServerConfig[] = [];

  for (const [id, value] of Object.entries(section)) {
    const path = `mcp_servers.${id}`;

    if (!isRecord(value)) {
      issues.push({
        path,
        message: `${path} must be a YAML mapping.`,
        action: 'Define command/args for stdio MCP servers or url for HTTP MCP servers.'
      });
      continue;
    }

    const server = parseMcpServerConfig(id, value, path, issues);

    if (server !== undefined) {
      servers.push(server);
    }
  }

  return servers.length === Object.keys(section).length ? servers : undefined;
}

function parseMcpServerConfig(id: string, section: WorkspaceConfigInput, path: string, issues: WorkspaceConfigIssue[]): McpServerConfig | undefined {
  const displayName = readOptionalNonEmptyString(section.display_name, `${path}.display_name`, 'Set display_name to a non-empty label or omit it.', issues) ?? id;
  const command = readOptionalNonEmptyString(section.command, `${path}.command`, 'Set command to the MCP stdio executable or omit it for HTTP servers.', issues);
  const url = readOptionalNonEmptyString(section.url, `${path}.url`, 'Set url to the MCP HTTP endpoint or omit it for stdio servers.', issues);
  const args = section.args === undefined
    ? []
    : readStringArray(section.args, `${path}.args`, 'Set args to an array of command arguments without secrets.', issues);
  const envVarNames = section.env_var_names === undefined
    ? []
    : readStringArray(section.env_var_names, `${path}.env_var_names`, 'Set env_var_names to the names of environment variables, not secret values.', issues);
  const timeoutMs = section.timeout_ms === undefined ? defaultMcpToolTimeoutMs : readPositiveInteger(section, path, 'timeout_ms', issues);
  const transport = readOptionalMcpTransport(section.transport, path, issues) ?? (command === undefined ? 'http' : 'stdio');

  if (args === undefined || envVarNames === undefined || timeoutMs === undefined) {
    return undefined;
  }

  if (transport === 'stdio') {
    if (command === undefined) {
      issues.push({ path: `${path}.command`, message: `${path}.command must be a non-empty string for stdio MCP servers.`, action: 'Set command to the MCP stdio executable.' });
      return undefined;
    }

    return { id, displayName, transport, command, args, timeoutMs, envVarNames };
  }

  if (url === undefined) {
    issues.push({ path: `${path}.url`, message: `${path}.url must be a non-empty string for HTTP MCP servers.`, action: 'Set url to the MCP HTTP endpoint.' });
    return undefined;
  }

  return { id, displayName, transport, url, timeoutMs, envVarNames };
}

function validateJiraMcpServerReference(jira: JiraWorkspaceConfig, mcpServers: readonly McpServerConfig[], issues: WorkspaceConfigIssue[]): void {
  if (jira.mode !== 'mcp') {
    return;
  }

  const serverId = jira.mcpServerId;

  if (serverId === undefined || mcpServers.some((server) => server.id === serverId)) {
    return;
  }

  issues.push({
    path: 'jira.mcp_server',
    message: `jira.mcp_server references '${serverId}', but no matching top-level mcp_servers entry exists.`,
    action: `Add mcp_servers.${serverId} or set jira.mcp_server to a configured MCP server id.`
  });
}

function readSection(input: WorkspaceConfigInput, key: string, issues: WorkspaceConfigIssue[]): WorkspaceConfigInput | undefined {
  const value = input[key];

  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    issues.push({
      path: key,
      message: `${key} must be a YAML mapping.`,
      action: `Replace ${key} with a mapping matching config/workspace.example.yml.`
    });
    return undefined;
  }

  return value;
}

function readOptionalSection(input: WorkspaceConfigInput, key: string, issues: WorkspaceConfigIssue[]): WorkspaceConfigInput | undefined {
  const value = input[key];

  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    issues.push({
      path: key,
      message: `${key} must be a YAML mapping.`,
      action: `Replace ${key} with a mapping of MCP server ids to server settings.`
    });
    return undefined;
  }

  return value;
}

function readStringFields(
  section: WorkspaceConfigInput,
  path: string,
  fields: readonly StringField[],
  issues: WorkspaceConfigIssue[]
): Record<string, string> | undefined {
  const output: Record<string, string> = {};
  let valid = true;

  for (const field of fields) {
    const value = readNonEmptyString(section, `${path}.${field.yamlKey}`, field.action, issues);

    if (value === undefined) {
      valid = false;
    } else {
      output[field.propertyName] = value;
    }
  }

  return valid ? output : undefined;
}

function readNonEmptyString(section: WorkspaceConfigInput, path: string, action: string, issues: WorkspaceConfigIssue[]): string | undefined {
  const value = readPathValue(section, path);

  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({
      path,
      message: `${path} must be a non-empty string.`,
      action
    });
    return undefined;
  }

  return value;
}

function readOptionalNonEmptyString(value: unknown, path: string, action: string, issues: WorkspaceConfigIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({
      path,
      message: `${path} must be a non-empty string.`,
      action
    });
    return undefined;
  }

  return value;
}

function readNonEmptyStringArray(value: unknown, path: string, action: string, issues: WorkspaceConfigIssue[]): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({
      path,
      message: `${path} must be a non-empty array of strings.`,
      action
    });
    return undefined;
  }

  const strings: string[] = [];

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      issues.push({
        path: `${path}[${index}]`,
        message: `${path}[${index}] must be a non-empty string.`,
        action
      });
    } else {
      strings.push(entry);
    }
  }

  return strings.length === value.length ? strings : undefined;
}

function readStringArray(value: unknown, path: string, action: string, issues: WorkspaceConfigIssue[]): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      message: `${path} must be an array of strings.`,
      action
    });
    return undefined;
  }

  const strings: string[] = [];

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      issues.push({
        path: `${path}[${index}]`,
        message: `${path}[${index}] must be a non-empty string.`,
        action
      });
    } else {
      strings.push(entry);
    }
  }

  return strings.length === value.length ? strings : undefined;
}

function readPositiveInteger(section: WorkspaceConfigInput, sectionPath: string, key: string, issues: WorkspaceConfigIssue[]): number | undefined {
  const value = section[key];
  const path = `${sectionPath}.${key}`;

  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1) {
    issues.push({
      path,
      message: `${path} must be a positive integer.`,
      action: `Set ${path} to a whole number greater than 0.`
    });
    return undefined;
  }

  return value;
}

function readProviderMode(section: WorkspaceConfigInput, sectionPath: 'jira' | 'github' | 'railway' | 'dev_runner', issues: WorkspaceConfigIssue[]): ProviderMode | undefined {
  const value = section.mode;

  if (value !== 'mock' && value !== 'real') {
    issues.push({
      path: `${sectionPath}.mode`,
      message: `${sectionPath}.mode must be 'mock' or 'real'.`,
      action: `Set ${sectionPath}.mode to 'mock' for local runs or 'real' only when the matching adapter credentials are available.`
    });
    return undefined;
  }

  return value;
}

function readGitHubProviderMode(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): GitHubProviderMode | undefined {
  const value = section.mode;

  if (value !== 'mock' && value !== 'real' && value !== 'mcp') {
    issues.push({
      path: 'github.mode',
      message: "github.mode must be 'mock', 'real', or 'mcp'.",
      action: "Set github.mode to 'mock' for local runs, 'mcp' for an injected MCP-backed GitHub adapter, or 'real' only when the matching adapter credentials are available."
    });
    return undefined;
  }

  return value;
}

function readRailwayProviderMode(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): RailwayProviderMode | undefined {
  const value = section.mode;

  if (value !== 'mock' && value !== 'real' && value !== 'mcp') {
    issues.push({
      path: 'railway.mode',
      message: "railway.mode must be 'mock', 'real', or 'mcp'.",
      action: "Set railway.mode to 'mock' for local runs, 'mcp' for an injected MCP-backed Railway adapter, or 'real' only when the matching adapter credentials are available."
    });
    return undefined;
  }

  return value;
}

function readJiraProviderMode(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): JiraProviderMode | undefined {
  const value = section.mode;

  if (value !== 'mock' && value !== 'real' && value !== 'mcp') {
    issues.push({
      path: 'jira.mode',
      message: "jira.mode must be 'mock', 'real', or 'mcp'.",
      action: "Set jira.mode to 'mock' for local runs, 'mcp' for an injected MCP-backed Jira adapter, or 'real' only when the matching adapter credentials are available."
    });
    return undefined;
  }

  return value;
}

function readOptionalMcpTransport(value: unknown, path: string, issues: WorkspaceConfigIssue[]): McpServerTransport | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== 'stdio' && value !== 'http') {
    issues.push({
      path: `${path}.transport`,
      message: `${path}.transport must be 'stdio' or 'http'.`,
      action: "Set transport to 'stdio' for command-based MCP servers or 'http' for URL-based MCP servers."
    });
    return undefined;
  }

  return value;
}

function readOptionalProviderMode(section: WorkspaceConfigInput, sectionPath: 'dev_runner', issues: WorkspaceConfigIssue[]): ProviderMode | undefined {
  if (section.mode === undefined) {
    return 'mock';
  }

  return readProviderMode(section, sectionPath, issues);
}

function readDevRunnerProvider(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): DevRunnerProvider | undefined {
  const value = section.provider;

  if (value !== 'opencode') {
    issues.push({
      path: 'dev_runner.provider',
      message: "dev_runner.provider must be 'opencode' for Milestone B.",
      action: "Set dev_runner.provider to 'opencode'."
    });
    return undefined;
  }

  return value;
}

function readPathValue(section: WorkspaceConfigInput, path: string): unknown {
  const key = path.slice(path.lastIndexOf('.') + 1);
  return section[key];
}

function isRecord(value: unknown): value is WorkspaceConfigInput {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
