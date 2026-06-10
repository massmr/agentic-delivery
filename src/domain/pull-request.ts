export type PullRequestProvider = 'github';

export type PullRequestTarget = 'develop' | 'main';

export type PullRequestStatus = 'draft' | 'open' | 'merged' | 'closed';

export type PullRequestCheckStatus = 'pending' | 'passed' | 'failed' | 'cancelled';

export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type NoRemoteChecksPolicy = 'pass' | 'wait' | 'needs_human' | 'fail';

export type PullRequestFollowUpDecision = 'ready_for_staging' | 'wait' | 'needs_human' | 'fail' | 'stopped';

export interface PullRequestRef {
  readonly provider: PullRequestProvider;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly number: number;
  readonly title: string;
  readonly sourceBranch: string;
  readonly targetBranch: PullRequestTarget;
  readonly url: string;
  readonly status: PullRequestStatus;
}

export interface PullRequestCheckSummary {
  readonly status: PullRequestCheckStatus;
  readonly totalCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly pendingCount: number;
}

export interface PullRequestMergeResult {
  readonly pullRequest: PullRequestRef;
  readonly mergeMethod: PullRequestMergeMethod;
  readonly commitSha?: string | undefined;
  readonly mergedAt: string;
}

export interface DevelopPullRequestFollowUpEvidence {
  readonly pullRequest: PullRequestRef;
  readonly checks: PullRequestCheckSummary;
  readonly decision: PullRequestFollowUpDecision;
  readonly reason: string;
  readonly noRemoteChecksPolicy: NoRemoteChecksPolicy;
  readonly autoMerge: boolean;
  readonly mergeMethod: PullRequestMergeMethod;
  readonly observedAt: string;
  readonly mergeResult?: PullRequestMergeResult | undefined;
}
