import type { BranchRef, PullRequestCheckSummary, PullRequestRef } from '../../domain/index.js';
import type {
  ChecksInput,
  CreateGitHubBranchInput,
  GitHubConnector,
  PullRequestCommentInput,
  PullRequestInput,
  PushGitHubBranchInput
} from './github-connector.js';

export class MockGitHubConnector implements GitHubConnector {
  private readonly branches = new Map<string, BranchRef>();
  private readonly pullRequests = new Map<string, PullRequestRef>();
  private readonly comments = new Map<string, readonly string[]>();

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

  async getChecks(_input: ChecksInput): Promise<PullRequestCheckSummary> {
    return {
      status: 'pending',
      totalCount: 0,
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0
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

function stableNumber(source: string): number {
  let hash = 0;

  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) % 9000;
  }

  return hash + 1;
}
