import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { parseDocument } from 'yaml';

import { WorkspaceConfigError, parseWorkspaceConfig, type ProviderMode, type WorkspaceConfig, type WorkspaceRepositoryConfig } from '../config/index.js';
import { parseRepositoryQualityConfig } from '../quality/index.js';
import {
  getRequiredEnvPlaceholders,
  getSetupCapabilitiesForSelections,
  type DeploymentMonitorSelection,
  type SetupGeneratedConfigMetadata,
  type SetupSelections
} from './provider-capability.js';
import { ewokbotEnvExamplePath, ewokbotEnvPath, ewokbotWorkspaceConfigPath } from '../workspace-layout.js';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly status: DoctorCheckStatus;
  readonly label: string;
  readonly message: string;
  readonly nextStep?: string | undefined;
}

export interface DoctorIssue {
  readonly severity: 'fail' | 'warn';
  readonly message: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly checks: readonly DoctorCheck[];
  readonly issues: readonly DoctorIssue[];
}

export interface DoctorProbeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly nodeVersion?: string;
  readonly fileExists?: (path: string) => boolean;
  readonly directoryExists?: (path: string) => boolean;
  readonly readFile?: (path: string) => string | undefined;
  readonly commandExists?: (command: string) => boolean;
}

interface DoctorProbeSet {
  readonly env: NodeJS.ProcessEnv;
  readonly nodeVersion: string;
  readonly fileExists: (path: string) => boolean;
  readonly directoryExists: (path: string) => boolean;
  readonly readFile: (path: string) => string | undefined;
  readonly commandExists: (command: string) => boolean;
}

type EnvValueMap = ReadonlyMap<string, string>;

const localOnlyLine = 'Doctor checked local files only; no provider, MCP, installer, or network calls were made.';
const minimumNodeMajor = 20;

export function runLocalDoctor(cwd: string, options: DoctorProbeOptions = {}): DoctorReport {
  const probes = createProbeSet(options);
  const configPath = join(cwd, ewokbotWorkspaceConfigPath);
  const envExamplePath = join(cwd, ewokbotEnvExamplePath);
  const envPath = join(cwd, ewokbotEnvPath);
  const lines = [localOnlyLine];
  const checks: DoctorCheck[] = [];

  if (!probes.fileExists(configPath)) {
    checks.push(failCheck('Workspace config', `Missing ${ewokbotWorkspaceConfigPath}. Run ewokbot init to create local setup files.`, 'Run ewokbot init.'));
    return buildReport(lines, checks);
  }

  const configYaml = probes.readFile(configPath);

  if (configYaml === undefined) {
    checks.push(failCheck('Workspace config', `Unable to read ${ewokbotWorkspaceConfigPath}.`, 'Check file permissions and rerun ewokbot doctor.'));
    return buildReport(lines, checks);
  }

  const metadata = readSetupMetadata(configYaml);
  const selections = readSetupSelections(metadata);
  let config: WorkspaceConfig;

  try {
    config = parseWorkspaceConfig(configYaml, { workspaceRoot: cwd });
    lines.push(`${ewokbotWorkspaceConfigPath} is valid.`);
    checks.push(passCheck('Workspace config', `${ewokbotWorkspaceConfigPath} parses and matches the local schema.`));

    for (const capability of getSetupCapabilitiesForSelections(selections)) {
      const validation = capability.validateGeneratedConfig(config, metadata);

      for (const issue of validation.issues) {
        checks.push(failCheck(capability.label, issue, `Update ${ewokbotWorkspaceConfigPath} or rerun ewokbot init.`));
      }
    }
  } catch (error) {
    const message = error instanceof WorkspaceConfigError ? error.message : String(error);
    checks.push(failCheck('Workspace config', `Invalid ${ewokbotWorkspaceConfigPath}: ${message}`, `Fix ${ewokbotWorkspaceConfigPath} before running worker commands.`));
    return buildReport(lines, checks);
  }

  lines.push(`Deployment monitors: ${selectedDeploymentMonitors(selections.deploymentMonitor).join(', ')}`);
  checks.push(...checkTools(config, metadata, cwd, probes));
  checks.push(...checkEnvExample(envExamplePath, selections, probes));

  const envFile = readEnvFile(envPath, probes);
  checks.push(checkEnvFile(envFile));
  checks.push(...checkProviderReadiness(config, selections, envFile.values, probes.env));
  checks.push(...checkBranchPolicy(config));
  checks.push(...checkRepositoryReadiness(cwd, config, probes));

  return buildReport(lines, checks);
}

function createProbeSet(options: DoctorProbeOptions): DoctorProbeSet {
  return {
    env: options.env ?? process.env,
    nodeVersion: options.nodeVersion ?? process.version,
    fileExists: options.fileExists ?? defaultFileExists,
    directoryExists: options.directoryExists ?? defaultDirectoryExists,
    readFile: options.readFile ?? defaultReadFile,
    commandExists: options.commandExists ?? defaultCommandExists
  };
}

function defaultFileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function defaultDirectoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
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

function defaultCommandExists(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command);
  }

  const pathValue = process.env.PATH ?? '';
  return pathValue.split(delimiter).some((pathEntry) => pathEntry.trim().length > 0 && existsSync(join(pathEntry, command)));
}

function buildReport(lines: readonly string[], checks: readonly DoctorCheck[]): DoctorReport {
  const issues = checks
    .flatMap((check): readonly DoctorIssue[] => check.status === 'pass' ? [] : [{ severity: check.status, message: `${check.label}: ${check.message}` }]);

  return { ok: checks.every((check) => check.status !== 'fail'), lines, checks, issues };
}

function checkTools(config: WorkspaceConfig, metadata: SetupGeneratedConfigMetadata, cwd: string, probes: DoctorProbeSet): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const nodeMajor = parseNodeMajor(probes.nodeVersion);

  if (nodeMajor === undefined || nodeMajor < minimumNodeMajor) {
    checks.push(failCheck('Node.js', `Node.js ${minimumNodeMajor}+ is required; detected ${probes.nodeVersion}.`, 'Install Node.js 20 or newer.'));
  } else {
    checks.push(passCheck('Node.js', `Detected Node.js ${probes.nodeVersion}.`));
  }

  if (probes.commandExists('pnpm')) {
    checks.push(passCheck('pnpm', 'pnpm is available from the local command check.'));
  } else {
    checks.push(failCheck('pnpm', 'pnpm was not found by the local command check.', 'Install pnpm before running worker or quality commands.'));
  }

  const opencodeCommand = probes.env.OPENCODE_COMMAND?.trim() || config.devRunner.command;

  if (probes.commandExists(opencodeCommand)) {
    checks.push(passCheck('OpenCode', `${opencodeCommand} is available from the local command check.`));
  } else {
    checks.push(failCheck('OpenCode', `${opencodeCommand} was not found by the local command check.`, 'Install OpenCode or set OPENCODE_COMMAND.'));
  }

  const optionalTools = metadata.optionalTools ?? [];

  if (!optionalTools.includes('oh-my-openagent')) {
    checks.push(passCheck('oh-my-openagent', 'Optional oh-my-openagent setup was not selected.'));
  } else if (ohMyOpenAgentConfigured(cwd, probes)) {
    checks.push(passCheck('oh-my-openagent', 'Found a local oh-my-openagent config marker.'));
  } else {
    checks.push(warnCheck('oh-my-openagent', 'Optional oh-my-openagent was selected but no local config marker was found.', 'Add .oh-my-openagent.yml or rerun ewokbot init without the optional tool.'));
  }

  return checks;
}

function checkEnvExample(envExamplePath: string, selections: SetupSelections, probes: DoctorProbeSet): readonly DoctorCheck[] {
  if (!probes.fileExists(envExamplePath)) {
    return [failCheck(ewokbotEnvExamplePath, `Missing ${ewokbotEnvExamplePath} with required secret placeholders.`, `Run ewokbot init or restore ${ewokbotEnvExamplePath}.`)];
  }

  const envExample = probes.readFile(envExamplePath) ?? '';
  const missing = getRequiredEnvPlaceholders(selections).filter((placeholder) => !new RegExp(`^${escapeRegex(placeholder)}=`, 'mu').test(envExample));

  if (missing.length > 0) {
    return missing.map((placeholder) => failCheck(ewokbotEnvExamplePath, `Missing ${ewokbotEnvExamplePath} placeholder: ${placeholder}`, 'Add the empty placeholder without storing a real secret.'));
  }

  return [passCheck(ewokbotEnvExamplePath, 'Required secret placeholders are present and values are not inspected.')];
}

function readEnvFile(envPath: string, probes: DoctorProbeSet): { readonly exists: boolean; readonly values: EnvValueMap } {
  if (!probes.fileExists(envPath)) {
    return { exists: false, values: new Map() };
  }

  return { exists: true, values: parseEnvFile(probes.readFile(envPath) ?? '') };
}

function checkEnvFile(envFile: { readonly exists: boolean; readonly values: EnvValueMap }): DoctorCheck {
  if (!envFile.exists) {
    return warnCheck(ewokbotEnvPath, `No ${ewokbotEnvPath} file found; mock mode can run, but real provider readiness needs local secret keys.`, `Create ${ewokbotEnvPath} from ${ewokbotEnvExamplePath} when leaving mock mode.`);
  }

  return passCheck(ewokbotEnvPath, `${ewokbotEnvPath} is present; values are treated as [redacted].`);
}

function checkProviderReadiness(config: WorkspaceConfig, selections: SetupSelections, envFileValues: EnvValueMap, processEnv: NodeJS.ProcessEnv): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(checkProviderEnv('GitHub', config.github.mode, ['GITHUB_ORG', 'GITHUB_TOKEN'], envFileValues, processEnv));
  checks.push(checkProviderEnv('Jira', config.jira.mode, ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'], envFileValues, processEnv));

  if (selections.deploymentMonitor === 'railway' || selections.deploymentMonitor === 'both') {
    checks.push(checkProviderEnv('Railway', config.railway.mode, ['RAILWAY_TOKEN'], envFileValues, processEnv));
  }

  if (selections.deploymentMonitor === 'vercel' || selections.deploymentMonitor === 'both') {
    checks.push(checkProviderEnv('Vercel', 'mock', ['VERCEL_TOKEN'], envFileValues, processEnv));
  }

  return checks;
}

function checkProviderEnv(label: string, mode: ProviderMode | 'mcp', names: readonly string[], envFileValues: EnvValueMap, processEnv: NodeJS.ProcessEnv): DoctorCheck {
  const missing = names.filter((name) => !hasEnvName(name, envFileValues, processEnv));

  if (missing.length === 0) {
    return passCheck(label, `${names.join(', ')} are present; values are [redacted].`);
  }

  const message = `Missing ${missing.join(', ')} for ${label} ${mode} mode.`;

  if (mode === 'mock') {
    return warnCheck(label, `${message} Mock mode remains safe without these keys.`, `Add ${missing.join(', ')} before leaving mock mode.`);
  }

  return failCheck(label, message, `Add ${missing.join(', ')} before using ${label} ${mode} mode.`);
}

function checkBranchPolicy(config: WorkspaceConfig): readonly DoctorCheck[] {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (config.workspace.stagingBranch === config.workspace.productionBranch) {
    failures.push(`workspace staging and production branches both resolve to ${config.workspace.productionBranch}.`);
  }

  if (config.railway.stagingBranch === config.railway.productionBranch) {
    failures.push(`Railway staging and production branches both resolve to ${config.railway.productionBranch}.`);
  }

  for (const repo of config.repos) {
    if (repo.defaultBranch === repo.productionBranch) {
      failures.push(`${repo.name} default_branch and production_branch both resolve to ${repo.productionBranch}.`);
    }

    if (repo.defaultBranch !== config.workspace.stagingBranch) {
      warnings.push(`${repo.name} default_branch ${repo.defaultBranch} differs from workspace staging_branch ${config.workspace.stagingBranch}.`);
    }

    if (repo.productionBranch !== config.workspace.productionBranch) {
      warnings.push(`${repo.name} production_branch ${repo.productionBranch} differs from workspace production_branch ${config.workspace.productionBranch}.`);
    }
  }

  if (failures.length > 0) {
    return [failCheck('Branch policy', failures.join(' '), 'Separate staging/default branches from production before running delivery.')];
  }

  if (warnings.length > 0) {
    return [warnCheck('Branch policy', warnings.join(' '), 'Confirm branch names match your workspace policy.')];
  }

  return [passCheck('Branch policy', 'Staging/default branches are separated from production branches.')];
}

function checkRepositoryReadiness(cwd: string, config: WorkspaceConfig, probes: DoctorProbeSet): readonly DoctorCheck[] {
  if (config.repositoryDiscovery !== undefined && config.repos.length === 0) {
    return [
      warnCheck(
        'Repository discovery',
        'No direct sibling Git repositories were found next to .ewokbot/.',
        'Create or clone repositories as direct children of the workspace root, or switch repos to explicit entries.'
      )
    ];
  }

  return config.repos.flatMap((repo) => {
    const repoPath = resolveLocalPath(cwd, repo.localPath);

    if (!probes.fileExists(repoPath) && !probes.directoryExists(repoPath)) {
      return [warnCheck(`Repository ${repo.name}`, `${repo.localPath} was not found locally.`, 'Clone the repository or update repos[].local_path.')];
    }

    if (!probes.directoryExists(repoPath)) {
      return [failCheck(`Repository ${repo.name}`, `${repo.localPath} exists but is not a directory.`, 'Update repos[].local_path to a local checkout directory.')];
    }

    return [
      passCheck(`Repository ${repo.name}`, `${repo.localPath} exists locally.`),
      checkQualityReadiness(repo, repoPath, probes)
    ];
  });
}

function checkQualityReadiness(repo: WorkspaceRepositoryConfig, repoPath: string, probes: DoctorProbeSet): DoctorCheck {
  const qualityConfigPath = join(repoPath, '.agent-quality.yml');

  if (probes.fileExists(qualityConfigPath)) {
    try {
      const qualityConfig = parseRepositoryQualityConfig(probes.readFile(qualityConfigPath) ?? '');
      const gateCount = qualityConfig.required.length + qualityConfig.optional.length;

      if (gateCount === 0) {
        return failCheck(`Quality ${repo.name}`, '.agent-quality.yml defines no quality gates.', 'Add at least one required or optional quality gate.');
      }

      return passCheck(`Quality ${repo.name}`, `.agent-quality.yml defines ${gateCount} static quality gate(s).`);
    } catch (error) {
      return failCheck(`Quality ${repo.name}`, `Invalid .agent-quality.yml: ${String(error instanceof Error ? error.message : error)}`, 'Fix .agent-quality.yml before running delivery.');
    }
  }

  const packageJsonPath = join(repoPath, 'package.json');

  if (!probes.fileExists(packageJsonPath)) {
    return failCheck(`Quality ${repo.name}`, 'No .agent-quality.yml or package.json quality scripts were found.', 'Add .agent-quality.yml or package.json scripts for lint/typecheck/test/build.');
  }

  try {
    const packageJson = JSON.parse(probes.readFile(packageJsonPath) ?? '{}') as { readonly scripts?: Record<string, string> };
    const scripts = packageJson.scripts ?? {};
    const gateNames = ['lint', 'typecheck', 'test', 'build'].filter((name) => typeof scripts[name] === 'string' && scripts[name].trim().length > 0);

    if (gateNames.length === 0) {
      return failCheck(`Quality ${repo.name}`, 'package.json has no lint, typecheck, test, or build scripts.', 'Add a static quality gate script.');
    }

    return passCheck(`Quality ${repo.name}`, `package.json exposes quality script(s): ${gateNames.join(', ')}.`);
  } catch (error) {
    return failCheck(`Quality ${repo.name}`, `Invalid package.json: ${String(error instanceof Error ? error.message : error)}`, 'Fix package.json before running delivery.');
  }
}

function readSetupMetadata(configYaml: string): SetupGeneratedConfigMetadata {
  const document = parseDocument(configYaml);
  const parsed = document.toJS() as { readonly setup?: { readonly deployment_monitors?: unknown; readonly optional_tools?: unknown; readonly control_plane?: unknown } } | null;
  const setup = parsed?.setup;

  if (setup === undefined) {
    return {};
  }

  return {
    deploymentMonitors: Array.isArray(setup.deployment_monitors) ? setup.deployment_monitors.map(String) : undefined,
    optionalTools: Array.isArray(setup.optional_tools) ? setup.optional_tools.map(String) : undefined,
    controlPlane: typeof setup.control_plane === 'string' ? setup.control_plane : undefined
  };
}

function readSetupSelections(metadata: SetupGeneratedConfigMetadata): SetupSelections {
  if (metadata.deploymentMonitors === undefined && metadata.optionalTools === undefined) {
    return { deploymentMonitor: 'railway', includeOhMyOpenAgent: false };
  }

  const monitors = metadata.deploymentMonitors ?? ['railway'];
  const optionalTools = metadata.optionalTools ?? [];

  return {
    deploymentMonitor: parseDeploymentMonitorSelection(monitors),
    includeOhMyOpenAgent: optionalTools.includes('oh-my-openagent')
  };
}

function parseDeploymentMonitorSelection(monitors: readonly string[]): DeploymentMonitorSelection {
  const hasRailway = monitors.includes('railway');
  const hasVercel = monitors.includes('vercel');

  if (hasRailway && hasVercel) {
    return 'both';
  }

  if (hasVercel) {
    return 'vercel';
  }

  return 'railway';
}

function selectedDeploymentMonitors(selection: DeploymentMonitorSelection): readonly string[] {
  if (selection === 'both') {
    return ['railway', 'vercel'];
  }

  return [selection];
}

function ohMyOpenAgentConfigured(cwd: string, probes: DoctorProbeSet): boolean {
  return ['.oh-my-openagent.yml', '.oh-my-openagent/config.yml', 'config/oh-my-openagent.yml']
    .some((marker) => probes.fileExists(join(cwd, marker)));
}

function parseNodeMajor(version: string): number | undefined {
  const match = /^v?(\d+)/u.exec(version.trim());
  return match === null ? undefined : Number.parseInt(match[1], 10);
}

function parseEnvFile(source: string): EnvValueMap {
  const values = new Map<string, string>();

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return values;
}

function hasEnvName(name: string, envFileValues: EnvValueMap, processEnv: NodeJS.ProcessEnv): boolean {
  return (envFileValues.get(name) ?? processEnv[name] ?? '').trim().length > 0;
}

function resolveLocalPath(cwd: string, localPath: string): string {
  return isAbsolute(localPath) ? localPath : resolve(cwd, localPath);
}

function passCheck(label: string, message: string): DoctorCheck {
  return { status: 'pass', label, message };
}

function warnCheck(label: string, message: string, nextStep?: string): DoctorCheck {
  return { status: 'warn', label, message, nextStep };
}

function failCheck(label: string, message: string, nextStep?: string): DoctorCheck {
  return { status: 'fail', label, message, nextStep };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
