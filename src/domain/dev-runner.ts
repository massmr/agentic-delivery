import type { RepositoryRef } from './repository.js';

export type DevRunProvider = 'opencode';

export type DevRunStatus = 'passed' | 'failed' | 'timed_out' | 'cancelled';

export interface DevRunAttemptResult {
  readonly attempt: number;
  readonly command: string;
  readonly workingDirectory: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal?: string | undefined;
  readonly status: DevRunStatus;
  readonly timedOut?: boolean | undefined;
  readonly cancelled?: boolean | undefined;
  readonly summary: string;
}

export interface DevRunResult {
  readonly provider: DevRunProvider;
  readonly ticketKey: string;
  readonly runId: string;
  readonly repository: RepositoryRef;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly command: string;
  readonly workingDirectory: string;
  readonly implementationLogPath: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly attempts: readonly DevRunAttemptResult[];
  readonly status: DevRunStatus;
  readonly summary: string;
}

export interface DevRunInput {
  readonly ticketKey: string;
  readonly runId: string;
  readonly repository: RepositoryRef;
  readonly branchName: string;
  readonly baseBranch: string;
  readonly command: string;
  readonly commandArgs?: readonly string[] | undefined;
  readonly workingDirectory: string;
  readonly prompt: string;
  readonly implementationLogPath: string;
  readonly maxAttempts: number;
  readonly workspaceRoot?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly environmentAllowlist?: readonly string[] | undefined;
  readonly abortSignal?: AbortSignal | undefined;
}

export interface DevRunner {
  run(input: DevRunInput): Promise<DevRunResult>;
}
