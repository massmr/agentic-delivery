import type { BranchRef, PullRequestCheckStatus, PullRequestCheckSummary, PullRequestRef, PullRequestTarget, RepositoryRef } from '../../domain/index.js';
import type { JsonArray, JsonObject, JsonValue, McpClient, McpToolAllowlistRule, McpToolCallAuditRecord, McpToolCallExecutionResult } from '../../mcp/index.js';
import { callAllowedMcpTool, discoverMcpTools, isJsonObject, requireDiscoveredMcpTool } from '../../mcp/index.js';
import type {
  ChecksInput,
  CodeHostPort,
  CreateCodeHostBranchInput,
  OpenPullRequestInput,
  PullRequestCommentInput,
  PushCodeHostBranchInput
} from '../../ports/index.js';
import type { GitHubConnector } from './github-connector.js';

const portName = 'CodeHostPort';

export interface GitHubMcpToolNames {
  readonly listBranches: string;
  readonly createBranch: string;
  readonly listPullRequests: string;
  readonly openPullRequest: string;
  readonly getChecks: string;
  readonly commentOnPullRequest: string;
}

export type GitHubMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;

export const defaultGitHubMcpToolNames: GitHubMcpToolNames = {
  listBranches: 'list_branches',
  createBranch: 'create_branch',
  listPullRequests: 'list_pull_requests',
  openPullRequest: 'create_pull_request',
  getChecks: 'pull_request_read',
  commentOnPullRequest: 'add_issue_comment'
} as const;

export interface GitHubMcpCodeHostPortOptions {
  readonly client: McpClient;
  readonly serverId: string;
  readonly timeoutMs?: number | undefined;
  readonly toolNames?: Partial<GitHubMcpToolNames> | undefined;
  readonly auditSink?: GitHubMcpAuditSink | undefined;
}

export class GitHubMcpCodeHostPort implements GitHubConnector, CodeHostPort {
  private readonly allowlist: readonly McpToolAllowlistRule[];
  private readonly auditSink: GitHubMcpAuditSink | undefined;
  private readonly client: McpClient;
  private readonly serverId: string;
  private readonly timeoutMs: number | undefined;
  private readonly toolNames: GitHubMcpToolNames;

  constructor(options: GitHubMcpCodeHostPortOptions) {
    this.client = options.client;
    this.serverId = options.serverId;
    this.timeoutMs = options.timeoutMs;
    this.toolNames = { ...defaultGitHubMcpToolNames, ...options.toolNames };
    this.auditSink = options.auditSink;
    this.allowlist = createGitHubMcpToolRequirements(options.serverId, this.toolNames);
  }

  async createBranch(input: CreateCodeHostBranchInput): Promise<BranchRef> {
    const existingBranch = await this.findBranch(input.repository, input.branch.name);

    if (existingBranch !== undefined) {
      return {
        repository: input.branch.repository,
        name: existingBranch.name,
        baseBranch: input.branch.baseBranch,
        headSha: existingBranch.headSha ?? input.branch.headSha
      };
    }

    const execution = await this.callGitHubTool(this.toolNames.createBranch, 'createBranch', {
      owner: input.repository.owner,
      repo: input.repository.name,
      branch: input.branch.name,
      from_branch: input.branch.baseBranch
    });

    return readBranchRef(execution.result.content, input.branch);
  }

  async pushBranch(input: PushCodeHostBranchInput): Promise<BranchRef> {
    throw new GitHubMcpPushBranchUnsupportedError(input.repository.owner, input.repository.name, input.branch.name);
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    const execution = await this.callGitHubTool(this.toolNames.openPullRequest, 'openPullRequest', {
      title: input.title,
      owner: input.repository.owner,
      repo: input.repository.name,
      body: input.body,
      head: input.sourceBranch,
      base: input.targetBranch,
      draft: true
    });

    return readPullRequestRef(execution.result.content, input);
  }

  async getChecks(input: ChecksInput): Promise<PullRequestCheckSummary> {
    const pullRequestNumber = await this.findPullRequestNumber(input.repository, input.branchName);
    const execution = await this.callGitHubTool(this.toolNames.getChecks, 'getChecks', {
      method: 'get_check_runs',
      owner: input.repository.owner,
      repo: input.repository.name,
      pullNumber: pullRequestNumber
    });

    return readCheckSummary(execution.result.content);
  }

  async commentOnPullRequest(input: PullRequestCommentInput): Promise<void> {
    await this.callGitHubTool(this.toolNames.commentOnPullRequest, 'commentOnPullRequest', {
      owner: input.pullRequest.repositoryOwner,
      repo: input.pullRequest.repositoryName,
      issue_number: input.pullRequest.number,
      body: input.body
    });
  }

  private async findBranch(repository: RepositoryRef, branchName: string): Promise<{ readonly name: string; readonly headSha?: string | undefined } | undefined> {
    const execution = await this.callGitHubTool(this.toolNames.listBranches, 'createBranch', {
      owner: repository.owner,
      repo: repository.name
    });
    const branches = readArrayFromObject(execution.result.content, 'branches');

    for (const branchValue of branches) {
      if (!isJsonObject(branchValue)) {
        continue;
      }

      const name = readOptionalString(branchValue.name);
      if (name === branchName) {
        return { name, headSha: readOptionalString(readNestedStringValue(branchValue, ['commit', 'sha']) ?? branchValue.sha) };
      }
    }

    return undefined;
  }

  private async findPullRequestNumber(repository: RepositoryRef, branchName: string): Promise<number> {
    const execution = await this.callGitHubTool(this.toolNames.listPullRequests, 'getChecks', {
      owner: repository.owner,
      repo: repository.name,
      head: `${repository.owner}:${branchName}`,
      state: 'open'
    });
    const pullRequests = readArrayFromObject(execution.result.content, 'pullRequests', 'pull_requests', 'items');

    for (const pullRequestValue of pullRequests) {
      if (!isJsonObject(pullRequestValue)) {
        continue;
      }

      const headRef = readOptionalString(readNestedStringValue(pullRequestValue, ['head', 'ref']) ?? pullRequestValue.sourceBranch ?? pullRequestValue.source_branch);
      if (headRef === branchName) {
        const number = readOptionalPositiveInteger(pullRequestValue.number ?? pullRequestValue.pullNumber ?? pullRequestValue.pull_number);
        if (number !== undefined) {
          return number;
        }
      }
    }

    throw new Error(`GitHub MCP list_pull_requests response must include an open pull request for branch '${branchName}' with a numeric number.`);
  }

  private async callGitHubTool(configuredToolName: string, action: 'createBranch' | 'openPullRequest' | 'getChecks' | 'commentOnPullRequest', argumentsObject: JsonObject): Promise<McpToolCallExecutionResult> {
    const toolName = await this.requireTool(configuredToolName);

    try {
      const execution = await callAllowedMcpTool({
        client: this.client,
        allowlist: this.allowlist,
        call: {
          serverId: this.serverId,
          toolName,
          arguments: argumentsObject,
          timeoutMs: this.timeoutMs
        },
        context: { port: portName, action }
      });

      this.recordAudit(execution.auditRecords);
      return execution;
    } catch (error) {
      this.recordAudit(readAuditRecords(error));
      throw error;
    }
  }

  private async requireTool(toolName: string): Promise<string> {
    const catalog = await discoverMcpTools(this.client, this.serverId);
    return requireDiscoveredMcpTool(catalog, toolName).name;
  }

  private recordAudit(records: readonly McpToolCallAuditRecord[]): void {
    if (records.length > 0) {
      this.auditSink?.(records);
    }
  }
}

export function createGitHubMcpToolRequirements(serverId: string, toolNames: Partial<GitHubMcpToolNames> = {}): readonly McpToolAllowlistRule[] {
  const resolvedToolNames: GitHubMcpToolNames = { ...defaultGitHubMcpToolNames, ...toolNames };

  return [
    { serverId, toolName: resolvedToolNames.listBranches, port: portName, action: 'createBranch', safety: 'read' },
    { serverId, toolName: resolvedToolNames.createBranch, port: portName, action: 'createBranch', safety: 'write' },
    { serverId, toolName: resolvedToolNames.listPullRequests, port: portName, action: 'getChecks', safety: 'read' },
    { serverId, toolName: resolvedToolNames.openPullRequest, port: portName, action: 'openPullRequest', safety: 'write' },
    { serverId, toolName: resolvedToolNames.getChecks, port: portName, action: 'getChecks', safety: 'read' },
    { serverId, toolName: resolvedToolNames.commentOnPullRequest, port: portName, action: 'commentOnPullRequest', safety: 'write' }
  ];
}

class GitHubMcpPushBranchUnsupportedError extends Error {
  constructor(owner: string, repository: string, branchName: string) {
    super(`GitHub MCP pushBranch is not supported for ${owner}/${repository}@${branchName}. Use native/local git fallback for branch pushing until a precise MCP push contract exists.`);
    this.name = 'GitHubMcpPushBranchUnsupportedError';
  }
}

function readAuditRecords(error: unknown): readonly McpToolCallAuditRecord[] {
  if (typeof error !== 'object' || error === null || !('auditRecords' in error)) {
    return [];
  }

  const records = (error as { readonly auditRecords?: unknown }).auditRecords;
  return Array.isArray(records) ? records.filter(isAuditRecord) : [];
}

function isAuditRecord(value: unknown): value is McpToolCallAuditRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.auditId === 'string'
    && typeof record.serverId === 'string'
    && typeof record.toolName === 'string'
    && typeof record.port === 'string'
    && typeof record.action === 'string'
    && (record.status === 'started' || record.status === 'succeeded' || record.status === 'failed');
}

function readBranchRef(content: JsonValue | undefined, fallback: BranchRef): BranchRef {
  const branch = unwrapObject(content, 'content', 'branch');

  return {
    repository: fallback.repository,
    name: readOptionalString(branch.name ?? branch.ref) ?? fallback.name,
    baseBranch: readOptionalString(branch.baseBranch ?? branch.base_branch ?? branch.from_branch) ?? fallback.baseBranch,
    headSha: readOptionalString(readNestedStringValue(branch, ['commit', 'sha']) ?? branch.headSha ?? branch.head_sha ?? branch.sha) ?? fallback.headSha
  };
}

function readPullRequestRef(content: JsonValue | undefined, input: OpenPullRequestInput): PullRequestRef {
  const pullRequest = unwrapObject(content, 'content', 'pullRequest');
  const number = readOptionalPositiveInteger(pullRequest.number ?? pullRequest.pullRequestNumber ?? pullRequest.pull_request_number);

  if (number === undefined) {
    throw new Error('GitHub MCP pull request response must include a numeric pull request number.');
  }

  return {
    provider: 'github',
    repositoryOwner: input.repository.owner,
    repositoryName: input.repository.name,
    number,
    title: readOptionalString(pullRequest.title) ?? input.title,
    sourceBranch: readOptionalString(readNestedStringValue(pullRequest, ['head', 'ref']) ?? pullRequest.sourceBranch ?? pullRequest.source_branch ?? pullRequest.head) ?? input.sourceBranch,
    targetBranch: readOptionalPullRequestTarget(readNestedStringValue(pullRequest, ['base', 'ref']) ?? pullRequest.targetBranch ?? pullRequest.target_branch ?? pullRequest.base) ?? input.targetBranch,
    url: readOptionalString(pullRequest.html_url ?? pullRequest.url) ?? `https://github.com/${input.repository.owner}/${input.repository.name}/pull/${number}`,
    status: readOptionalPullRequestStatus(pullRequest.status) ?? 'open'
  };
}

function readCheckSummary(content: JsonValue | undefined): PullRequestCheckSummary {
  const summary = unwrapObject(content, 'content', 'checks');
  const checkRuns = readArrayFromObject(summary, 'check_runs');
  const derived = checkRuns.length === 0 ? undefined : summarizeCheckRuns(checkRuns);
  const passedCount = readOptionalPositiveInteger(summary.passedCount ?? summary.passed_count) ?? derived?.passedCount ?? 0;
  const failedCount = readOptionalPositiveInteger(summary.failedCount ?? summary.failed_count) ?? derived?.failedCount ?? 0;
  const pendingCount = readOptionalPositiveInteger(summary.pendingCount ?? summary.pending_count) ?? derived?.pendingCount ?? 0;
  const totalCount = readOptionalPositiveInteger(summary.totalCount ?? summary.total_count) ?? readOptionalPositiveInteger(summary.total_count) ?? derived?.totalCount ?? passedCount + failedCount + pendingCount;

  return {
    status: readOptionalPullRequestCheckStatus(summary.status) ?? deriveCheckStatus({ passedCount, failedCount, pendingCount }),
    totalCount,
    passedCount,
    failedCount,
    pendingCount
  };
}

function summarizeCheckRuns(checkRuns: readonly JsonValue[]): { readonly passedCount: number; readonly failedCount: number; readonly pendingCount: number; readonly totalCount: number } {
  let passedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const checkRunValue of checkRuns) {
    if (!isJsonObject(checkRunValue)) {
      continue;
    }

    const status = readOptionalString(checkRunValue.status);
    const conclusion = readOptionalString(checkRunValue.conclusion);

    if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') {
      passedCount += 1;
    } else if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'action_required' || conclusion === 'startup_failure' || conclusion === 'cancelled') {
      failedCount += 1;
    } else if (status === 'completed') {
      pendingCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  return { passedCount, failedCount, pendingCount, totalCount: checkRuns.length };
}

function unwrapObject(content: JsonValue | undefined, path: string, nestedKey: string): JsonObject {
  const root = readObject(content, path);
  const nested = root[nestedKey];
  return nested !== undefined && isJsonObject(nested) ? nested : root;
}

function readObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return value;
}

function readArrayFromObject(content: JsonValue | undefined, ...keys: readonly string[]): JsonArray {
  if (content === undefined) {
    return [];
  }

  if (Array.isArray(content)) {
    return content;
  }

  if (!isJsonObject(content)) {
    return [];
  }

  for (const key of keys) {
    const value = content[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function readNestedStringValue(value: JsonObject, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;

  for (const key of path) {
    if (current === undefined) {
      return undefined;
    }

    if (!isJsonObject(current)) {
      return undefined;
    }

    const nextValue: JsonValue | undefined = current[key];
    current = nextValue;
  }

  return current;
}

function readOptionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readOptionalPositiveInteger(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  return undefined;
}

function readOptionalPullRequestTarget(value: JsonValue | undefined): PullRequestTarget | undefined {
  if (value === 'develop' || value === 'main') {
    return value;
  }

  return undefined;
}

function readOptionalPullRequestStatus(value: JsonValue | undefined): PullRequestRef['status'] | undefined {
  if (value === 'draft' || value === 'open' || value === 'merged' || value === 'closed') {
    return value;
  }

  return undefined;
}

function readOptionalPullRequestCheckStatus(value: JsonValue | undefined): PullRequestCheckStatus | undefined {
  if (value === 'pending' || value === 'passed' || value === 'failed' || value === 'cancelled') {
    return value;
  }

  return undefined;
}

function deriveCheckStatus(summary: { readonly passedCount: number; readonly failedCount: number; readonly pendingCount: number }): PullRequestCheckStatus {
  if (summary.failedCount > 0) {
    return 'failed';
  }

  if (summary.pendingCount > 0 || summary.passedCount === 0) {
    return 'pending';
  }

  return 'passed';
}

function toRepositoryJson(repository: RepositoryRef): JsonObject {
  return {
    provider: repository.provider,
    owner: repository.owner,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    url: repository.url
  };
}

function toBranchJson(branch: BranchRef): JsonObject {
  return {
    repository: toRepositoryJson(branch.repository),
    name: branch.name,
    baseBranch: branch.baseBranch,
    ...(branch.headSha === undefined ? {} : { headSha: branch.headSha })
  };
}

function toPullRequestJson(pullRequest: PullRequestRef): JsonObject {
  return {
    provider: pullRequest.provider,
    repositoryOwner: pullRequest.repositoryOwner,
    repositoryName: pullRequest.repositoryName,
    number: pullRequest.number,
    title: pullRequest.title,
    sourceBranch: pullRequest.sourceBranch,
    targetBranch: pullRequest.targetBranch,
    url: pullRequest.url,
    status: pullRequest.status
  };
}
