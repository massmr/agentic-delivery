import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

import type { QualityGateDefinition, QualityGateRequirement } from '../domain/quality.js';

export interface RepositoryQualityConfig {
  readonly commands: Readonly<Record<string, string>>;
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

export async function loadRepositoryQualityConfig(repositoryPath: string): Promise<RepositoryQualityConfig> {
  const qualityConfigPath = join(repositoryPath, '.agent-quality.yml');

  if (await pathExists(qualityConfigPath)) {
    return parseRepositoryQualityConfig(await readFile(qualityConfigPath, 'utf8'));
  }

  return detectNodeQualityConfig(repositoryPath);
}

export function parseRepositoryQualityConfig(source: string): RepositoryQualityConfig {
  const document = parseDocument(source, { prettyErrors: false });

  if (document.errors.length > 0) {
    throw new Error(`Invalid .agent-quality.yml: ${document.errors.map((error) => error.message).join('; ')}`);
  }

  const input = document.toJS({}) as Record<string, unknown>;
  const commands = readCommandMap(input.commands);
  const required = readStringList(input.required, 'required');
  const optional = input.optional === undefined ? [] : readStringList(input.optional, 'optional');

  return { commands, required, optional };
}

export async function detectNodeQualityConfig(repositoryPath: string): Promise<RepositoryQualityConfig> {
  const packageJsonPath = join(repositoryPath, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const commands: Record<string, string> = {};
  const required: string[] = [];

  if (await pathExists(join(repositoryPath, 'pnpm-lock.yaml'))) {
    commands.install = 'pnpm install --frozen-lockfile';
    required.push('install');
  } else if (await pathExists(join(repositoryPath, 'package-lock.json'))) {
    commands.install = 'npm ci';
    required.push('install');
  }

  for (const gateName of ['lint', 'typecheck', 'test', 'build']) {
    if (scripts[gateName] !== undefined) {
      commands[gateName] = gateName === 'test' ? 'npm test' : `npm run ${gateName}`;
      required.push(gateName);
    }
  }

  return { commands, required, optional: [] };
}

export function buildQualityGateDefinitions(config: RepositoryQualityConfig, workingDirectory: string): readonly QualityGateDefinition[] {
  const required = config.required.map((name) => toGateDefinition(name, 'required', config, workingDirectory));
  const optional = config.optional.map((name) => toGateDefinition(name, 'optional', config, workingDirectory));

  return [...required, ...optional];
}

function toGateDefinition(
  name: string,
  requirement: QualityGateRequirement,
  config: RepositoryQualityConfig,
  workingDirectory: string
): QualityGateDefinition {
  const command = config.commands[name];

  if (command === undefined) {
    if (requirement === 'optional') {
      return {
        name,
        requirement,
        workingDirectory
      };
    }

    throw new Error(`Quality gate '${name}' is listed as ${requirement} but has no command.`);
  }

  return {
    name,
    command,
    requirement,
    workingDirectory
  };
}

function readCommandMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('.agent-quality.yml commands must be a mapping.');
  }

  const commands: Record<string, string> = {};

  for (const [key, command] of Object.entries(value)) {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error(`.agent-quality.yml command '${key}' must be a non-empty string.`);
    }

    commands[key] = command;
  }

  return commands;
}

function readStringList(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`.agent-quality.yml ${key} must be an array.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`.agent-quality.yml ${key}[${index}] must be a non-empty string.`);
    }

    return entry;
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
