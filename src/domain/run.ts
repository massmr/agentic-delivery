import type { DeploymentResult } from './deployment.js';
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

export interface DeliveryRunStateRecord {
  readonly runId: string;
  readonly ticket: TicketRef;
  readonly state: DeliveryRunState;
  readonly targetRepositories: readonly RepositoryRef[];
  readonly branches: readonly BranchRef[];
  readonly pullRequests: readonly PullRequestRef[];
  readonly stagingDeployments: readonly DeploymentResult[];
  readonly qualityReports: readonly QualityReport[];
  readonly timestamps: RunTimestamps;
  readonly ticketAnalysis?: TicketAnalysis;
  readonly failure?: DeliveryRunFailure;
  readonly humanActionNeeded?: HumanActionRequest;
}
