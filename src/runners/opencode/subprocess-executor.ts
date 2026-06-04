import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export interface OpenCodeSubprocessExecutorInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
  readonly timeoutMs?: number | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface OpenCodeSubprocessExecutorResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal?: string | undefined;
  readonly timedOut?: boolean | undefined;
  readonly cancelled?: boolean | undefined;
}

export type OpenCodeSubprocessExecutor = (input: OpenCodeSubprocessExecutorInput) => Promise<OpenCodeSubprocessExecutorResult>;

export type OpenCodeProcessSpawner = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly shell: false;
    readonly stdio: ['pipe', 'pipe', 'pipe'];
  }
) => ChildProcessWithoutNullStreams;

export function createNodeOpenCodeSubprocessExecutor(spawnProcess: OpenCodeProcessSpawner = spawn): OpenCodeSubprocessExecutor {
  return (input) => {
    if (input.abortSignal?.aborted === true) {
      return Promise.resolve({ stdout: '', stderr: '', exitCode: null, cancelled: true });
    }

    return executeNodeOpenCodeSubprocess(input, spawnProcess);
  };
}

export const nodeOpenCodeSubprocessExecutor: OpenCodeSubprocessExecutor = createNodeOpenCodeSubprocessExecutor();

function executeNodeOpenCodeSubprocess(input: OpenCodeSubprocessExecutorInput, spawnProcess: OpenCodeProcessSpawner): Promise<OpenCodeSubprocessExecutorResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timeout: NodeJS.Timeout | undefined;

    const child = spawnProcess(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const finish = (result: OpenCodeSubprocessExecutorResult): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      input.abortSignal?.removeEventListener('abort', abort);
      resolve(result);
    };

    const abort = (): void => {
      cancelled = true;
      child.kill('SIGTERM');
    };

    if (input.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, input.timeoutMs);
    }

    input.abortSignal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish({ stdout, stderr: `${stderr}${error.message}\n`, exitCode: 1, timedOut, cancelled });
    });
    child.on('close', (exitCode, signal) => {
      finish({ stdout, stderr, exitCode, signal: signal ?? undefined, timedOut, cancelled });
    });
    child.stdin.end(input.stdin);
  });
}
