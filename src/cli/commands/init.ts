import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createOnboardingFiles, defaultSetupSelections, type DeploymentMonitorSelection, type SetupSelections } from '../../setup/index.js';
import { ewokbotCacheDirectory, ewokbotEnvExamplePath, ewokbotLogsDirectory, ewokbotRunsDirectory, ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO } from '../program.js';

export interface InitCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly args?: readonly string[];
  readonly prompter?: InitPrompter;
}

export type InitPrompter = (defaults: SetupSelections) => Promise<SetupSelections>;

class InitArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitArgumentError';
  }
}

export async function runInitCommand(options: InitCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const targetPath = join(cwd, ewokbotWorkspaceConfigPath);
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

  if (existsSync(targetPath)) {
    options.io.stderr(`Refusing to overwrite existing ${targetPath}\n`);
    return 1;
  }

  const files = createOnboardingFiles(selections);

  mkdirSync(dirname(targetPath), { recursive: true });
  mkdirSync(join(cwd, ewokbotRunsDirectory), { recursive: true });
  mkdirSync(join(cwd, ewokbotLogsDirectory), { recursive: true });
  mkdirSync(join(cwd, ewokbotCacheDirectory), { recursive: true });
  writeFileSync(targetPath, files.workspaceYaml, 'utf8');
  writeFileSync(envExamplePath, files.envExample, 'utf8');

  options.io.stdout(`Created ${targetPath}\n`);
  options.io.stdout(`Created ${envExamplePath}\n`);
  options.io.stdout(`Created ${join(cwd, ewokbotRunsDirectory)}\n`);
  options.io.stdout(`Created ${join(cwd, ewokbotLogsDirectory)}\n`);
  options.io.stdout(`Created ${join(cwd, ewokbotCacheDirectory)}\n`);
  options.io.stdout(`Mock mode remains the default. Fill ${ewokbotEnvExamplePath} placeholders before enabling live providers.\n`);
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

    if (arg === '--deployment-monitor') {
      const value = args[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw new InitArgumentError('Missing value for --deployment-monitor. Use one of: railway, vercel, both.');
      }

      deploymentMonitor = parseDeploymentMonitor(value);
      index += 1;
    }
  }

  return { nonInteractive, selections: { deploymentMonitor, includeOhMyOpenAgent } };
}

function parseDeploymentMonitor(value: string | undefined): DeploymentMonitorSelection {
  if (value === 'railway' || value === 'vercel' || value === 'both') {
    return value;
  }

  throw new InitArgumentError(`Invalid --deployment-monitor value "${value ?? ''}". Use one of: railway, vercel, both.`);
}

async function promptForSelections(defaults: SetupSelections): Promise<SetupSelections> {
  const readline = createInterface({ input, output });

  try {
    const deploymentAnswer = await readline.question('Deployment/CI monitor (railway, vercel, both) [railway]: ');
    const optionalAnswer = await readline.question('Include oh-my-openagent setup notes? (y/N): ');

    return {
      deploymentMonitor: parseDeploymentMonitor(deploymentAnswer.trim() || defaults.deploymentMonitor),
      includeOhMyOpenAgent: optionalAnswer.trim().toLowerCase() === 'y' || optionalAnswer.trim().toLowerCase() === 'yes'
    };
  } finally {
    readline.close();
  }
}
