import type { DeploymentEnvironment, DeploymentRef, DeploymentResult, DeploymentStatus, RepositoryRef, SmokeCheckResult } from '../../domain/index.js';
import type { JsonObject, JsonValue, McpClient, McpToolAllowlistRule, McpToolCallAuditRecord, McpToolCallExecutionResult } from '../../mcp/index.js';
import { callAllowedMcpTool, discoverMcpTools, isJsonObject, requireDiscoveredMcpTool } from '../../mcp/index.js';
import type { DeploymentPort, ReadDeploymentInput, ServiceUrlInput, WaitForDeploymentInput } from '../../ports/index.js';
import type { RailwayConnector } from './railway-connector.js';

const portName = 'DeploymentPort';

export interface RailwayMcpToolNames {
  readonly waitForDeployment: string;
  readonly readDeployment: string;
  readonly getServiceUrl: string;
}

export type RailwayMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;

export const defaultRailwayMcpToolNames: RailwayMcpToolNames = {
  waitForDeployment: 'waitForRailwayDeployment',
  readDeployment: 'getRailwayDeployment',
  getServiceUrl: 'getRailwayServiceUrl'
} as const;

export interface RailwayMcpDeploymentPortOptions {
  readonly client: McpClient;
  readonly serverId: string;
  readonly timeoutMs?: number | undefined;
  readonly toolNames?: Partial<RailwayMcpToolNames> | undefined;
  readonly auditSink?: RailwayMcpAuditSink | undefined;
}

export class RailwayMcpDeploymentPort implements RailwayConnector, DeploymentPort {
  private readonly allowlist: readonly McpToolAllowlistRule[];
  private readonly auditSink: RailwayMcpAuditSink | undefined;
  private readonly client: McpClient;
  private readonly serverId: string;
  private readonly timeoutMs: number | undefined;
  private readonly toolNames: RailwayMcpToolNames;

  constructor(options: RailwayMcpDeploymentPortOptions) {
    this.client = options.client;
    this.serverId = options.serverId;
    this.timeoutMs = options.timeoutMs;
    this.toolNames = { ...defaultRailwayMcpToolNames, ...options.toolNames };
    this.auditSink = options.auditSink;
    this.allowlist = createRailwayMcpAllowlist(options.serverId, this.toolNames);
  }

  async waitForDeployment(input: WaitForDeploymentInput): Promise<DeploymentResult> {
    const execution = await this.callRailwayTool(this.toolNames.waitForDeployment, 'waitForDeployment', {
      repository: toRepositoryJson(input.repository),
      branch: input.branch,
      commitSha: input.commitSha,
      environment: input.environment
    });

    return readDeploymentResult(execution.result.content);
  }

  async readDeployment(input: ReadDeploymentInput): Promise<DeploymentResult> {
    const execution = await this.callRailwayTool(this.toolNames.readDeployment, 'readDeployment', {
      ref: toDeploymentRefJson(input.ref)
    });

    return readDeploymentResult(execution.result.content);
  }

  async getServiceUrl(input: ServiceUrlInput): Promise<string> {
    const execution = await this.callRailwayTool(this.toolNames.getServiceUrl, 'getServiceUrl', {
      ref: toDeploymentRefJson(input.ref)
    });

    return readServiceUrl(execution.result.content);
  }

  private async callRailwayTool(configuredToolName: string, action: 'waitForDeployment' | 'readDeployment' | 'getServiceUrl', argumentsObject: JsonObject): Promise<McpToolCallExecutionResult> {
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

function createRailwayMcpAllowlist(serverId: string, toolNames: RailwayMcpToolNames): readonly McpToolAllowlistRule[] {
  return [
    { serverId, toolName: toolNames.waitForDeployment, port: portName, action: 'waitForDeployment', safety: 'read' },
    { serverId, toolName: toolNames.readDeployment, port: portName, action: 'readDeployment', safety: 'read' },
    { serverId, toolName: toolNames.getServiceUrl, port: portName, action: 'getServiceUrl', safety: 'read' }
  ];
}

function readDeploymentResult(content: JsonValue | undefined): DeploymentResult {
  const deployment = unwrapObject(content, 'content', 'deployment');
  const refSource = deployment.ref ?? deployment.deploymentRef ?? deployment;

  return {
    ref: readDeploymentRef(refSource),
    status: readDeploymentStatus(deployment.status ?? deployment.deploymentStatus),
    branch: readString(deployment.branch ?? deployment.branchName, 'content.deployment.branch'),
    commitSha: readString(deployment.commitSha ?? deployment.commit_sha, 'content.deployment.commitSha'),
    serviceUrl: readString(deployment.serviceUrl ?? deployment.service_url, 'content.deployment.serviceUrl'),
    smokeChecks: readSmokeChecks(deployment.smokeChecks ?? deployment.smoke_checks),
    startedAt: readString(deployment.startedAt ?? deployment.started_at, 'content.deployment.startedAt'),
    ...(deployment.finishedAt === undefined && deployment.finished_at === undefined ? {} : { finishedAt: readString(deployment.finishedAt ?? deployment.finished_at, 'content.deployment.finishedAt') }),
    summary: readString(deployment.summary, 'content.deployment.summary')
  };
}

function readDeploymentRef(value: JsonValue | undefined): DeploymentRef {
  const ref = readObject(value, 'content.deployment.ref');

  return {
    provider: 'railway',
    projectId: readString(ref.projectId ?? ref.project_id, 'content.deployment.ref.projectId'),
    serviceId: readString(ref.serviceId ?? ref.service_id, 'content.deployment.ref.serviceId'),
    deploymentId: readString(ref.deploymentId ?? ref.deployment_id, 'content.deployment.ref.deploymentId'),
    environment: readDeploymentEnvironment(ref.environment ?? ref.deploymentEnvironment)
  };
}

function readSmokeChecks(value: JsonValue | undefined): readonly SmokeCheckResult[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('content.deployment.smokeChecks must be an array when provided.');
  }

  return value.map((entry, index) => {
    const check = readObject(entry, `content.deployment.smokeChecks[${index}]`);

    return {
      url: readString(check.url, `content.deployment.smokeChecks[${index}].url`),
      status: readSmokeCheckStatus(check.status),
      ...(check.statusCode === undefined ? {} : { statusCode: readPositiveInteger(check.statusCode, `content.deployment.smokeChecks[${index}].statusCode`) }),
      summary: readString(check.summary, `content.deployment.smokeChecks[${index}].summary`)
    };
  });
}

function readServiceUrl(content: JsonValue | undefined): string {
  const deployment = unwrapObject(content, 'content', 'deployment');
  const value = deployment.serviceUrl ?? deployment.service_url;

  return readString(value, 'content.deployment.serviceUrl');
}

function readDeploymentStatus(value: JsonValue | undefined): DeploymentStatus {
  if (value === 'pending' || value === 'deploying' || value === 'success' || value === 'failed' || value === 'cancelled') {
    return value;
  }

  throw new Error('content.deployment.status must be one of pending, deploying, success, failed, or cancelled.');
}

function readDeploymentEnvironment(value: JsonValue | undefined): DeploymentEnvironment {
  if (value === 'staging' || value === 'production') {
    return value;
  }

  throw new Error('content.deployment.ref.environment must be staging or production.');
}

function readSmokeCheckStatus(value: JsonValue | undefined): SmokeCheckResult['status'] {
  if (value === 'passed' || value === 'failed' || value === 'skipped') {
    return value;
  }

  throw new Error('content.deployment.smokeChecks[].status must be passed, failed, or skipped.');
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

function readString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function readPositiveInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(`${path} must be a non-negative integer.`);
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

function toDeploymentRefJson(ref: DeploymentRef): JsonObject {
  return {
    provider: ref.provider,
    projectId: ref.projectId,
    serviceId: ref.serviceId,
    deploymentId: ref.deploymentId,
    environment: ref.environment
  };
}
