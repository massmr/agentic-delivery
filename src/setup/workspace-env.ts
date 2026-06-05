import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ewokbotEnvPath } from '../workspace-layout.js';

export type WorkspaceEnvironment = Readonly<Record<string, string | undefined>>;

export interface LoadWorkspaceEnvironmentOptions {
  readonly baseEnv?: WorkspaceEnvironment | undefined;
  readonly readFile?: ((path: string) => string | undefined) | undefined;
  readonly fileExists?: ((path: string) => boolean) | undefined;
}

export function loadWorkspaceEnvironment(cwd: string, options: LoadWorkspaceEnvironmentOptions = {}): WorkspaceEnvironment {
  const baseEnv = options.baseEnv ?? process.env;
  const envPath = join(cwd, ewokbotEnvPath);
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? defaultReadFile;

  if (!fileExists(envPath)) {
    return { ...baseEnv };
  }

  return { ...baseEnv, ...parseWorkspaceEnv(readFile(envPath) ?? '') };
}

export function parseWorkspaceEnv(source: string): WorkspaceEnvironment {
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = normalized.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    const name = normalized.slice(0, separator).trim();
    const rawValue = normalized.slice(separator + 1).trim();

    if (!/^[_A-Z][_A-Z0-9]*$/iu.test(name)) {
      continue;
    }

    values[name] = unquoteEnvValue(rawValue);
  }

  return values;
}

function defaultReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
