import { runLocalDoctor } from '../../setup/index.js';
import type { CliProgramIO } from '../program.js';

export interface DoctorCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
}

export function runDoctorCommand(options: DoctorCommandOptions): number {
  const report = runLocalDoctor(options.cwd ?? process.cwd());

  for (const line of report.lines) {
    options.io.stdout(`${line}\n`);
  }

  for (const issue of report.issues) {
    options.io.stdout(`${issue.severity.toUpperCase()}: ${issue.message}\n`);
  }

  return report.ok ? 0 : 1;
}
