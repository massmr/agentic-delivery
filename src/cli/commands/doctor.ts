import { runLocalDoctor } from '../../setup/index.js';
import type { DoctorProbeOptions } from '../../setup/index.js';
import type { CliProgramIO } from '../program.js';

export interface DoctorCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly doctorOptions?: DoctorProbeOptions | undefined;
}

export function runDoctorCommand(options: DoctorCommandOptions): number {
  const report = runLocalDoctor(options.cwd ?? process.cwd(), options.doctorOptions);

  for (const line of report.lines) {
    options.io.stdout(`${line}\n`);
  }

  for (const check of report.checks) {
    const nextStep = check.nextStep === undefined ? '' : ` Next step: ${check.nextStep}`;
    options.io.stdout(`${check.status.toUpperCase()}: ${check.label}: ${check.message}${nextStep}\n`);
  }

  return report.ok ? 0 : 1;
}
