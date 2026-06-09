import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import type { DevRunAttemptResult, DevRunInput, DevRunResult, DevRunStatus, DevRunner } from '../../domain/index.js';
import { redactCommand, redactSensitiveText } from './redaction.js';
import { nodeOpenCodeSubprocessExecutor } from './subprocess-executor.js';
import type { OpenCodeSubprocessExecutor, OpenCodeSubprocessExecutorResult } from './subprocess-executor.js';

export interface OpenCodeSubprocessRunnerOptions {
  readonly now?: () => Date;
  readonly executor?: OpenCodeSubprocessExecutor | undefined;
  readonly baseEnvironment?: Readonly<Record<string, string | undefined>> | undefined;
}

export class OpenCodeSubprocessRunner implements DevRunner {
  private readonly now: () => Date;
  private readonly executor: OpenCodeSubprocessExecutor;
  private readonly baseEnvironment: Readonly<Record<string, string | undefined>>;

  constructor(options: OpenCodeSubprocessRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.executor = options.executor ?? nodeOpenCodeSubprocessExecutor;
    this.baseEnvironment = options.baseEnvironment ?? process.env;
  }

  async run(input: DevRunInput): Promise<DevRunResult> {
    const executable = validateExecutable(input.command);
    const workingDirectory = validateWorkingDirectory(input.workingDirectory, input.workspaceRoot);
    const invocation = buildOpenCodeInvocation(workingDirectory, input.commandArgs ?? [], input.prompt);
    const env = buildAllowlistedEnvironment(this.baseEnvironment, input.environment, input.environmentAllowlist ?? []);
    const startedAtDate = this.now();
    const startedAt = startedAtDate.toISOString();
    const attempts: DevRunAttemptResult[] = [];
    const maxAttempts = Math.max(1, input.maxAttempts);

    await mkdir(dirname(input.implementationLogPath), { recursive: true });
    await writeFile(input.implementationLogPath, renderLogHeader(input, executable, invocation.loggedArgs, workingDirectory), 'utf8');

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAtDate = this.now();
      const attemptStartedAt = attemptStartedAtDate.toISOString();
      const execution = await this.executor({
        executable,
        args: invocation.executorArgs,
        cwd: workingDirectory,
        env,
        stdin: '',
        timeoutMs: input.timeoutMs,
        abortSignal: input.abortSignal
      });
      const attemptFinishedAtDate = this.now();
      const attemptFinishedAt = attemptFinishedAtDate.toISOString();
      const status = statusFromExecution(execution);
      const attemptResult: DevRunAttemptResult = {
        attempt,
        command: redactCommand(executable, invocation.loggedArgs),
        workingDirectory,
        startedAt: attemptStartedAt,
        finishedAt: attemptFinishedAt,
        durationMs: Math.max(0, attemptFinishedAtDate.getTime() - attemptStartedAtDate.getTime()),
        exitCode: execution.exitCode,
        signal: execution.signal,
        status,
        timedOut: execution.timedOut,
        cancelled: execution.cancelled,
        summary: summarizeAttempt(attempt, status, execution)
      };

      attempts.push(attemptResult);
      await appendFile(input.implementationLogPath, renderAttemptLog(attemptResult, execution), 'utf8');

      if (status === 'passed' || status === 'timed_out' || status === 'cancelled') {
        break;
      }
    }

    const finishedAtDate = this.now();
    const finishedAt = finishedAtDate.toISOString();
    const status = summarizeRunStatus(attempts);
    const lastAttempt = attempts[attempts.length - 1];

    return {
      provider: 'opencode',
      ticketKey: input.ticketKey,
      runId: input.runId,
      repository: input.repository,
      branchName: input.branchName,
      baseBranch: input.baseBranch,
      command: redactCommand(executable, invocation.loggedArgs),
      workingDirectory,
      implementationLogPath: input.implementationLogPath,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
      attempts,
      status,
      summary: summarizeRun(status, attempts.length, lastAttempt)
    };
  }
}

interface OpenCodeInvocation {
  readonly executorArgs: readonly string[];
  readonly loggedArgs: readonly string[];
}

function validateExecutable(command: string): string {
  const executable = command.trim();

  if (executable.length === 0) {
    throw new Error('OpenCode command executable must be a non-empty string.');
  }

  return executable;
}

function validateWorkingDirectory(workingDirectory: string, workspaceRoot: string | undefined): string {
  const resolvedWorkingDirectory = resolve(workingDirectory);

  if (workspaceRoot === undefined) {
    return resolvedWorkingDirectory;
  }

  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const relativePath = relative(resolvedWorkspaceRoot, resolvedWorkingDirectory);

  if (relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(`..${sep}`) && relativePath !== '..')) {
    return resolvedWorkingDirectory;
  }

  throw new Error(`OpenCode working directory must stay inside workspace root '${resolvedWorkspaceRoot}': ${resolvedWorkingDirectory}`);
}

function buildOpenCodeInvocation(workingDirectory: string, commandArgs: readonly string[], prompt: string): OpenCodeInvocation {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length === 0) {
    throw new Error('OpenCode prompt must be a non-empty string.');
  }

  const normalizedCommandArgs = [...commandArgs];
  const configuredExtraArgs = normalizedCommandArgs[0] === 'run'
    ? normalizedCommandArgs.slice(1)
    : normalizedCommandArgs;
  const extraArgs = ensureHeadlessPermissionArgs(configuredExtraArgs);
  const executorArgs = ['run', ...extraArgs, '--dir', workingDirectory, trimmedPrompt];
  const loggedArgs = ['run', ...extraArgs, '--dir', workingDirectory, '<prompt>'];

  return { executorArgs, loggedArgs };
}

function ensureHeadlessPermissionArgs(args: readonly string[]): readonly string[] {
  const withPure = hasOption(args, '--pure') || hasOption(args, '--no-pure')
    ? [...args]
    : ['--pure', ...args];

  if (hasOption(withPure, '--dangerously-skip-permissions')) {
    return withPure;
  }

  return ['--dangerously-skip-permissions', ...withPure];
}

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

function buildAllowlistedEnvironment(
  baseEnvironment: Readonly<Record<string, string | undefined>>,
  explicitEnvironment: Readonly<Record<string, string | undefined>> | undefined,
  allowlist: readonly string[]
): Readonly<Record<string, string>> {
  const source = explicitEnvironment ?? baseEnvironment;
  const result: Record<string, string> = {};

  for (const name of allowlist) {
    const value = source[name];

    if (value !== undefined) {
      result[name] = value;
    }
  }

  return result;
}

function statusFromExecution(execution: OpenCodeSubprocessExecutorResult): DevRunStatus {
  if (execution.cancelled === true) {
    return 'cancelled';
  }

  if (execution.timedOut === true) {
    return 'timed_out';
  }

  return execution.exitCode === 0 ? 'passed' : 'failed';
}

function summarizeRunStatus(attempts: readonly DevRunAttemptResult[]): DevRunStatus {
  if (attempts.some((attempt) => attempt.status === 'passed')) {
    return 'passed';
  }

  const lastAttempt = attempts[attempts.length - 1];
  return lastAttempt?.status ?? 'failed';
}

function summarizeAttempt(attempt: number, status: DevRunStatus, execution: OpenCodeSubprocessExecutorResult): string {
  if (status === 'passed') {
    return `Attempt ${attempt} passed.`;
  }

  if (status === 'timed_out') {
    return `Attempt ${attempt} timed out after the configured OpenCode timeout.`;
  }

  if (status === 'cancelled') {
    return `Attempt ${attempt} was cancelled before OpenCode completed.`;
  }

  return `Attempt ${attempt} failed with exit code: ${execution.exitCode ?? 'unknown'}.`;
}

function summarizeRun(status: DevRunStatus, attempts: number, lastAttempt: DevRunAttemptResult | undefined): string {
  if (status === 'passed') {
    return `OpenCode implementation passed after ${attempts} attempt(s).`;
  }

  if (status === 'timed_out') {
    return `OpenCode implementation timed out after ${attempts} attempt(s).`;
  }

  if (status === 'cancelled') {
    return `OpenCode implementation was cancelled after ${attempts} attempt(s).`;
  }

  return `OpenCode implementation failed after ${attempts} attempt(s); last exit code ${lastAttempt?.exitCode ?? 'unknown'}.`;
}

function renderLogHeader(input: DevRunInput, executable: string, args: readonly string[], workingDirectory: string): string {
  return [
    `# Implementation Log ${input.ticketKey}`,
    '',
    `- Run ID: ${input.runId}`,
    `- Repository: ${input.repository.owner}/${input.repository.name}`,
    `- Branch: ${input.branchName}`,
    `- Base branch: ${input.baseBranch}`,
    `- Working directory: ${workingDirectory}`,
    `- Command: ${redactCommand(executable, args)}`,
    `- Timeout ms: ${input.timeoutMs ?? 'not configured'}`,
    `- Environment allowlist: ${(input.environmentAllowlist ?? []).join(', ') || 'none'}`,
    ''
  ].join('\n');
}

function renderAttemptLog(attempt: DevRunAttemptResult, execution: OpenCodeSubprocessExecutorResult): string {
  return [
    `## Attempt ${attempt.attempt}`,
    '',
    `- Status: ${attempt.status.toUpperCase()}`,
    `- Started at: ${attempt.startedAt}`,
    `- Finished at: ${attempt.finishedAt}`,
    `- Duration ms: ${attempt.durationMs}`,
    `- Exit code: ${attempt.exitCode ?? 'null'}`,
    `- Signal: ${attempt.signal ?? 'none'}`,
    `- Summary: ${attempt.summary}`,
    '',
    '### Stdout',
    '```text',
    redactSensitiveText(execution.stdout),
    '```',
    '',
    '### Stderr',
    '```text',
    redactSensitiveText(execution.stderr),
    '```',
    ''
  ].join('\n');
}
