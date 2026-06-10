import type {
  ChecksInput,
  CodeHostPort,
  CreateCodeHostBranchInput,
  MergePullRequestInput,
  OpenPullRequestInput,
  PullRequestCommentInput,
  ReadPullRequestInput,
  PushCodeHostBranchInput
} from '../../ports/index.js';

export type {
  ChecksInput,
  CreateCodeHostBranchInput as CreateGitHubBranchInput,
  MergePullRequestInput,
  OpenPullRequestInput as PullRequestInput,
  PullRequestCommentInput,
  ReadPullRequestInput,
  PushCodeHostBranchInput as PushGitHubBranchInput
};

export interface GitHubConnector extends CodeHostPort {}
