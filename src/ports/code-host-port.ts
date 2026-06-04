import type { BranchRef, PullRequestCheckSummary, PullRequestRef, PullRequestTarget, RepositoryRef } from '../domain/index.js';

export interface CreateCodeHostBranchInput {
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
}

export interface PushCodeHostBranchInput {
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
}

export interface OpenPullRequestInput {
  readonly repository: RepositoryRef;
  readonly title: string;
  readonly body: string;
  readonly sourceBranch: string;
  readonly targetBranch: PullRequestTarget;
}

export interface ChecksInput {
  readonly repository: RepositoryRef;
  readonly branchName: string;
}

export interface PullRequestCommentInput {
  readonly pullRequest: PullRequestRef;
  readonly body: string;
}

export interface CodeHostPort {
  createBranch(input: CreateCodeHostBranchInput): Promise<BranchRef>;
  pushBranch(input: PushCodeHostBranchInput): Promise<BranchRef>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef>;
  getChecks(input: ChecksInput): Promise<PullRequestCheckSummary>;
  commentOnPullRequest(input: PullRequestCommentInput): Promise<void>;
}
