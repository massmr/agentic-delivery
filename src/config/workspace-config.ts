import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';

export type MockProviderMode = 'mock';
export type DevRunnerProvider = 'opencode';

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
  readonly mode: MockProviderMode;
  readonly baseUrl: string;
  readonly projectKeys: readonly string[];
}

export interface GitHubWorkspaceConfig {
  readonly mode: MockProviderMode;
  readonly organization: string;
}

export interface RailwayWorkspaceConfig {
  readonly mode: MockProviderMode;
  readonly stagingBranch: string;
  readonly productionBranch: string;
}

export interface DevRunnerWorkspaceConfig {
  readonly provider: DevRunnerProvider;
  readonly command: string;
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
}

type StringField = {
  readonly yamlKey: string;
  readonly propertyName: string;
  readonly action: string;
};

type WorkspaceConfigInput = Record<string, unknown>;

const requiredTopLevelSections = ['workspace', 'jira', 'github', 'railway', 'dev_runner', 'quality', 'repos'] as const;

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
  const reposValue = input.repos;

  const parsedWorkspace = workspace === undefined ? undefined : parseWorkspaceSettings(workspace, issues);
  const parsedJira = jira === undefined ? undefined : parseJiraConfig(jira, issues);
  const parsedGitHub = github === undefined ? undefined : parseGitHubConfig(github, issues);
  const parsedRailway = railway === undefined ? undefined : parseRailwayConfig(railway, issues);
  const parsedDevRunner = devRunner === undefined ? undefined : parseDevRunnerConfig(devRunner, issues);
  const parsedQuality = quality === undefined ? undefined : parseQualityConfig(quality, issues);
  const parsedRepos = parseRepositoryList(reposValue, issues);

  if (
    issues.length > 0 ||
    parsedWorkspace === undefined ||
    parsedJira === undefined ||
    parsedGitHub === undefined ||
    parsedRailway === undefined ||
    parsedDevRunner === undefined ||
    parsedQuality === undefined ||
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
  const mode = readMockMode(section, 'jira', issues);
  const baseUrl = readNonEmptyString(section, 'jira.base_url', 'Set jira.base_url to the Jira workspace URL.', issues);
  const projectKeys = readNonEmptyStringArray(section.project_keys, 'jira.project_keys', 'Add at least one Jira project key.', issues);

  if (mode === undefined || baseUrl === undefined || projectKeys === undefined) {
    return undefined;
  }

  return { mode, baseUrl, projectKeys };
}

function parseGitHubConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): GitHubWorkspaceConfig | undefined {
  const mode = readMockMode(section, 'github', issues);
  const organization = readNonEmptyString(section, 'github.organization', 'Set github.organization to the GitHub organization name.', issues);

  if (mode === undefined || organization === undefined) {
    return undefined;
  }

  return { mode, organization };
}

function parseRailwayConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): RailwayWorkspaceConfig | undefined {
  const mode = readMockMode(section, 'railway', issues);
  const stagingBranch = readNonEmptyString(section, 'railway.staging_branch', 'Set railway.staging_branch to the staging branch name.', issues);
  const productionBranch = readNonEmptyString(section, 'railway.production_branch', 'Set railway.production_branch to the production branch name.', issues);

  if (mode === undefined || stagingBranch === undefined || productionBranch === undefined) {
    return undefined;
  }

  return { mode, stagingBranch, productionBranch };
}

function parseDevRunnerConfig(section: WorkspaceConfigInput, issues: WorkspaceConfigIssue[]): DevRunnerWorkspaceConfig | undefined {
  const provider = readDevRunnerProvider(section, issues);
  const command = readNonEmptyString(section, 'dev_runner.command', 'Set dev_runner.command to the local OpenCode command.', issues);
  const maxAttempts = readPositiveInteger(section, 'dev_runner', 'max_attempts', issues);

  if (provider === undefined || command === undefined || maxAttempts === undefined) {
    return undefined;
  }

  return { provider, command, maxAttempts };
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

  if (strings === undefined || hints === undefined) {
    return undefined;
  }

  return {
    name: strings.name,
    url: strings.url,
    localPath: strings.localPath,
    defaultBranch: strings.defaultBranch,
    productionBranch: strings.productionBranch,
    qualityProfile: strings.qualityProfile,
    hints
  };
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

function readMockMode(section: WorkspaceConfigInput, sectionPath: 'jira' | 'github' | 'railway', issues: WorkspaceConfigIssue[]): MockProviderMode | undefined {
  const value = section.mode;

  if (value !== 'mock') {
    issues.push({
      path: `${sectionPath}.mode`,
      message: `${sectionPath}.mode must be 'mock' for Milestone B.`,
      action: `Set ${sectionPath}.mode to 'mock'; real provider integrations are not enabled in Milestone B.`
    });
    return undefined;
  }

  return value;
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
