import { accessSync, constants, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { createOnboardingFiles, defaultSetupSelections, type CodeHostSelection, type DeploymentMonitorSelection, type DevRunnerModeSelection, type McpServerSelection, type RailwayProviderSelection, type SetupSelections, type TicketProviderSelection } from '../../setup/index.js';
import { createEwokbotUserLayout, type ResolveEwokbotUserLayoutOptions } from '../../user-layout.js';
import { ewokbotCacheDirectory, ewokbotEnvExamplePath, ewokbotEnvPath, ewokbotLogsDirectory, ewokbotRunsDirectory, ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO } from '../program.js';

export interface InitCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly args?: readonly string[];
  readonly prompter?: InitPrompter;
  readonly commandExists?: ((command: string) => boolean) | undefined;
  readonly userLayoutOptions?: ResolveEwokbotUserLayoutOptions | undefined;
}

export type InitPrompter = (defaults: SetupSelections) => Promise<SetupSelections>;
export type InitQuestioner = (question: string) => Promise<string>;

class InitArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitArgumentError';
  }
}

const OPENCODE_INSTALL_COMMAND = 'curl -fsSL https://opencode.ai/install | bash';
const defaultJiraMcpServer: McpServerSelection = { id: 'jira', command: 'jira-mcp', args: [], envVarNames: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] };
const defaultGitHubMcpServer: McpServerSelection = { id: 'github', command: 'github-mcp-server', args: [], envVarNames: ['GITHUB_TOKEN'] };
const defaultRailwayMcpServer: McpServerSelection = { id: 'railway', command: 'railway-mcp', args: [], envVarNames: ['RAILWAY_TOKEN'] };

export async function runInitCommand(options: InitCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const targetPath = join(cwd, ewokbotWorkspaceConfigPath);
  const envPath = join(cwd, ewokbotEnvPath);
  const envExamplePath = join(cwd, ewokbotEnvExamplePath);
  let selections: SetupSelections;

  try {
    selections = await resolveSelections(options);
  } catch (error) {
    if (error instanceof InitArgumentError) {
      options.io.stderr(`${error.message}\n`);
      return 1;
    }

    throw error;
  }

  const existingPaths = [targetPath, envPath, envExamplePath].filter((path) => existsSync(path));

  if (existingPaths.length > 0) {
    options.io.stderr(`Refusing to overwrite existing Ewokbot onboarding file(s): ${existingPaths.join(', ')}\n`);
    return 1;
  }

  if (selections.devRunnerMode === 'opencode') {
    const opencodeCommand = selections.opencodeCommand?.trim() || defaultSetupSelections.opencodeCommand || 'opencode';
    const commandExists = options.commandExists ?? defaultCommandExists;

    if (!commandExists(opencodeCommand)) {
      options.io.stderr(`OpenCode command "${opencodeCommand}" was not found. Install OpenCode with: ${OPENCODE_INSTALL_COMMAND}\n`);
      options.io.stderr('Choose the mock dev runner to continue without OpenCode, or set OPENCODE_COMMAND to an installed command before selecting OpenCode.\n');
      return 1;
    }
  }

  const files = createOnboardingFiles(selections);
  const userLayout = await createEwokbotUserLayout(options.userLayoutOptions ?? { homeDirectory: homedir(), env: process.env });

  mkdirSync(dirname(targetPath), { recursive: true });
  mkdirSync(join(cwd, ewokbotRunsDirectory), { recursive: true });
  mkdirSync(join(cwd, ewokbotLogsDirectory), { recursive: true });
  mkdirSync(join(cwd, ewokbotCacheDirectory), { recursive: true });
  writeFileSync(targetPath, files.workspaceYaml, 'utf8');
  writeFileSync(envPath, files.env, 'utf8');
  writeFileSync(envExamplePath, files.envExample, 'utf8');

  options.io.stdout(`Created ${targetPath}\n`);
  options.io.stdout(`Created ${envPath}\n`);
  options.io.stdout(`Created ${envExamplePath}\n`);
  options.io.stdout(`Created ${join(cwd, ewokbotRunsDirectory)}\n`);
  options.io.stdout(`Created ${join(cwd, ewokbotLogsDirectory)}\n`);
  options.io.stdout(`Created ${join(cwd, ewokbotCacheDirectory)}\n`);
  options.io.stdout(`Prepared ${userLayout.config.directory}\n`);
  options.io.stdout(`Prepared ${userLayout.auth.file}\n`);
  options.io.stdout(`Prepared ${userLayout.state.directory}\n`);
  options.io.stdout(`Prepared ${userLayout.cache.directory}\n`);
  options.io.stdout(`Secrets stay in ${ewokbotEnvPath}; generated output never prints secret values.\n`);
  return 0;
}

async function resolveSelections(options: InitCommandOptions): Promise<SetupSelections> {
  const parsed = parseInitArgs(options.args ?? []);

  if (parsed.nonInteractive) {
    return parsed.selections;
  }

  if (options.prompter !== undefined) {
    return options.prompter(parsed.selections);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    return promptForSelections(parsed.selections);
  }

  return parsed.selections;
}

function parseInitArgs(args: readonly string[]): { readonly nonInteractive: boolean; readonly selections: SetupSelections } {
  let nonInteractive = false;
  let deploymentMonitor = defaultSetupSelections.deploymentMonitor;
  let includeOhMyOpenAgent = defaultSetupSelections.includeOhMyOpenAgent;
  let ticketProvider = defaultSetupSelections.ticketProvider;
  let codeHostProvider = defaultSetupSelections.codeHostProvider;
  let railwayProvider = defaultSetupSelections.railwayProvider;
  let devRunnerMode = defaultSetupSelections.devRunnerMode;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--non-interactive' || arg === '--yes') {
      nonInteractive = true;
      continue;
    }

    if (arg === '--with-oh-my-openagent') {
      includeOhMyOpenAgent = true;
      continue;
    }

    if (arg === '--dev-runner') {
      const value = readFlagValue(args, index, '--dev-runner', 'mock, opencode');
      devRunnerMode = parseDevRunnerMode(value);
      index += 1;
      continue;
    }

    if (arg === '--ticket-provider') {
      const value = readFlagValue(args, index, '--ticket-provider', 'mock, jira-mcp');
      ticketProvider = parseTicketProvider(value);
      index += 1;
      continue;
    }

    if (arg === '--code-host') {
      const value = readFlagValue(args, index, '--code-host', 'mock, github-mcp');
      codeHostProvider = parseCodeHostProvider(value);
      index += 1;
      continue;
    }

    if (arg === '--railway-provider') {
      const value = readFlagValue(args, index, '--railway-provider', 'mock, railway-mcp');
      railwayProvider = parseRailwayProvider(value);
      index += 1;
      continue;
    }

    if (arg === '--deployment-monitor') {
      const value = args[index + 1];

      deploymentMonitor = parseDeploymentMonitor(readFlagValue(args, index, '--deployment-monitor', 'none, railway, vercel, both'));
      index += 1;
    }
  }

  return { nonInteractive, selections: { ...defaultSetupSelections, deploymentMonitor, includeOhMyOpenAgent, ticketProvider, codeHostProvider, railwayProvider, devRunnerMode } };
}

function parseDeploymentMonitor(value: string | undefined): DeploymentMonitorSelection {
  if (value === 'none' || value === 'railway' || value === 'vercel' || value === 'both') {
    return value;
  }

  throw new InitArgumentError(`Invalid --deployment-monitor value "${value ?? ''}". Use one of: none, railway, vercel, both.`);
}

function parseDevRunnerMode(value: string | undefined): DevRunnerModeSelection {
  if (value === 'mock' || value === 'opencode') {
    return value;
  }

  throw new InitArgumentError(`Invalid --dev-runner value "${value ?? ''}". Use one of: mock, opencode.`);
}

function parseTicketProvider(value: string | undefined): TicketProviderSelection {
  if (value === 'mock' || value === 'jira-mcp') {
    return value;
  }

  throw new InitArgumentError(`Invalid --ticket-provider value "${value ?? ''}". Use one of: mock, jira-mcp.`);
}

function parseCodeHostProvider(value: string | undefined): CodeHostSelection {
  if (value === 'mock' || value === 'github-mcp') {
    return value;
  }

  throw new InitArgumentError(`Invalid --code-host value "${value ?? ''}". Use one of: mock, github-mcp.`);
}

function parseRailwayProvider(value: string | undefined): RailwayProviderSelection {
  if (value === 'mock' || value === 'railway-mcp') {
    return value;
  }

  throw new InitArgumentError(`Invalid --railway-provider value "${value ?? ''}". Use one of: mock, railway-mcp.`);
}

function readFlagValue(args: readonly string[], index: number, flag: string, choices: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new InitArgumentError(`Missing value for ${flag}. Use one of: ${choices}.`);
  }

  return value;
}

async function promptForSelections(defaults: SetupSelections): Promise<SetupSelections> {
  const readline = createInterface({ input, output });
  const keepAlive = setInterval(() => undefined, 60_000);

  input.resume();

  try {
    return await promptForSelectionsWithQuestioner(defaults, (question) => askReadline(readline, question));
  } finally {
    clearInterval(keepAlive);
    readline.close();
    input.pause();
  }
}

export async function promptForSelectionsWithQuestioner(defaults: SetupSelections, ask: InitQuestioner): Promise<SetupSelections> {
  const envValues: Record<string, string | undefined> = { ...(defaults.envValues ?? {}) };
  const devRunnerMode = await askChoice(ask, 'Development runner', [
    { label: 'Mock', value: 'mock' as const },
    { label: 'OpenCode', value: 'opencode' as const }
  ], defaults.devRunnerMode ?? 'mock');
  const includeOhMyOpenAgent = await askChoice(ask, 'Include oh-my-openagent setup notes?', [
    { label: 'No', value: false },
    { label: 'Yes', value: true }
  ], false);
  let opencodeCommand = defaults.opencodeCommand;
  let opencodeEnvVarNames = defaults.opencodeEnvVarNames ?? [];
  let modelProviderEnvVarNames = defaults.modelProviderEnvVarNames ?? [];

  if (devRunnerMode === 'opencode') {
    opencodeCommand = (await ask(`OpenCode command [${defaults.opencodeCommand ?? 'opencode'}]: `)).trim() || defaults.opencodeCommand;
    opencodeEnvVarNames = await askEnvVarPreset(ask, 'OpenCode-specific env vars', [
      { label: 'None', value: [] },
      { label: 'OPENCODE_API_KEY', value: ['OPENCODE_API_KEY'] }
    ], []);
    modelProviderEnvVarNames = await askEnvVarPreset(ask, 'Model/provider API key env vars for OpenCode', [
      { label: 'None', value: [] },
      { label: 'OPENAI_API_KEY', value: ['OPENAI_API_KEY'] },
      { label: 'ANTHROPIC_API_KEY', value: ['ANTHROPIC_API_KEY'] },
      { label: 'OPENAI_API_KEY and ANTHROPIC_API_KEY', value: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] }
    ], []);
    await collectEnvValues(ask, envValues, [...opencodeEnvVarNames, ...modelProviderEnvVarNames]);
  }

  const ticketProvider = await askChoice(ask, 'Ticket provider', [
    { label: 'Mock', value: 'mock' as const },
    { label: 'Jira MCP', value: 'jira-mcp' as const }
  ], defaults.ticketProvider ?? 'mock');
  let jiraBaseUrl = defaults.jiraBaseUrl;
  let jiraProjectKeys = defaults.jiraProjectKeys;
  let jiraMcpServer = defaults.jiraMcpServer;

  if (ticketProvider === 'jira-mcp') {
    jiraBaseUrl = (await ask(`Jira base URL [${defaults.jiraBaseUrl ?? 'https://jira.example.test'}]: `)).trim() || defaults.jiraBaseUrl;
    jiraProjectKeys = withDefaultList(parseCsv(await ask(`Jira project keys, comma-separated [${(defaults.jiraProjectKeys ?? ['AD']).join(',')}]: `)), defaults.jiraProjectKeys);
    envValues.JIRA_EMAIL = await askSecret(ask, 'JIRA_EMAIL value: ');
    envValues.JIRA_API_TOKEN = await askSecret(ask, 'JIRA_API_TOKEN value: ');
    jiraMcpServer = await promptForMcpServer(ask, 'Jira MCP', defaults.jiraMcpServer ?? defaultJiraMcpServer);
  }

  const codeHostProvider = await askChoice(ask, 'Code host provider', [
    { label: 'Mock', value: 'mock' as const },
    { label: 'GitHub MCP', value: 'github-mcp' as const }
  ], defaults.codeHostProvider ?? 'mock');
  let githubOrganization = defaults.githubOrganization;
  let githubMcpServer = defaults.githubMcpServer;

  if (codeHostProvider === 'github-mcp') {
    githubOrganization = (await ask(`GitHub organization [${defaults.githubOrganization ?? 'agentic'}]: `)).trim() || defaults.githubOrganization;
    envValues.GITHUB_TOKEN = await askSecret(ask, 'GITHUB_TOKEN value: ');
    githubMcpServer = await promptForMcpServer(ask, 'GitHub MCP', defaults.githubMcpServer ?? defaultGitHubMcpServer);
  }

  const deploymentMonitor = await askChoice(ask, 'Deployment/CI monitor', [
    { label: 'None', value: 'none' as const },
    { label: 'Railway', value: 'railway' as const },
    { label: 'Vercel', value: 'vercel' as const },
    { label: 'Railway and Vercel', value: 'both' as const }
  ], defaults.deploymentMonitor);
  let railwayProvider = defaults.railwayProvider;
  let railwayMcpServer = defaults.railwayMcpServer;

  if (deploymentMonitor === 'railway' || deploymentMonitor === 'both') {
    railwayProvider = await askChoice(ask, 'Railway provider', [
      { label: 'Mock', value: 'mock' as const },
      { label: 'Railway MCP', value: 'railway-mcp' as const }
    ], defaults.railwayProvider ?? 'mock');

    if (railwayProvider === 'railway-mcp') {
      envValues.RAILWAY_TOKEN = await askSecret(ask, 'RAILWAY_TOKEN value: ');
      railwayMcpServer = await promptForMcpServer(ask, 'Railway MCP', defaults.railwayMcpServer ?? defaultRailwayMcpServer);
    }
  }

  if (deploymentMonitor === 'vercel' || deploymentMonitor === 'both') {
    envValues.VERCEL_TOKEN = await askSecret(ask, 'VERCEL_TOKEN value: ');
  }

  return {
    ...defaults,
    deploymentMonitor,
    includeOhMyOpenAgent,
    devRunnerMode,
    opencodeCommand,
    opencodeEnvVarNames,
    modelProviderEnvVarNames,
    ticketProvider,
    jiraBaseUrl,
    jiraProjectKeys,
    jiraMcpServer,
    codeHostProvider,
    githubOrganization,
    githubMcpServer,
    railwayProvider,
    railwayMcpServer,
    envValues
  };
}

async function promptForMcpServer(ask: InitQuestioner, label: string, defaults: McpServerSelection): Promise<McpServerSelection> {
  const id = (await ask(`${label} server id [${defaults.id}]: `)).trim() || defaults.id;
  const command = (await ask(`${label} command [${defaults.command}]: `)).trim() || defaults.command;
  const args = withDefaultList(parseCsv(await ask(`${label} args, comma-separated [${defaults.args.join(',')}]: `)), defaults.args);
  const envVarNames = withDefaultList(parseCsv(await ask(`${label} env_var_names, comma-separated [${defaults.envVarNames.join(',')}]: `)), defaults.envVarNames);

  return { id, command, args, envVarNames };
}

async function collectEnvValues(ask: InitQuestioner, envValues: Record<string, string | undefined>, names: readonly string[]): Promise<void> {
  for (const name of [...new Set(names)]) {
    envValues[name] = await askSecret(ask, `${name} value: `);
  }
}

async function askSecret(ask: InitQuestioner, question: string): Promise<string> {
  return (await ask(question)).trim();
}

function withDefaultList(values: readonly string[], fallback: readonly string[] | undefined): readonly string[] {
  return values.length === 0 ? fallback ?? [] : values;
}

function parseCsv(value: string): readonly string[] {
  return value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

interface ChoiceOption<T extends string | boolean> {
  readonly label: string;
  readonly value: T;
}

interface EnvVarPreset {
  readonly label: string;
  readonly value: readonly string[];
}

async function askChoice<T extends string | boolean>(ask: InitQuestioner, label: string, options: readonly ChoiceOption<T>[], defaultValue: T): Promise<T> {
  const defaultIndex = Math.max(0, options.findIndex((option) => option.value === defaultValue));
  const prompt = [
    `${label}:`,
    ...options.map((option, index) => `  ${index + 1}. ${option.label}`),
    `Choose [${defaultIndex + 1}]: `
  ].join('\n');

  while (true) {
    const answer = (await ask(prompt)).trim();

    if (answer.length === 0) {
      return options[defaultIndex].value;
    }

    const numeric = Number.parseInt(answer, 10);

    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
      return options[numeric - 1].value;
    }

    const match = options.find((option) => String(option.value).toLowerCase() === answer.toLowerCase() || option.label.toLowerCase() === answer.toLowerCase());

    if (match !== undefined) {
      return match.value;
    }
  }
}

async function askEnvVarPreset(
  ask: InitQuestioner,
  label: string,
  presets: readonly EnvVarPreset[],
  defaultValue: readonly string[]
): Promise<readonly string[]> {
  const customValue = '__custom__';
  const choice = await askChoice<string>(ask, label, [
    ...presets.map((preset) => ({ label: preset.label, value: preset.value.join(',') })),
    { label: 'Custom comma-separated list', value: customValue }
  ], defaultValue.join(','));

  if (choice === customValue) {
    return parseCsv(await ask(`${label} custom env var names, comma-separated: `));
  }

  return parseCsv(choice);
}

function askReadline(readline: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    readline.question(question, resolve);
  });
}

function defaultCommandExists(command: string): boolean {
  const trimmed = command.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return canExecute(trimmed);
  }

  return (process.env.PATH ?? '').split(delimiter).some((directory) => directory.length > 0 && canExecute(join(directory, trimmed)));
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
