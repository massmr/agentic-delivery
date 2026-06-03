import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CliProgramIO } from '../program.js';

const BUNDLED_EXAMPLE_CONFIG = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../config/workspace.example.yml');

export interface InitCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly templatePath?: string;
}

export function runInitCommand(options: InitCommandOptions): number {
  const cwd = options.cwd ?? process.cwd();
  const targetPath = join(cwd, 'config', 'workspace.yml');

  if (existsSync(targetPath)) {
    options.io.stderr(`Refusing to overwrite existing ${targetPath}\n`);
    return 1;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(options.templatePath ?? BUNDLED_EXAMPLE_CONFIG, targetPath);

  options.io.stdout(`Created ${targetPath}\n`);
  return 0;
}
