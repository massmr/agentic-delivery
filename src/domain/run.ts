import type { DeploymentResult } from './deployment.js';
import type { DevRunResult } from './dev-runner.js';
import type { PullRequestRef } from './pull-request.js';
import type { QualityReport } from './quality.js';
import type { RepositoryRef } from './repository.js';
import type { TicketAnalysis, TicketRef } from './ticket.js';

export const deliveryRunStates = [
  'DISCOVERED',
  'PLANNED',
  'BRANCH_CREATED',
  'IMPLEMENTING',
  'LOCAL_CHECKS_RUNNING',
  'LOCAL_CHECKS_PASSED',
  'PUSHED',
  'PR_TO_DEVELOP_OPENED',
  'DEVELOP_CHECKS_PASSED',
  'STAGING_DEPLOYING',
  'STAGING_VERIFIED',
  'PRODUCTION_PR_OPENED',
  'DONE',
  'NEEDS_HUMAN',
  'FAILED',
  'SKIPPED'
] as const;

export type DeliveryRunState = (typeof deliveryRunStates)[number];

export interface BranchRef {
  readonly repository: RepositoryRef;
  readonly name: string;
  readonly baseBranch: string;
  readonly headSha?: string;
}

export interface RunTimestamps {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface DeliveryRunFailure {
  readonly state: DeliveryRunState;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface HumanActionRequest {
  readonly reason: string;
  readonly requestedAt: string;
}

export type MeaningfulDiffDecision = 'passed' | 'failed';

export type CoreSafetyDecision = 'pass' | 'needs_human' | 'fail';

export type CoreSafetyFindingSeverity = 'fail' | 'needs_human';

export type CoreSafetyFindingKind = 'forbidden_file' | 'secret_like_addition' | 'diff_limit' | 'human_review_category';

export type CoreSafetyHumanReviewCategory = 'dependency_lockfile' | 'db_migration' | 'auth_path' | 'payment_billing_path' | 'infra_deployment_config';

export interface MeaningfulDiffSnapshot {
  readonly changedFiles: readonly string[];
  readonly diffSummary: string;
}

export interface MeaningfulDiffEvidence {
  readonly decision: MeaningfulDiffDecision;
  readonly reason: string;
  readonly baselineChangedFiles: readonly string[];
  readonly afterAgentChangedFiles: readonly string[];
  readonly newChangedFiles: readonly string[];
  readonly changedFiles: readonly string[];
  readonly productFiles: readonly string[];
  readonly ignoredFiles: readonly string[];
  readonly ignoredPathPatterns: readonly string[];
  readonly baselineDiffSummary: string;
  readonly afterAgentDiffSummary: string;
  readonly diffSummary: string;
}

export interface CoreSafetyLimits {
  readonly maxChangedFiles: number;
  readonly maxAddedLines: number;
}

export interface CoreSafetyForbiddenFileFinding {
  readonly filePath: string;
  readonly reason: string;
}

export interface CoreSafetySecretFinding {
  readonly filePath: string;
  readonly lineNumber?: number | undefined;
  readonly detector: string;
}

export interface CoreSafetyHumanReviewFinding {
  readonly filePath: string;
  readonly category: CoreSafetyHumanReviewCategory;
  readonly reason: string;
}

export interface CoreSafetyLimitFinding {
  readonly limit: keyof CoreSafetyLimits;
  readonly actual: number;
  readonly maximum: number;
  readonly reason: string;
}

export interface CoreSafetyReport {
  readonly decision: CoreSafetyDecision;
  readonly reason: string;
  readonly changedFiles: readonly string[];
  readonly changedFileCount: number;
  readonly addedLineCount: number;
  readonly limits: CoreSafetyLimits;
  readonly forbiddenFiles: readonly CoreSafetyForbiddenFileFinding[];
  readonly secretFindings: readonly CoreSafetySecretFinding[];
  readonly limitFindings: readonly CoreSafetyLimitFinding[];
  readonly humanReviewFindings: readonly CoreSafetyHumanReviewFinding[];
}

export interface DeliveryRunStateRecord {
  readonly runId: string;
  readonly ticket: TicketRef;
  readonly state: DeliveryRunState;
  readonly targetRepositories: readonly RepositoryRef[];
  readonly branches: readonly BranchRef[];
  readonly pullRequests: readonly PullRequestRef[];
  readonly stagingDeployments: readonly DeploymentResult[];
  readonly qualityReports: readonly QualityReport[];
  readonly devRuns: readonly DevRunResult[];
  readonly timestamps: RunTimestamps;
  readonly meaningfulDiff?: MeaningfulDiffEvidence;
  readonly coreSafety?: CoreSafetyReport;
  readonly ticketAnalysis?: TicketAnalysis;
  readonly failure?: DeliveryRunFailure;
  readonly humanActionNeeded?: HumanActionRequest;
}
