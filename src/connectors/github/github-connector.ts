import type { BranchRef, PullRequestCheckSummary, PullRequestRef, PullRequestTarget, RepositoryRef } from '../../domain/index.js';

export interface CreateGitHubBranchInput {
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
}

export interface PushGitHubBranchInput {
  readonly repository: RepositoryRef;
  readonly branch: BranchRef;
}

export interface PullRequestInput {
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

export interface GitHubConnector {
  createBranch(input: CreateGitHubBranchInput): Promise<BranchRef>;
  pushBranch(input: PushGitHubBranchInput): Promise<BranchRef>;
  openPullRequest(input: PullRequestInput): Promise<PullRequestRef>;
  getChecks(input: ChecksInput): Promise<PullRequestCheckSummary>;
  commentOnPullRequest(input: PullRequestCommentInput): Promise<void>;
}
