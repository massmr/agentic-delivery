export type PullRequestProvider = 'github';

export type PullRequestTarget = 'develop' | 'main';

export type PullRequestStatus = 'draft' | 'open' | 'merged' | 'closed';

export type PullRequestCheckStatus = 'pending' | 'passed' | 'failed' | 'cancelled';

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
