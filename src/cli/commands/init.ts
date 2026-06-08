import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { checkbox, confirm, input as promptInput, select } from '@inquirer/prompts';

import { atlassianJiraMcpPreset, createOnboardingFiles, defaultSetupSelections, railwayCliMcpPreset, type CodeHostSelection, type DeploymentMonitorSelection, type DevRunnerModeSelection, type McpServerSelection, type RailwayProviderSelection, type SetupSelections, type TicketProviderSelection } from '../../setup/index.js';
import { OpenCodeSetupAdapter, type DevToolCommandResult, type DevToolDetectionResult, type DevToolReadinessState } from '../../setup/index.js';
import { createEwokbotUserLayout, type ResolveEwokbotUserLayoutOptions } from '../../user-layout.js';
import { ewokbotCacheDirectory, ewokbotEnvExamplePath, ewokbotEnvPath, ewokbotLogsDirectory, ewokbotRunsDirectory, ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO } from '../program.js';

export interface InitCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly args?: readonly string[];
  readonly prompter?: InitPrompter;
  readonly commandExists?: ((command: string) => boolean) | undefined;
  readonly runCommand?: ((command: string, args: readonly string[]) => DevToolCommandResult) | undefined;
  readonly opencodeHomeDirectory?: string | undefined;
  readonly userLayoutOptions?: ResolveEwokbotUserLayoutOptions | undefined;
}

export type InitPrompter = (defaults: SetupSelections, context: InitPromptContext) => Promise<SetupSelections>;

export interface InitPromptContext {
  readonly opencodeDetection: DevToolDetectionResult;
  readonly detectOpenCode: (command?: string | undefined) => DevToolDetectionResult;
  readonly debug: boolean;
  readonly io: CliProgramIO;
}

export interface InitPromptChoice<T extends string | boolean> {
  readonly label: string;
  readonly value: T;
  readonly description?: string | undefined;
}

export interface InitPromptAdapter {
  readonly select: <T extends string | boolean>(input: { readonly message: string; readonly choices: readonly InitPromptChoice<T>[]; readonly defaultValue: T }) => Promise<T>;
  readonly confirm: (input: { readonly message: string; readonly defaultValue: boolean }) => Promise<boolean>;
  readonly input: (input: { readonly message: string; readonly defaultValue?: string | undefined }) => Promise<string>;
  readonly checkbox: <T extends string>(input: { readonly message: string; readonly choices: readonly InitPromptChoice<T>[]; readonly defaultValues: readonly T[] }) => Promise<readonly T[]>;
}

class InitArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitArgumentError';
  }
}

const defaultGitHubMcpServer: McpServerSelection = { id: 'github', command: 'github-mcp-server', args: [], envVarNames: ['GITHUB_TOKEN'] };

export async function runInitCommand(options: InitCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const targetPath = join(cwd, ewokbotWorkspaceConfigPath);
  const envPath = join(cwd, ewokbotEnvPath);
  const envExamplePath = join(cwd, ewokbotEnvExamplePath);
  let selections: SetupSelections;

  const existingPaths = [targetPath, envPath, envExamplePath].filter((path) => existsSync(path));

  if (existingPaths.length > 0) {
    options.io.stderr(`Refusing to overwrite existing Ewokbot onboarding file(s): ${existingPaths.join(', ')}\n`);
    return 1;
  }

  try {
    selections = await resolveSelections(options);
  } catch (error) {
    if (error instanceof InitArgumentError) {
      options.io.stderr(`${error.message}\n`);
      return 1;
    }

    throw error;
  }

  if (selections.devRunnerMode === 'opencode') {
    const detection = detectOpenCode(cwd, options, selections.opencodeCommand);

    if (detection.state === 'not_installed' || detection.state === 'command_failed' || detection.state === 'installed_unsupported') {
      options.io.stderr(`OpenCode command "${detection.command}" is not ready (${detection.state}).\n`);
      options.io.stderr('Choose the mock dev runner to continue without OpenCode, or set OPENCODE_COMMAND to an installed command before selecting OpenCode. Ewokbot does not run installers or auth flows automatically.\n');
      return 1;
    }

    const parsed = parseInitArgs(options.args ?? []);

    if (parsed.debug && (detection.state === 'installed_not_authenticated' || detection.state === 'installed_authenticated_no_model')) {
      options.io.stdout(`OpenCode readiness warning: ${detection.state}. Continue setup, then finish OpenCode auth/model configuration outside Ewokbot before real development runs.\n`);
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
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseInitArgs(options.args ?? []);

  if (parsed.nonInteractive) {
    return parsed.selections;
  }

  const context = createInitPromptContext(cwd, options, parsed.selections.opencodeCommand, parsed.debug);

  if (options.prompter !== undefined) {
    return options.prompter(parsed.selections, context);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    return promptForSelections(parsed.selections, context);
  }

  return parsed.selections;
}

function createInitPromptContext(cwd: string, options: InitCommandOptions, command: string | undefined, debug: boolean): InitPromptContext {
  return {
    opencodeDetection: detectOpenCode(cwd, options, command),
    detectOpenCode: (customCommand) => detectOpenCode(cwd, options, customCommand ?? command),
    debug,
    io: options.io
  };
}

function detectOpenCode(cwd: string, options: InitCommandOptions, command: string | undefined): DevToolDetectionResult {
  return new OpenCodeSetupAdapter({
    workspaceRoot: cwd,
    homeDirectory: options.opencodeHomeDirectory ?? homedir(),
    env: process.env,
    command,
    fileExists: existsSync,
    readFile: defaultReadFile,
    commandExists: options.commandExists ?? defaultCommandExists,
    runCommand: options.runCommand
  }).detect();
}

function parseInitArgs(args: readonly string[]): { readonly nonInteractive: boolean; readonly debug: boolean; readonly selections: SetupSelections } {
  let nonInteractive = false;
  let debug = false;
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

    if (arg === '--debug' || arg === '--verbose') {
      debug = true;
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

  return { nonInteractive, debug, selections: { ...defaultSetupSelections, deploymentMonitor, includeOhMyOpenAgent, ticketProvider, codeHostProvider, railwayProvider, devRunnerMode } };
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

async function promptForSelections(defaults: SetupSelections, context: InitPromptContext): Promise<SetupSelections> {
  return promptForSelectionsWithPromptAdapter(defaults, createInquirerPromptAdapter(), context);
}

export async function promptForSelectionsWithPromptAdapter(defaults: SetupSelections, prompts: InitPromptAdapter, context: InitPromptContext): Promise<SetupSelections> {
  const envValues: Record<string, string | undefined> = { ...(defaults.envValues ?? {}) };
  const opencodeChoice = await promptForOpenCodeSelection(defaults, prompts, context);
  const devRunnerMode = opencodeChoice.devRunnerMode;
  const opencodeCommand = opencodeChoice.opencodeCommand;
  const includeOhMyOpenAgent = await prompts.confirm({ message: 'Include oh-my-openagent setup notes?', defaultValue: defaults.includeOhMyOpenAgent });

  const ticketProvider = await prompts.select({ message: 'Ticket provider', choices: [
    { label: 'Mock', value: 'mock' as const },
    { label: 'Jira MCP', value: 'jira-mcp' as const }
  ], defaultValue: defaults.ticketProvider ?? 'mock' });
  let jiraBaseUrl = defaults.jiraBaseUrl;
  let jiraProjectKeys = defaults.jiraProjectKeys;
  let jiraMcpServer = defaults.jiraMcpServer;

  if (ticketProvider === 'jira-mcp') {
    jiraBaseUrl = nonEmptyPromptValue(await prompts.input({ message: 'Jira base URL', defaultValue: defaults.jiraBaseUrl ?? 'https://jira.example.test' }), defaults.jiraBaseUrl);
    jiraProjectKeys = withDefaultList(parseCsv(await prompts.input({ message: 'Jira project keys, comma-separated', defaultValue: (defaults.jiraProjectKeys ?? ['AD']).join(',') })), defaults.jiraProjectKeys);
    envValues.ATLASSIAN_EMAIL = await askSecret(prompts, 'ATLASSIAN_EMAIL value');
    envValues.ATLASSIAN_API_TOKEN = await askSecret(prompts, 'ATLASSIAN_API_TOKEN value');
    jiraMcpServer = defaults.jiraMcpServer ?? atlassianJiraMcpPreset.server;
  }

  const codeHostProvider = await prompts.select({ message: 'Code host provider', choices: [
    { label: 'Mock', value: 'mock' as const },
    { label: 'GitHub MCP', value: 'github-mcp' as const }
  ], defaultValue: defaults.codeHostProvider ?? 'mock' });
  let githubOrganization = defaults.githubOrganization;
  let githubMcpServer = defaults.githubMcpServer;

  if (codeHostProvider === 'github-mcp') {
    githubOrganization = nonEmptyPromptValue(await prompts.input({ message: 'GitHub organization', defaultValue: defaults.githubOrganization ?? 'agentic' }), defaults.githubOrganization);
    envValues.GITHUB_TOKEN = await askSecret(prompts, 'GITHUB_TOKEN value');
    githubMcpServer = await promptForMcpServer(prompts, 'GitHub MCP', defaults.githubMcpServer ?? defaultGitHubMcpServer);
  }

  const deploymentMonitor = deploymentMonitorFromChoices(await prompts.checkbox({
    message: 'Deployment/CI monitors',
    choices: [
      { label: 'Railway', value: 'railway' as const },
      { label: 'Vercel', value: 'vercel' as const }
    ],
    defaultValues: deploymentMonitorToChoices(defaults.deploymentMonitor)
  }));
  let railwayProvider = defaults.railwayProvider;
  let railwayMcpServer = defaults.railwayMcpServer;

  if (deploymentMonitor === 'railway' || deploymentMonitor === 'both') {
    railwayProvider = await prompts.select({ message: 'Railway provider', choices: [
      { label: 'Mock', value: 'mock' as const },
      { label: 'Railway MCP', value: 'railway-mcp' as const }
    ], defaultValue: defaults.railwayProvider ?? 'mock' });

    if (railwayProvider === 'railway-mcp') {
      railwayMcpServer = defaults.railwayMcpServer ?? railwayCliMcpPreset.server;
    }
  }

  if (deploymentMonitor === 'vercel' || deploymentMonitor === 'both') {
    envValues.VERCEL_TOKEN = await askSecret(prompts, 'VERCEL_TOKEN value');
  }

  return {
    ...defaults,
    deploymentMonitor,
    includeOhMyOpenAgent,
    devRunnerMode,
    opencodeCommand,
    opencodeEnvVarNames: [],
    modelProviderEnvVarNames: [],
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

async function promptForOpenCodeSelection(
  defaults: SetupSelections,
  prompts: InitPromptAdapter,
  context: InitPromptContext
): Promise<{ readonly devRunnerMode: DevRunnerModeSelection; readonly opencodeCommand: string | undefined }> {
  const detection = context.opencodeDetection;

  if (context.debug) {
    context.io.stdout(renderOpenCodeReadiness(detection));
  }

  if (detection.state === 'installed_ready') {
    const devRunnerMode = await prompts.select({ message: 'Development runner', choices: [
      { label: 'Mock', value: 'mock' as const, description: 'Keep all development execution fake and local.' },
      { label: `OpenCode (${detection.command} ready)`, value: 'opencode' as const, description: 'Use OpenCode without collecting provider API keys in Ewokbot.' }
    ], defaultValue: defaults.devRunnerMode ?? 'mock' });

    return { devRunnerMode, opencodeCommand: devRunnerMode === 'opencode' ? detection.command : defaults.opencodeCommand };
  }

  if (detection.state === 'installed_not_authenticated' || detection.state === 'installed_authenticated_no_model') {
    const choice = await prompts.select({ message: 'Development runner', choices: [
      { label: 'Mock', value: 'mock' as const, description: 'Continue safely without real OpenCode runs.' },
      { label: `OpenCode (${detection.state})`, value: 'opencode' as const, description: 'Continue only after explicit acknowledgement; finish OpenCode setup outside Ewokbot.' },
      { label: 'Show OpenCode setup instructions and use mock', value: 'instructions' as const, description: 'Print next steps without launching installers or auth flows.' }
    ], defaultValue: defaults.devRunnerMode ?? 'mock' });

    if (choice === 'instructions') {
      context.io.stdout(renderOpenCodeInstructions(detection));
      return { devRunnerMode: 'mock', opencodeCommand: defaults.opencodeCommand };
    }

    if (choice === 'opencode') {
      const acknowledged = await prompts.confirm({
        message: `Continue with OpenCode state ${detection.state} and finish setup outside Ewokbot before real development runs?`,
        defaultValue: false
      });

      if (!acknowledged) {
        return { devRunnerMode: 'mock', opencodeCommand: defaults.opencodeCommand };
      }
    }

    return { devRunnerMode: choice, opencodeCommand: choice === 'opencode' ? detection.command : defaults.opencodeCommand };
  }

  const choice = await prompts.select({ message: 'Development runner', choices: [
    { label: 'Mock', value: 'mock' as const, description: 'Continue without OpenCode.' },
    { label: 'Enter custom OpenCode command path', value: 'custom' as const, description: 'Check another local command without installing anything.' },
    { label: 'Show OpenCode setup instructions and use mock', value: 'instructions' as const, description: 'Print next steps without launching installers or auth flows.' }
  ], defaultValue: 'mock' });

  if (choice === 'instructions') {
    context.io.stdout(renderOpenCodeInstructions(detection));
    return { devRunnerMode: 'mock', opencodeCommand: defaults.opencodeCommand };
  }

  if (choice === 'custom') {
    const customCommand = nonEmptyPromptValue(await prompts.input({ message: 'OpenCode command path', defaultValue: defaults.opencodeCommand ?? 'opencode' }), defaults.opencodeCommand ?? 'opencode');
    const customDetection = context.detectOpenCode(customCommand);

    if (context.debug) {
      context.io.stdout(renderOpenCodeReadiness(customDetection));
    }

    if (customDetection.state === 'installed_ready') {
      return { devRunnerMode: 'opencode', opencodeCommand: customDetection.command };
    }

    if (customDetection.state === 'installed_not_authenticated' || customDetection.state === 'installed_authenticated_no_model') {
      const acknowledged = await prompts.confirm({
        message: `Continue with OpenCode state ${customDetection.state} and finish setup outside Ewokbot before real development runs?`,
        defaultValue: false
      });

      return acknowledged
        ? { devRunnerMode: 'opencode', opencodeCommand: customDetection.command }
        : { devRunnerMode: 'mock', opencodeCommand: customCommand };
    }

    context.io.stdout(renderOpenCodeInstructions(customDetection));
    return { devRunnerMode: 'mock', opencodeCommand: customCommand };
  }

  return { devRunnerMode: 'mock', opencodeCommand: defaults.opencodeCommand };
}

async function promptForMcpServer(prompts: InitPromptAdapter, label: string, defaults: McpServerSelection): Promise<McpServerSelection> {
  const id = nonEmptyPromptValue(await prompts.input({ message: `${label} server id`, defaultValue: defaults.id }), defaults.id);
  const command = nonEmptyPromptValue(await prompts.input({ message: `${label} command`, defaultValue: defaults.command }), defaults.command);
  const args = withDefaultList(parseCsv(await prompts.input({ message: `${label} args, comma-separated`, defaultValue: defaults.args.join(',') })), defaults.args);
  const envVarNames = withDefaultList(parseCsv(await prompts.input({ message: `${label} env_var_names, comma-separated`, defaultValue: defaults.envVarNames.join(',') })), defaults.envVarNames);

  return { id, command, args, envVarNames };
}

async function askSecret(prompts: InitPromptAdapter, message: string): Promise<string> {
  return (await prompts.input({ message })).trim();
}

function withDefaultList(values: readonly string[], fallback: readonly string[] | undefined): readonly string[] {
  return values.length === 0 ? fallback ?? [] : values;
}

function parseCsv(value: string): readonly string[] {
  return value.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

function createInquirerPromptAdapter(): InitPromptAdapter {
  return {
    async select(input) {
      return select({
        message: input.message,
        choices: input.choices.map((choice) => ({ name: choice.label, value: choice.value, description: choice.description })),
        default: input.defaultValue
      });
    },
    async confirm(input) {
      return confirm({ message: input.message, default: input.defaultValue });
    },
    async input(input) {
      return promptInput({ message: input.message, default: input.defaultValue });
    },
    async checkbox(input) {
      return checkbox({
        message: input.message,
        choices: input.choices.map((choice) => ({ name: choice.label, value: choice.value, description: choice.description, checked: input.defaultValues.includes(choice.value) }))
      });
    }
  };
}

function nonEmptyPromptValue(value: string, fallback: string | undefined): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback ?? '';
}

function deploymentMonitorToChoices(selection: DeploymentMonitorSelection): readonly ('railway' | 'vercel')[] {
  if (selection === 'both') {
    return ['railway', 'vercel'];
  }

  if (selection === 'railway' || selection === 'vercel') {
    return [selection];
  }

  return [];
}

function deploymentMonitorFromChoices(values: readonly ('railway' | 'vercel')[]): DeploymentMonitorSelection {
  const selected = new Set(values);

  if (selected.has('railway') && selected.has('vercel')) {
    return 'both';
  }

  if (selected.has('railway')) {
    return 'railway';
  }

  if (selected.has('vercel')) {
    return 'vercel';
  }

  return 'none';
}

function renderOpenCodeReadiness(detection: DevToolDetectionResult): string {
  return [`OpenCode readiness: ${detection.command} is ${readinessLabel(detection.state)}.`, ...detection.details.map((detail) => `- ${detail}`), ''].join('\n');
}

function renderOpenCodeInstructions(detection: DevToolDetectionResult): string {
  return [`OpenCode setup instructions for ${detection.command}:`, ...detection.nextSteps.map((step) => `- ${step}`), 'Ewokbot did not run installers, auth flows, or OpenCode commands for setup.', ''].join('\n');
}

function readinessLabel(state: DevToolReadinessState): string {
  if (state === 'installed_ready') {
    return 'ready';
  }

  if (state === 'installed_not_authenticated') {
    return 'installed but not authenticated';
  }

  if (state === 'installed_authenticated_no_model') {
    return 'authenticated but missing model configuration';
  }

  if (state === 'not_installed') {
    return 'not installed';
  }

  if (state === 'installed_unsupported') {
    return 'installed but unsupported';
  }

  return 'not ready because command detection failed';
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

function defaultReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
