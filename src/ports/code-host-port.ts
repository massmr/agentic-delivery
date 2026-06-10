import type { BranchRef, PullRequestCheckSummary, PullRequestMergeMethod, PullRequestMergeResult, PullRequestRef, PullRequestTarget, RepositoryRef } from '../domain/index.js';

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
  readonly draft?: boolean | undefined;
}

export interface ChecksInput {
  readonly repository: RepositoryRef;
  readonly branchName: string;
  readonly pullRequest?: PullRequestRef | undefined;
}

export interface PullRequestCommentInput {
  readonly pullRequest: PullRequestRef;
  readonly body: string;
}

export interface ReadPullRequestInput {
  readonly pullRequest: PullRequestRef;
}

export interface MergePullRequestInput {
  readonly pullRequest: PullRequestRef;
  readonly method: PullRequestMergeMethod;
}

export interface CodeHostPort {
  createBranch(input: CreateCodeHostBranchInput): Promise<BranchRef>;
  pushBranch(input: PushCodeHostBranchInput): Promise<BranchRef>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef>;
  readPullRequest(input: ReadPullRequestInput): Promise<PullRequestRef>;
  getChecks(input: ChecksInput): Promise<PullRequestCheckSummary>;
  mergePullRequest(input: MergePullRequestInput): Promise<PullRequestMergeResult>;
  commentOnPullRequest(input: PullRequestCommentInput): Promise<void>;
}
