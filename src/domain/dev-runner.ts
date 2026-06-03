import type { RepositoryRef } from './repository.js';

export type DevRunProvider = 'opencode';

export type DevRunStatus = 'passed' | 'failed';

export interface DevRunAttemptResult {
  readonly attempt: number;
  readonly command: string;
  readonly workingDirectory: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly status: DevRunStatus;
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
  readonly workingDirectory: string;
  readonly prompt: string;
  readonly implementationLogPath: string;
  readonly maxAttempts: number;
}

export interface DevRunner {
  run(input: DevRunInput): Promise<DevRunResult>;
}
