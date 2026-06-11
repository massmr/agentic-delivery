import type { WorkspaceConfig } from '../config/index.js';
import type { DeploymentVerificationMode } from '../domain/index.js';
import { atlassianJiraMcpPreset } from './connector-presets.js';
import { OpenCodeSetupAdapter } from './opencode-setup-adapter.js';

export type DeploymentMonitorSelection = 'none' | 'railway' | 'vercel' | 'both';
export type TicketProviderSelection = 'mock' | 'jira-mcp';
export type CodeHostSelection = 'mock' | 'github-mcp';
export type RailwayProviderSelection = 'mock' | 'railway-mcp';
export type DevRunnerModeSelection = 'mock' | 'opencode';

export interface McpServerSelection {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly envVarNames: readonly string[];
}

export interface SetupRepositoryDeploymentSelection {
  readonly name: string;
  readonly url: string;
  readonly localPath: string;
  readonly defaultBranch: string;
  readonly productionBranch: string;
  readonly qualityProfile: string;
  readonly hints: readonly string[];
  readonly stagingSmokeUrls: readonly string[];
  readonly railwayProjectId?: string | undefined;
  readonly railwayEnvironmentId?: string | undefined;
  readonly railwayServiceId?: string | undefined;
  readonly railwayBranch: string;
  readonly verificationMode: DeploymentVerificationMode;
}

export interface SetupSelections {
  readonly deploymentMonitor: DeploymentMonitorSelection;
  readonly includeOhMyOpenAgent: boolean;
  readonly devRunnerMode?: DevRunnerModeSelection | undefined;
  readonly opencodeCommand?: string | undefined;
  readonly opencodeArgs?: readonly string[] | undefined;
  readonly opencodeEnvVarNames?: readonly string[] | undefined;
  readonly modelProviderEnvVarNames?: readonly string[] | undefined;
  readonly ticketProvider?: TicketProviderSelection | undefined;
  readonly jiraBaseUrl?: string | undefined;
  readonly jiraProjectKeys?: readonly string[] | undefined;
  readonly jiraMcpServer?: McpServerSelection | undefined;
  readonly codeHostProvider?: CodeHostSelection | undefined;
  readonly githubOrganization?: string | undefined;
  readonly githubMcpServer?: McpServerSelection | undefined;
  readonly railwayProvider?: RailwayProviderSelection | undefined;
  readonly railwayMcpServer?: McpServerSelection | undefined;
  readonly repositoryDeployments?: readonly SetupRepositoryDeploymentSelection[] | undefined;
  readonly envValues?: Readonly<Record<string, string | undefined>> | undefined;
}

export interface SetupDetectionInput {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string | undefined;
  readonly fileExists?: (path: string) => boolean;
  readonly readFile?: (path: string) => string | undefined;
  readonly commandExists?: (command: string) => boolean;
}

export interface SetupGeneratedConfigMetadata {
  readonly deploymentMonitors?: readonly string[];
  readonly optionalTools?: readonly string[];
  readonly controlPlane?: string;
}

export interface SetupDetectionResult {
  readonly configured: boolean;
  readonly details: readonly string[];
}

export interface SetupValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface SetupProviderCapability {
  readonly id: string;
  readonly label: string;
  readonly category: 'dev-runner' | 'optional-tool' | 'code-host' | 'ticket-provider' | 'deployment-monitor' | 'control-plane';
  readonly order: number;
  readonly installSteps: readonly string[];
  readonly nonSecretConfigKeys: readonly string[];
  readonly requiredSecretEnvVars: readonly string[];
  readonly detectExistingSetup: (input: SetupDetectionInput) => SetupDetectionResult;
  readonly validateGeneratedConfig: (config: WorkspaceConfig, metadata?: SetupGeneratedConfigMetadata) => SetupValidationResult;
  readonly summarize: () => string;
}

export const defaultSetupSelections: SetupSelections = {
  deploymentMonitor: 'railway',
  includeOhMyOpenAgent: false,
  devRunnerMode: 'mock',
  opencodeCommand: 'opencode',
  opencodeArgs: [],
  opencodeEnvVarNames: [],
  modelProviderEnvVarNames: [],
  ticketProvider: 'mock',
  jiraBaseUrl: 'https://jira.example.test',
  jiraProjectKeys: [],
  codeHostProvider: 'mock',
  railwayProvider: 'mock',
  envValues: {}
};

function createCapability(input: Omit<SetupProviderCapability, 'summarize'>): SetupProviderCapability {
  return {
    ...input,
    summarize: () => `${input.label}: ${input.installSteps.join(' ')}`
  };
}

function envHas(env: NodeJS.ProcessEnv | undefined, name: string): boolean {
  return (env?.[name] ?? '').trim().length > 0;
}

function allEnvPresent(input: SetupDetectionInput, names: readonly string[]): SetupDetectionResult {
  const missing = names.filter((name) => !envHas(input.env, name));

  if (missing.length === 0) {
    return { configured: true, details: names.map((name) => `${name} is present in the environment.`) };
  }

  return { configured: false, details: missing.map((name) => `${name} is not present in the environment.`) };
}

function validationResult(issues: readonly string[]): SetupValidationResult {
  return { valid: issues.length === 0, issues };
}

const opencodeCapability = createCapability({
  id: 'opencode',
  label: 'OpenCode',
  category: 'dev-runner',
  order: 10,
  installSteps: ['Install OpenCode separately and keep the command available on PATH.'],
  nonSecretConfigKeys: ['dev_runner.provider', 'dev_runner.command'],
  requiredSecretEnvVars: [],
  detectExistingSetup(input) {
    const adapter = new OpenCodeSetupAdapter({
      workspaceRoot: input.cwd,
      homeDirectory: input.homeDirectory ?? input.cwd,
      env: input.env ?? {},
      fileExists: input.fileExists ?? (() => false),
      readFile: input.readFile ?? (() => undefined),
      commandExists: input.commandExists ?? (() => false),
      runCommand: undefined
    });
    const detection = adapter.detect();

    return {
      configured: detection.state !== 'not_installed' && detection.state !== 'command_failed' && detection.state !== 'installed_unsupported',
      details: [`OpenCode readiness state: ${detection.state}.`, ...detection.details]
    };
  },
  validateGeneratedConfig(config) {
    return validationResult([
      config.devRunner.provider === 'opencode' ? undefined : 'dev_runner.provider must be opencode.',
      config.devRunner.command.trim().length > 0 ? undefined : 'dev_runner.command must be non-empty.'
    ].filter((issue): issue is string => issue !== undefined));
  }
});

const ohMyOpenAgentCapability = createCapability({
  id: 'oh-my-openagent',
  label: 'oh-my-openagent',
  category: 'optional-tool',
  order: 20,
  installSteps: ['Optional OpenCode preset/tooling; install only if you choose to use it.'],
  nonSecretConfigKeys: ['setup.optional_tools'],
  requiredSecretEnvVars: [],
  detectExistingSetup(input) {
    const markers = ['.oh-my-openagent.yml', '.oh-my-openagent/config.yml', 'config/oh-my-openagent.yml'];
    const matched = markers.filter((marker) => input.fileExists?.(`${input.cwd}/${marker}`) === true);

    if (matched.length > 0) {
      return { configured: true, details: matched.map((marker) => `Found ${marker}.`) };
    }

    return { configured: false, details: ['No local oh-my-openagent config marker was found.'] };
  },
  validateGeneratedConfig(_config, metadata) {
    const optionalTools = metadata?.optionalTools ?? [];
    return validationResult(optionalTools.includes('oh-my-openagent') ? [] : ['setup.optional_tools must include oh-my-openagent when this optional capability is selected.']);
  }
});

const githubCapability = createCapability({
  id: 'github',
  label: 'GitHub',
  category: 'code-host',
  order: 30,
  installSteps: ['Create a GitHub personal access token with repository permissions before leaving mock mode. Ewokbot derives repository owners from local git remotes.'],
  nonSecretConfigKeys: ['github.mode', 'github.mcp_server'],
  requiredSecretEnvVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  detectExistingSetup(input) {
    return allEnvPresent(input, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  },
  validateGeneratedConfig(config) {
    return validationResult([
      config.github.mode === undefined ? 'github.mode must exist.' : undefined
    ].filter((issue): issue is string => issue !== undefined));
  }
});

const jiraCapability = createCapability({
  id: 'jira',
  label: 'Atlassian MCP (Jira work items)',
  category: 'ticket-provider',
  order: 40,
  installSteps: ['Install mcp-atlassian and create an Atlassian API token before leaving mock mode; Jira is the first supported Atlassian work-item product.'],
  nonSecretConfigKeys: ['jira.base_url', 'jira.project_keys optional filter'],
  requiredSecretEnvVars: ['ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN'],
  detectExistingSetup(input) {
    return allEnvPresent(input, ['ATLASSIAN_BASE_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN']);
  },
  validateGeneratedConfig(config) {
    return validationResult([
      config.jira.mode === undefined ? 'jira.mode must exist.' : undefined,
      config.jira.baseUrl.trim().length > 0 ? undefined : 'jira.base_url must be non-empty.'
    ].filter((issue): issue is string => issue !== undefined));
  }
});

const railwayCapability = createCapability({
  id: 'railway',
  label: 'Railway',
  category: 'deployment-monitor',
  order: 50,
  installSteps: ['Install the Railway CLI and run railway login before enabling Railway MCP staging checks.'],
  nonSecretConfigKeys: ['railway.staging_branch', 'railway.production_branch'],
  requiredSecretEnvVars: [],
  detectExistingSetup(input) {
    if (input.commandExists?.('railway') === true) {
      return { configured: true, details: ['railway command is available. Run railway login outside Ewokbot if the Railway MCP session is not authenticated.'] };
    }

    return { configured: false, details: ['railway command is not available. Install the Railway CLI before enabling Railway MCP.'] };
  },
  validateGeneratedConfig(config) {
    return validationResult([
      config.railway.mode === undefined ? 'railway.mode must exist.' : undefined,
      config.railway.stagingBranch.trim().length > 0 ? undefined : 'railway.staging_branch must be non-empty.',
      config.railway.productionBranch.trim().length > 0 ? undefined : 'railway.production_branch must be non-empty.'
    ].filter((issue): issue is string => issue !== undefined));
  }
});

const vercelCapability = createCapability({
  id: 'vercel',
  label: 'Vercel',
  category: 'deployment-monitor',
  order: 60,
  installSteps: ['Create a Vercel token before enabling Vercel deployment monitoring.'],
  nonSecretConfigKeys: ['setup.deployment_monitors'],
  requiredSecretEnvVars: ['VERCEL_TOKEN'],
  detectExistingSetup(input) {
    return allEnvPresent(input, ['VERCEL_TOKEN']);
  },
  validateGeneratedConfig(_config, metadata) {
    const monitors = metadata?.deploymentMonitors ?? [];
    return validationResult(monitors.includes('vercel') ? [] : ['setup.deployment_monitors must include vercel when the Vercel capability is selected.']);
  }
});

const cliCapability = createCapability({
  id: 'cli',
  label: 'CLI control plane',
  category: 'control-plane',
  order: 70,
  installSteps: ['Use ewokbot commands from the terminal; no daemon is configured in this milestone.'],
  nonSecretConfigKeys: ['setup.control_plane'],
  requiredSecretEnvVars: [],
  detectExistingSetup() {
    return { configured: true, details: ['CLI control plane is available locally.'] };
  },
  validateGeneratedConfig(_config, metadata) {
    if (metadata?.controlPlane === undefined) {
      return validationResult([]);
    }

    return validationResult(metadata.controlPlane === 'cli' ? [] : ['setup.control_plane must be cli.']);
  }
});

export function getSetupCapabilitiesForSelections(selections: SetupSelections): readonly SetupProviderCapability[] {
  const capabilities = [opencodeCapability];

  if (selections.includeOhMyOpenAgent) {
    capabilities.push(ohMyOpenAgentCapability);
  }

  capabilities.push(githubCapability, jiraCapability);

  if (selections.deploymentMonitor === 'railway' || selections.deploymentMonitor === 'both') {
    capabilities.push(railwayCapability);
  }

  if (selections.deploymentMonitor === 'vercel' || selections.deploymentMonitor === 'both') {
    capabilities.push(vercelCapability);
  }

  capabilities.push(cliCapability);

  return [...capabilities].sort((left: SetupProviderCapability, right: SetupProviderCapability) => left.order - right.order);
}

export function getSetupCapabilities(selections: SetupSelections = defaultSetupSelections): readonly SetupProviderCapability[] {
  return getSetupCapabilitiesForSelections(selections);
}

export function getDeploymentMonitors(selection: DeploymentMonitorSelection): readonly string[] {
  if (selection === 'none') {
    return [];
  }

  if (selection === 'both') {
    return ['railway', 'vercel'];
  }

  return [selection];
}

export function getRequiredEnvPlaceholders(selections: SetupSelections): readonly string[] {
  const names = getSetupCapabilitiesForSelections(selections).flatMap((capability) => capability.requiredSecretEnvVars);

  if (selections.ticketProvider === 'jira-mcp') {
    names.push(...(selections.jiraMcpServer ?? atlassianJiraMcpPreset.server).envVarNames);
  }

  return [...new Set(names)].sort();
}
