import type {
  ChecksInput,
  CodeHostPort,
  CreateCodeHostBranchInput,
  OpenPullRequestInput,
  PullRequestCommentInput,
  PushCodeHostBranchInput
} from '../../ports/index.js';

export type { ChecksInput, CreateCodeHostBranchInput as CreateGitHubBranchInput, OpenPullRequestInput as PullRequestInput, PullRequestCommentInput, PushCodeHostBranchInput as PushGitHubBranchInput };

export interface GitHubConnector extends CodeHostPort {}
