import { parseWorkspaceConfig } from '../config/index.js';
import { getDeploymentMonitors, getRequiredEnvPlaceholders, type SetupSelections } from './provider-capability.js';

export interface OnboardingFiles {
  readonly workspaceYaml: string;
  readonly envExample: string;
}

export function renderOnboardingWorkspaceConfig(selections: SetupSelections): string {
  const monitors = getDeploymentMonitors(selections.deploymentMonitor);
  const optionalTools = selections.includeOhMyOpenAgent ? ['oh-my-openagent'] : [];

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
  code_host: github
  ticket_provider: jira
  deployment_monitors:${renderYamlList(monitors, 4)}
  control_plane: cli

jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD

github:
  mode: mock
  organization: agentic

railway:
  mode: mock
  staging_branch: develop
  production_branch: main

dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  args: []
  timeout_ms: 1800000
  env_var_names:
    - PATH
    - HOME
    - TMPDIR
    - TEMP
    - TMP
  max_attempts: 2

quality:
  default_profile: node

repos:
  discovery: sibling-git-directories
  exclude: []
`;
}

export function renderEnvExample(selections: SetupSelections): string {
  const placeholders = getRequiredEnvPlaceholders(selections);
  const lines = ['JIRA_BASE_URL=', 'GITHUB_ORG=', ...placeholders.map((name) => `${name}=`), 'OPENCODE_COMMAND=opencode'];
  return `${[...new Set(lines)].join('\n')}\n`;
}

export function createOnboardingFiles(selections: SetupSelections): OnboardingFiles {
  const workspaceYaml = renderOnboardingWorkspaceConfig(selections);
  parseWorkspaceConfig(workspaceYaml);

  return {
    workspaceYaml,
    envExample: renderEnvExample(selections)
  };
}

function renderYamlList(values: readonly string[], indent: number): string {
  if (values.length === 0) {
    return ' []';
  }

  const prefix = ' '.repeat(indent);
  return `\n${values.map((value) => `${prefix}- ${value}`).join('\n')}`;
}
