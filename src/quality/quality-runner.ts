import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { QualityGateDefinition, QualityGateResult, QualityReport } from '../domain/quality.js';

export interface QualityRunnerOptions {
  readonly logRootPath: string;
  readonly now?: () => Date;
}

export class QualityRunner {
  private readonly now: () => Date;

  constructor(private readonly options: QualityRunnerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async run(gates: readonly QualityGateDefinition[]): Promise<QualityReport> {
    const required: QualityGateResult[] = [];
    const optional: QualityGateResult[] = [];

    for (const gate of gates) {
      const result = await this.runGate(gate);

      if (gate.requirement === 'required') {
        required.push(result);

        if (result.status === 'failed') {
          return { status: 'failed', required, optional };
        }
      } else {
        optional.push(result);
      }
    }

    return {
      status: required.some((result) => result.status === 'failed') ? 'failed' : 'passed',
      required,
      optional
    };
  }

  private async runGate(gate: QualityGateDefinition): Promise<QualityGateResult> {
    const startedAtDate = this.now();
    const startedAt = startedAtDate.toISOString();
    const stdoutLogPath = join(this.options.logRootPath, `${gate.name}.stdout.log`);
    const stderrLogPath = join(this.options.logRootPath, `${gate.name}.stderr.log`);
    const command = gate.command;

    if (command === undefined) {
      const finishedAtDate = this.now();
      const finishedAt = finishedAtDate.toISOString();
      const summary = `${gate.name} skipped: optional gate has no command configured.`;

      await mkdir(dirname(stdoutLogPath), { recursive: true });
      await writeFile(stdoutLogPath, '', 'utf8');
      await writeFile(stderrLogPath, `${summary}\n`, 'utf8');

      return {
        name: gate.name,
        workingDirectory: gate.workingDirectory,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
        exitCode: null,
        stdoutLogPath,
        stderrLogPath,
        status: 'skipped',
        summary
      };
    }

    const execution = await executeCommand(command, gate.workingDirectory);
    const finishedAtDate = this.now();
    const finishedAt = finishedAtDate.toISOString();

    await mkdir(dirname(stdoutLogPath), { recursive: true });
    await writeFile(stdoutLogPath, execution.stdout, 'utf8');
    await writeFile(stderrLogPath, execution.stderr, 'utf8');

    return {
      name: gate.name,
      command,
      workingDirectory: gate.workingDirectory,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
      exitCode: execution.exitCode,
      stdoutLogPath,
      stderrLogPath,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      summary: execution.exitCode === 0 ? `${gate.name} passed.` : `${gate.name} failed with exit code ${execution.exitCode}.`
    };
  }
}

function executeCommand(command: string, cwd: string): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ stdout, stderr: `${stderr}${error.message}\n`, exitCode: 1 });
    });
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}
