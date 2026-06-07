import type { TestRelevanceReport } from './run.js';

export type BuiltInQualityGateName =
  | 'install'
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'build'
  | 'format'
  | 'coverage'
  | 'secret_scan'
  | 'dependency_audit'
  | 'e2e';

export type QualityGateRequirement = 'required' | 'optional';

export type QualityGateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface QualityGateDefinition {
  readonly name: BuiltInQualityGateName | string;
  readonly command?: string;
  readonly requirement: QualityGateRequirement;
  readonly workingDirectory: string;
}

export interface QualityGateResult {
  readonly name: BuiltInQualityGateName | string;
  readonly command?: string;
  readonly workingDirectory: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdoutLogPath: string;
  readonly stderrLogPath: string;
  readonly status: QualityGateStatus;
  readonly summary: string;
}

export interface QualityReport {
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly required: readonly QualityGateResult[];
  readonly optional: readonly QualityGateResult[];
  readonly testRelevance?: TestRelevanceReport;
}
