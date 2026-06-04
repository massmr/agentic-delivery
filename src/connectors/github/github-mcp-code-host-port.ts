import type { BranchRef, PullRequestCheckStatus, PullRequestCheckSummary, PullRequestRef, PullRequestTarget, RepositoryRef } from '../../domain/index.js';
import type { JsonObject, JsonValue, McpClient, McpToolAllowlistRule, McpToolCallAuditRecord, McpToolCallExecutionResult } from '../../mcp/index.js';
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
  readonly createBranch: string;
  readonly openPullRequest: string;
  readonly getChecks: string;
  readonly commentOnPullRequest: string;
}

export type GitHubMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;

export const defaultGitHubMcpToolNames: GitHubMcpToolNames = {
  createBranch: 'createGitHubBranch',
  openPullRequest: 'openGitHubPullRequest',
  getChecks: 'getGitHubChecks',
  commentOnPullRequest: 'commentOnGitHubPullRequest'
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
    const execution = await this.callGitHubTool(this.toolNames.createBranch, 'createBranch', {
      repository: toRepositoryJson(input.repository),
      branch: toBranchJson(input.branch)
    });

    return readBranchRef(execution.result.content, input.branch);
  }

  async pushBranch(input: PushCodeHostBranchInput): Promise<BranchRef> {
    throw new GitHubMcpPushBranchUnsupportedError(input.repository.owner, input.repository.name, input.branch.name);
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    const execution = await this.callGitHubTool(this.toolNames.openPullRequest, 'openPullRequest', {
      repository: toRepositoryJson(input.repository),
      title: input.title,
      body: input.body,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch
    });

    return readPullRequestRef(execution.result.content, input);
  }

  async getChecks(input: ChecksInput): Promise<PullRequestCheckSummary> {
    const execution = await this.callGitHubTool(this.toolNames.getChecks, 'getChecks', {
      repository: toRepositoryJson(input.repository),
      branchName: input.branchName
    });

    return readCheckSummary(execution.result.content);
  }

  async commentOnPullRequest(input: PullRequestCommentInput): Promise<void> {
    await this.callGitHubTool(this.toolNames.commentOnPullRequest, 'commentOnPullRequest', {
      pullRequest: toPullRequestJson(input.pullRequest),
      body: input.body
    });
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
    { serverId, toolName: resolvedToolNames.createBranch, port: portName, action: 'createBranch', safety: 'write' },
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
    name: readOptionalString(branch.name) ?? fallback.name,
    baseBranch: readOptionalString(branch.baseBranch ?? branch.base_branch) ?? fallback.baseBranch,
    headSha: readOptionalString(branch.headSha ?? branch.head_sha) ?? fallback.headSha
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
    sourceBranch: readOptionalString(pullRequest.sourceBranch ?? pullRequest.source_branch) ?? input.sourceBranch,
    targetBranch: readOptionalPullRequestTarget(pullRequest.targetBranch ?? pullRequest.target_branch) ?? input.targetBranch,
    url: readOptionalString(pullRequest.url) ?? `https://github.com/${input.repository.owner}/${input.repository.name}/pull/${number}`,
    status: readOptionalPullRequestStatus(pullRequest.status) ?? 'open'
  };
}

function readCheckSummary(content: JsonValue | undefined): PullRequestCheckSummary {
  const summary = unwrapObject(content, 'content', 'checks');
  const passedCount = readOptionalPositiveInteger(summary.passedCount ?? summary.passed_count) ?? 0;
  const failedCount = readOptionalPositiveInteger(summary.failedCount ?? summary.failed_count) ?? 0;
  const pendingCount = readOptionalPositiveInteger(summary.pendingCount ?? summary.pending_count) ?? 0;
  const totalCount = readOptionalPositiveInteger(summary.totalCount ?? summary.total_count) ?? passedCount + failedCount + pendingCount;

  return {
    status: readOptionalPullRequestCheckStatus(summary.status) ?? deriveCheckStatus({ passedCount, failedCount, pendingCount }),
    totalCount,
    passedCount,
    failedCount,
    pendingCount
  };
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
