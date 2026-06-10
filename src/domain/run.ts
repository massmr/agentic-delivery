import type { DeploymentResult } from './deployment.js';
import type { DevRunResult } from './dev-runner.js';
import type { DevelopPullRequestFollowUpEvidence, PullRequestRef } from './pull-request.js';
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

export interface DevelopHandoffCommit {
  readonly repository: RepositoryRef;
  readonly branchName: string;
  readonly commitSha: string;
  readonly message: string;
  readonly stagedFiles: readonly string[];
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

export type AgentCompletionDecision = 'pass' | 'needs_human' | 'fail';

export type TestRelevanceDecision = 'pass' | 'warn' | 'needs_human';

export type AgentCompletionSource = 'implementation_log' | 'dev_run_summary' | 'combined';

export type AgentCompletionStatusSignal = 'completed' | 'blocked' | 'incomplete' | 'missing';

export type AgentCompletionFindingKind =
  | 'missing_completed_status'
  | 'blocked_status'
  | 'incomplete_status'
  | 'missing_changed_files'
  | 'missing_tests'
  | 'missing_known_limits'
  | 'unresolved_blockers'
  | 'pending_background_agents'
  | 'exploration_only'
  | 'incomplete_language'
  | 'diff_not_meaningful';

export interface AgentCompletionFinding {
  readonly kind: AgentCompletionFindingKind;
  readonly severity: AgentCompletionDecision;
  readonly message: string;
}

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

export interface AgentCompletionReport {
  readonly decision: AgentCompletionDecision;
  readonly reason: string;
  readonly source: AgentCompletionSource;
  readonly statusSignal: AgentCompletionStatusSignal;
  readonly summaryText: string;
  readonly changedFilesMentioned: readonly string[];
  readonly testsMentioned: boolean;
  readonly knownLimitsMentioned: boolean;
  readonly blockers: readonly string[];
  readonly findings: readonly AgentCompletionFinding[];
}

export type TestRelevanceFindingSeverity = 'info' | 'warn' | 'needs_human';

export type TestRelevanceFindingKind =
  | 'realistic_test_command'
  | 'trivial_test_command'
  | 'missing_test_command'
  | 'missing_test_claim'
  | 'explicit_tests_not_run'
  | 'non_product_change';

export interface TestRelevanceQualityCommand {
  readonly name: string;
  readonly command: string;
  readonly requirement: 'required' | 'optional';
  readonly status: string;
  readonly relevant: boolean;
  readonly trivial: boolean;
}

export interface TestRelevanceFinding {
  readonly kind: TestRelevanceFindingKind;
  readonly severity: TestRelevanceFindingSeverity;
  readonly message: string;
}

export interface TestRelevanceReport {
  readonly decision: TestRelevanceDecision;
  readonly reason: string;
  readonly changedFiles: readonly string[];
  readonly testsReported: readonly string[];
  readonly qualityCommands: readonly TestRelevanceQualityCommand[];
  readonly findings: readonly TestRelevanceFinding[];
  readonly trivialCommandPatterns: readonly string[];
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
  readonly developHandoffCommit?: DevelopHandoffCommit;
  readonly developPullRequestFollowUp?: DevelopPullRequestFollowUpEvidence;
  readonly agentCompletion?: AgentCompletionReport;
  readonly coreSafety?: CoreSafetyReport;
  readonly testRelevance?: TestRelevanceReport;
  readonly ticketAnalysis?: TicketAnalysis;
  readonly failure?: DeliveryRunFailure;
  readonly humanActionNeeded?: HumanActionRequest;
}
