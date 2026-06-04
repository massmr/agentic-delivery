import type { WorkspaceConfig } from '../config/index.js';

export type DeploymentMonitorSelection = 'railway' | 'vercel' | 'both';

export interface SetupSelections {
  readonly deploymentMonitor: DeploymentMonitorSelection;
  readonly includeOhMyOpenAgent: boolean;
}

export interface SetupDetectionInput {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fileExists?: (path: string) => boolean;
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
  includeOhMyOpenAgent: false
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
    const command = input.env?.OPENCODE_COMMAND?.trim() || 'opencode';

    if (envHas(input.env, 'OPENCODE_COMMAND')) {
      return { configured: true, details: ['OPENCODE_COMMAND is present in the environment.'] };
    }

    if (input.commandExists?.(command) === true) {
      return { configured: true, details: [`${command} is available from the injected command check.`] };
    }

    return { configured: false, details: ['OPENCODE_COMMAND is missing and the injected command check did not find opencode.'] };
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
  installSteps: ['Create a GitHub token with repository permissions before leaving mock mode.'],
  nonSecretConfigKeys: ['github.organization'],
  requiredSecretEnvVars: ['GITHUB_TOKEN'],
  detectExistingSetup(input) {
    return allEnvPresent(input, ['GITHUB_TOKEN', 'GITHUB_ORG']);
  },
  validateGeneratedConfig(config) {
    return validationResult([
      config.github.mode === undefined ? 'github.mode must exist.' : undefined,
      config.github.organization.trim().length > 0 ? undefined : 'github.organization must be non-empty.'
    ].filter((issue): issue is string => issue !== undefined));
  }
});

const jiraCapability = createCapability({
  id: 'jira',
  label: 'Jira',
  category: 'ticket-provider',
  order: 40,
  installSteps: ['Create a Jira API token before leaving mock mode.'],
  nonSecretConfigKeys: ['jira.base_url', 'jira.project_keys'],
  requiredSecretEnvVars: ['JIRA_EMAIL', 'JIRA_API_TOKEN'],
  detectExistingSetup(input) {
    return allEnvPresent(input, ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  },
  validateGeneratedConfig(config) {
    return validationResult([
      config.jira.mode === undefined ? 'jira.mode must exist.' : undefined,
      config.jira.baseUrl.trim().length > 0 ? undefined : 'jira.base_url must be non-empty.',
      config.jira.projectKeys.length > 0 ? undefined : 'jira.project_keys must be non-empty.'
    ].filter((issue): issue is string => issue !== undefined));
  }
});

const railwayCapability = createCapability({
  id: 'railway',
  label: 'Railway',
  category: 'deployment-monitor',
  order: 50,
  installSteps: ['Create a Railway token before enabling Railway staging checks.'],
  nonSecretConfigKeys: ['railway.staging_branch', 'railway.production_branch'],
  requiredSecretEnvVars: ['RAILWAY_TOKEN'],
  detectExistingSetup(input) {
    return allEnvPresent(input, ['RAILWAY_TOKEN']);
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
  if (selection === 'both') {
    return ['railway', 'vercel'];
  }

  return [selection];
}

export function getRequiredEnvPlaceholders(selections: SetupSelections): readonly string[] {
  const names = getSetupCapabilitiesForSelections(selections).flatMap((capability) => capability.requiredSecretEnvVars);
  return [...new Set(names)].sort();
}
