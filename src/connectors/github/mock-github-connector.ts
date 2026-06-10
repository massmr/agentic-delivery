import type { BranchRef, PullRequestCheckSummary, PullRequestMergeResult, PullRequestRef } from '../../domain/index.js';
import type {
  ChecksInput,
  CreateGitHubBranchInput,
  GitHubConnector,
  MergePullRequestInput,
  PullRequestCommentInput,
  PullRequestInput,
  ReadPullRequestInput,
  PushGitHubBranchInput
} from './github-connector.js';

export interface MockGitHubConnectorOptions {
  readonly checks?: PullRequestCheckSummary;
}

export class MockGitHubConnector implements GitHubConnector {
  private readonly branches = new Map<string, BranchRef>();
  private readonly pullRequests = new Map<string, PullRequestRef>();
  private readonly comments = new Map<string, readonly string[]>();
  private checks: PullRequestCheckSummary;

  constructor(options: MockGitHubConnectorOptions = {}) {
    this.checks = options.checks ?? passedChecks;
  }

  setChecks(checks: PullRequestCheckSummary): void {
    this.checks = checks;
  }

  setPullRequestStatus(pullRequest: PullRequestRef, status: PullRequestRef['status']): PullRequestRef {
    const updated = { ...pullRequest, status };
    this.pullRequests.set(pullRequestRefKey(updated), updated);
    return updated;
  }

  async createBranch(input: CreateGitHubBranchInput): Promise<BranchRef> {
    const key = branchKey(input.branch);
    const existing = this.branches.get(key);

    if (existing !== undefined) {
      return existing;
    }

    this.branches.set(key, input.branch);
    return input.branch;
  }

  async pushBranch(input: PushGitHubBranchInput): Promise<BranchRef> {
    const pushedBranch: BranchRef = {
      ...input.branch,
      headSha: input.branch.headSha ?? `mock-${stableNumber(`${input.repository.owner}/${input.repository.name}/${input.branch.name}`).toString(16)}`
    };

    this.branches.set(branchKey(pushedBranch), pushedBranch);
    return pushedBranch;
  }

  async openPullRequest(input: PullRequestInput): Promise<PullRequestRef> {
    const key = pullRequestKey(input);
    const existing = this.pullRequests.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const number = stableNumber(key);
    const pullRequest: PullRequestRef = {
      provider: 'github',
      repositoryOwner: input.repository.owner,
      repositoryName: input.repository.name,
      number,
      title: input.title,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      url: `https://mock-github.local/${input.repository.owner}/${input.repository.name}/pull/${number}`,
      status: 'open'
    };

    this.pullRequests.set(key, pullRequest);
    return pullRequest;
  }

  async readPullRequest(input: ReadPullRequestInput): Promise<PullRequestRef> {
    return this.pullRequests.get(pullRequestRefKey(input.pullRequest)) ?? input.pullRequest;
  }

  async getChecks(_input: ChecksInput): Promise<PullRequestCheckSummary> {
    return this.checks;
  }

  async mergePullRequest(input: MergePullRequestInput): Promise<PullRequestMergeResult> {
    if (input.pullRequest.targetBranch !== 'develop') {
      throw new Error(`Mock GitHub refuses to auto-merge ${input.pullRequest.targetBranch} pull requests.`);
    }

    const mergedPullRequest = this.setPullRequestStatus(input.pullRequest, 'merged');
    return {
      pullRequest: mergedPullRequest,
      mergeMethod: input.method,
      commitSha: `mock-merge-${input.pullRequest.number.toString(16)}`,
      mergedAt: new Date(0).toISOString()
    };
  }

  async commentOnPullRequest(input: PullRequestCommentInput): Promise<void> {
    const key = `${input.pullRequest.repositoryOwner}/${input.pullRequest.repositoryName}#${input.pullRequest.number}`;
    const comments = this.comments.get(key) ?? [];

    this.comments.set(key, [...comments, input.body]);
  }
}

function branchKey(branch: BranchRef): string {
  return `${branch.repository.owner}/${branch.repository.name}/${branch.name}`;
}

function pullRequestKey(input: PullRequestInput): string {
  return `${input.repository.owner}/${input.repository.name}/${input.sourceBranch}->${input.targetBranch}`;
}

function pullRequestRefKey(pullRequest: PullRequestRef): string {
  return `${pullRequest.repositoryOwner}/${pullRequest.repositoryName}/${pullRequest.sourceBranch}->${pullRequest.targetBranch}`;
}

const passedChecks: PullRequestCheckSummary = {
  status: 'passed',
  totalCount: 1,
  passedCount: 1,
  failedCount: 0,
  pendingCount: 0
};

function stableNumber(source: string): number {
  let hash = 0;

  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) % 9000;
  }

  return hash + 1;
}
