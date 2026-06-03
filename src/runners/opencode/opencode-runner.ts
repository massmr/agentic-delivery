import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DevRunAttemptResult, DevRunInput, DevRunResult, DevRunStatus, DevRunner } from '../../domain/index.js';

export interface OpenCodeSubprocessRunnerOptions {
  readonly now?: () => Date;
}

interface CommandExecution {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export class OpenCodeSubprocessRunner implements DevRunner {
  private readonly now: () => Date;

  constructor(options: OpenCodeSubprocessRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async run(input: DevRunInput): Promise<DevRunResult> {
    const startedAtDate = this.now();
    const startedAt = startedAtDate.toISOString();
    const attempts: DevRunAttemptResult[] = [];
    const maxAttempts = Math.max(1, input.maxAttempts);

    await mkdir(dirname(input.implementationLogPath), { recursive: true });
    await writeFile(input.implementationLogPath, renderLogHeader(input), 'utf8');

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAtDate = this.now();
      const attemptStartedAt = attemptStartedAtDate.toISOString();
      const execution = await executeCommand(input.command, input.workingDirectory, input.prompt);
      const attemptFinishedAtDate = this.now();
      const attemptFinishedAt = attemptFinishedAtDate.toISOString();
      const status: DevRunStatus = execution.exitCode === 0 ? 'passed' : 'failed';
      const attemptResult: DevRunAttemptResult = {
        attempt,
        command: input.command,
        workingDirectory: input.workingDirectory,
        startedAt: attemptStartedAt,
        finishedAt: attemptFinishedAt,
        durationMs: Math.max(0, attemptFinishedAtDate.getTime() - attemptStartedAtDate.getTime()),
        exitCode: execution.exitCode,
        status,
        summary: status === 'passed' ? `Attempt ${attempt} passed.` : `Attempt ${attempt} failed with exit code ${execution.exitCode}.`
      };

      attempts.push(attemptResult);
      await appendFile(input.implementationLogPath, renderAttemptLog(attemptResult, execution), 'utf8');

      if (status === 'passed') {
        break;
      }
    }

    const finishedAtDate = this.now();
    const finishedAt = finishedAtDate.toISOString();
    const status: DevRunStatus = attempts.some((attempt) => attempt.status === 'passed') ? 'passed' : 'failed';
    const lastAttempt = attempts[attempts.length - 1];

    return {
      provider: 'opencode',
      ticketKey: input.ticketKey,
      runId: input.runId,
      repository: input.repository,
      branchName: input.branchName,
      baseBranch: input.baseBranch,
      command: input.command,
      workingDirectory: input.workingDirectory,
      implementationLogPath: input.implementationLogPath,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
      attempts,
      status,
      summary:
        status === 'passed'
          ? `OpenCode implementation passed after ${attempts.length} attempt(s).`
          : `OpenCode implementation failed after ${attempts.length} attempt(s); last exit code ${lastAttempt?.exitCode ?? 'unknown'}.`
    };
  }
}

function executeCommand(command: string, cwd: string, prompt: string): Promise<CommandExecution> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
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
    child.stdin.end(prompt);
  });
}

function renderLogHeader(input: DevRunInput): string {
  return [
    `# Implementation Log ${input.ticketKey}`,
    '',
    `- Run ID: ${input.runId}`,
    `- Repository: ${input.repository.owner}/${input.repository.name}`,
    `- Branch: ${input.branchName}`,
    `- Base branch: ${input.baseBranch}`,
    `- Working directory: ${input.workingDirectory}`,
    `- Command: ${input.command}`,
    ''
  ].join('\n');
}

function renderAttemptLog(attempt: DevRunAttemptResult, execution: CommandExecution): string {
  return [
    `## Attempt ${attempt.attempt}`,
    '',
    `- Status: ${attempt.status.toUpperCase()}`,
    `- Started at: ${attempt.startedAt}`,
    `- Finished at: ${attempt.finishedAt}`,
    `- Duration ms: ${attempt.durationMs}`,
    `- Exit code: ${attempt.exitCode ?? 'null'}`,
    '',
    '### Stdout',
    '```text',
    execution.stdout,
    '```',
    '',
    '### Stderr',
    '```text',
    execution.stderr,
    '```',
    ''
  ].join('\n');
}
