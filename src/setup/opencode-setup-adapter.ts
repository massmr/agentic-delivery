import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import type {
  DevToolCommandResult,
  DevToolConfigSummary,
  DevToolDetectionResult,
  DevToolDoctorCheck,
  DevToolLaunchSetupResult,
  DevToolReadinessState,
  DevToolSetupAdapter,
  DevToolSetupAdapterDependencies
} from './dev-tool-setup-adapter.js';

export interface OpenCodeSetupAdapterOptions {
  readonly command?: string | undefined;
  readonly configCommand?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly homeDirectory?: string | undefined;
  readonly workspaceRoot: string;
  readonly fileExists?: ((path: string) => boolean) | undefined;
  readonly readFile?: ((path: string) => string | undefined) | undefined;
  readonly commandExists?: ((command: string) => boolean) | undefined;
  readonly runCommand?: ((command: string, args: readonly string[]) => DevToolCommandResult) | undefined;
  readonly minimumMajorVersion?: number | undefined;
}

const defaultMinimumMajorVersion = 1;

export class OpenCodeSetupAdapter implements DevToolSetupAdapter {
  private readonly command: string;
  private readonly dependencies: DevToolSetupAdapterDependencies;
  private readonly minimumMajorVersion: number;
  private detection: DevToolDetectionResult | undefined;

  constructor(options: OpenCodeSetupAdapterOptions) {
    const env = options.env ?? process.env;
    this.command = firstNonEmpty(options.command, env.OPENCODE_COMMAND, options.configCommand, 'opencode');
    this.minimumMajorVersion = options.minimumMajorVersion ?? defaultMinimumMajorVersion;
    this.dependencies = {
      env,
      homeDirectory: options.homeDirectory ?? homedir(),
      workspaceRoot: options.workspaceRoot,
      fileExists: options.fileExists ?? defaultFileExists,
      readFile: options.readFile ?? defaultReadFile,
      commandExists: options.commandExists ?? defaultCommandExists,
      runCommand: options.runCommand
    };
  }

  detect(): DevToolDetectionResult {
    if (this.detection !== undefined) {
      return this.detection;
    }

    this.detection = this.detectOnce();
    return this.detection;
  }

  doctor(): readonly DevToolDoctorCheck[] {
    const detection = this.detect();
    const label = 'OpenCode';

    if (detection.state === 'installed_ready') {
      return [{ status: 'pass', label, message: `${detection.command} is installed, authenticated, and has model configuration.` }];
    }

    if (detection.state === 'installed_not_authenticated') {
      return [{ status: 'warn', label, message: `${detection.command} is installed but OpenCode authentication was not detected.`, nextStep: 'Authenticate with OpenCode outside Ewokbot before running real development work.' }];
    }

    if (detection.state === 'installed_authenticated_no_model') {
      return [{ status: 'warn', label, message: `${detection.command} is authenticated but no OpenCode model configuration was detected.`, nextStep: 'Configure a default OpenCode model outside Ewokbot before running real development work.' }];
    }

    if (detection.state === 'installed_unsupported') {
      return [{ status: 'fail', label, message: `${detection.command} reported an unsupported OpenCode version.`, nextStep: 'Upgrade OpenCode before selecting it as the development runner.' }];
    }

    if (detection.state === 'command_failed') {
      return [{ status: 'fail', label, message: `${detection.command} failed during OpenCode readiness detection.`, nextStep: 'Run OpenCode manually and fix the command before selecting it as the development runner.' }];
    }

    return [{ status: 'fail', label, message: `${detection.command} was not found by the local command check.`, nextStep: 'Install OpenCode or set OPENCODE_COMMAND to an installed command.' }];
  }

  launchSetup(options: { readonly confirmed?: boolean | undefined } = {}): DevToolLaunchSetupResult {
    const detection = this.detect();
    const actions = this.actionsForState(detection.state);

    if (actions.length === 0) {
      return { actions, invoked: false, message: 'OpenCode is already ready; no setup action is required.' };
    }

    if (options.confirmed !== true) {
      return { actions, invoked: false, message: 'OpenCode setup actions require explicit operator confirmation and were not invoked.' };
    }

    return { actions, invoked: false, message: 'OpenCode setup actions are returned for the operator; Ewokbot does not run installers or auth flows in this milestone.' };
  }

  getConfigSummary(): DevToolConfigSummary {
    const detection = this.detect();
    const configFilesPresent = [
      detection.globalConfigPresent ? detection.globalConfigPath : undefined,
      detection.projectConfigPresent ? detection.projectConfigPath : undefined
    ].filter((path): path is string => path !== undefined);

    return {
      tool: detection.tool,
      command: detection.command,
      state: detection.state,
      configFilesPresent,
      authConfigured: detection.authPresent || detection.authListAuthenticated,
      modelConfigured: detection.modelConfigured
    };
  }

  private detectOnce(): DevToolDetectionResult {
    const globalConfigPath = join(this.dependencies.homeDirectory, '.config', 'opencode', 'opencode.json');
    const authPath = join(this.dependencies.homeDirectory, '.local', 'share', 'opencode', 'auth.json');
    const projectConfigPath = join(this.dependencies.workspaceRoot, 'opencode.json');
    const globalConfigPresent = this.dependencies.fileExists(globalConfigPath);
    const projectConfigPresent = this.dependencies.fileExists(projectConfigPath);
    const authPresent = this.dependencies.fileExists(authPath);
    const base = {
      tool: 'opencode',
      command: this.command,
      globalConfigPath,
      globalConfigPresent,
      projectConfigPath,
      projectConfigPresent,
      authPath,
      authPresent
    };

    if (!this.dependencies.commandExists(this.command)) {
      return {
        ...base,
        state: 'not_installed',
        authListChecked: false,
        authListAuthenticated: false,
        modelConfigured: false,
        details: [`${this.command} was not found.`],
        nextSteps: ['Install OpenCode or set OPENCODE_COMMAND to an installed command.']
      };
    }

    const versionResult = this.safeRun(['--version']);

    if (versionResult.kind === 'failed') {
      return {
        ...base,
        state: 'command_failed',
        authListChecked: false,
        authListAuthenticated: false,
        modelConfigured: false,
        details: ['OpenCode version detection failed.'],
        nextSteps: ['Run OpenCode manually and fix the command before selecting it as the development runner.']
      };
    }

    if (versionResult.kind === 'unavailable') {
      const modelConfigured = this.hasModelConfiguration(globalConfigPath) || this.hasModelConfiguration(projectConfigPath);
      const state = resolveInstalledState(authPresent, modelConfigured);
      return {
        ...base,
        state,
        authListChecked: false,
        authListAuthenticated: false,
        modelConfigured,
        details: buildDetails({ globalConfigPresent, projectConfigPresent, authPresent, authListAuthenticated: false, modelConfigured }),
        nextSteps: buildNextSteps(state)
      };
    }

    const version = extractVersion(versionResult.result.stdout, versionResult.result.stderr);
    const majorVersion = version === undefined ? undefined : parseMajorVersion(version);

    if (majorVersion === undefined || majorVersion < this.minimumMajorVersion) {
      return {
        ...base,
        state: 'installed_unsupported',
        version,
        authListChecked: false,
        authListAuthenticated: false,
        modelConfigured: false,
        details: ['OpenCode version is missing or unsupported.'],
        nextSteps: ['Upgrade OpenCode before selecting it as the development runner.']
      };
    }

    const authListResult = this.safeRun(['auth', 'list']);
    const authListChecked = authListResult.kind !== 'unavailable';
    const authListAuthenticated = authListResult.kind === 'ok' && authListResult.result.exitCode === 0;
    const modelConfigured = this.hasModelConfiguration(globalConfigPath) || this.hasModelConfiguration(projectConfigPath);
    const authenticated = authPresent || authListAuthenticated;
    const state = resolveInstalledState(authenticated, modelConfigured);

    return {
      ...base,
      state,
      version,
      authListChecked,
      authListAuthenticated,
      modelConfigured,
      details: buildDetails({ globalConfigPresent, projectConfigPresent, authPresent, authListAuthenticated, modelConfigured }),
      nextSteps: buildNextSteps(state)
    };
  }

  private hasModelConfiguration(path: string): boolean {
    const source = this.dependencies.readFile(path);

    if (source === undefined) {
      return false;
    }

    try {
      const parsed = JSON.parse(source) as unknown;
      return containsModelConfiguration(parsed);
    } catch {
      return /"(?:model|provider)"\s*:/u.test(source);
    }
  }

  private safeRun(args: readonly string[]): { readonly kind: 'ok'; readonly result: DevToolCommandResult } | { readonly kind: 'failed' } | { readonly kind: 'unavailable' } {
    const runner = this.dependencies.runCommand;

    if (runner === undefined) {
      return { kind: 'unavailable' };
    }

    try {
      const result = runner(this.command, args);
      return result.exitCode === 0 ? { kind: 'ok', result } : { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }

  private actionsForState(state: DevToolReadinessState) {
    if (state === 'not_installed') {
      return [{ kind: 'install' as const, label: 'Install OpenCode manually', command: 'Visit https://opencode.ai/docs for installation instructions.', requiresExplicitConfirmation: true }];
    }

    if (state === 'installed_not_authenticated') {
      return [{ kind: 'authenticate' as const, label: 'Authenticate OpenCode manually', command: 'opencode auth login', requiresExplicitConfirmation: true }];
    }

    if (state === 'installed_authenticated_no_model') {
      return [{ kind: 'configure_model' as const, label: 'Configure OpenCode model manually', requiresExplicitConfirmation: true }];
    }

    return [];
  }
}

function resolveInstalledState(authenticated: boolean, modelConfigured: boolean): DevToolReadinessState {
  if (!authenticated) {
    return 'installed_not_authenticated';
  }

  return modelConfigured ? 'installed_ready' : 'installed_authenticated_no_model';
}

function buildDetails(input: {
  readonly globalConfigPresent: boolean;
  readonly projectConfigPresent: boolean;
  readonly authPresent: boolean;
  readonly authListAuthenticated: boolean;
  readonly modelConfigured: boolean;
}): readonly string[] {
  return [
    input.globalConfigPresent ? 'Global OpenCode config is present.' : 'Global OpenCode config was not found.',
    input.projectConfigPresent ? 'Project OpenCode config is present.' : 'Project OpenCode config was not found.',
    input.authPresent || input.authListAuthenticated ? 'OpenCode authentication was detected without reading secrets.' : 'OpenCode authentication was not detected.',
    input.modelConfigured ? 'OpenCode model configuration was detected without exposing values.' : 'OpenCode model configuration was not detected.'
  ];
}

function buildNextSteps(state: DevToolReadinessState): readonly string[] {
  if (state === 'installed_not_authenticated') {
    return ['Authenticate with OpenCode outside Ewokbot before running real development work.'];
  }

  if (state === 'installed_authenticated_no_model') {
    return ['Configure a default OpenCode model outside Ewokbot before running real development work.'];
  }

  if (state === 'installed_ready') {
    return [];
  }

  return ['Fix OpenCode readiness before selecting it as the development runner.'];
}

function containsModelConfiguration(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsModelConfiguration);
  }

  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey === 'model' || normalizedKey === 'provider') && typeof nested === 'string' && nested.trim().length > 0) {
      return true;
    }

    return containsModelConfiguration(nested);
  });
}

function extractVersion(stdout: string, stderr: string): string | undefined {
  const source = `${stdout}\n${stderr}`;
  return /(?:opencode\s+)?(\d+\.\d+\.\d+)/iu.exec(source)?.[1];
}

function parseMajorVersion(version: string): number | undefined {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isInteger(major) ? major : undefined;
}

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }

  return 'opencode';
}

function defaultFileExists(path: string): boolean {
  return existsSync(path);
}

function defaultReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function defaultCommandExists(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command);
  }

  return (process.env.PATH ?? '').split(delimiter).some((directory) => directory.length > 0 && existsSync(join(directory, command)));
}

export function runOpenCodeReadinessCommand(command: string, args: readonly string[]): DevToolCommandResult {
  try {
    const stdout = execFileSync(command, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch {
    return { exitCode: 1, stdout: '', stderr: '' };
  }
}
