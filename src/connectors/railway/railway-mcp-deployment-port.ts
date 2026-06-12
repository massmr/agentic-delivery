import type { DeploymentEnvironment, DeploymentRef, DeploymentResult, DeploymentStatus, RailwayDeploymentMapping, SmokeCheckResult } from '../../domain/index.js';
import type { JsonObject, JsonValue, McpClient, McpToolAllowlistRule, McpToolCallAuditRecord, McpToolCallExecutionResult } from '../../mcp/index.js';
import { callAllowedMcpTool, discoverMcpTools, isJsonObject, requireDiscoveredMcpTool } from '../../mcp/index.js';
import type { DeploymentPort, ReadDeploymentInput, ServiceUrlInput, WaitForDeploymentInput } from '../../ports/index.js';
import type { RailwayConnector } from './railway-connector.js';

const portName = 'DeploymentPort';
const defaultWaitMaxAttempts = 120;
const defaultWaitPollIntervalMs = 5000;
const missingRequestedDeploymentMessage = 'content.deployments must include the requested Railway deployment.';

type RailwayMcpAction = 'waitForDeployment' | 'readDeployment' | 'getServiceUrl' | 'listProjects' | 'listServices' | 'getServiceConfig';

const defaultRailwayWaitSleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export interface RailwayMcpToolNames {
  readonly waitForDeployment: string;
  readonly readDeployment: string;
  readonly getServiceUrl: string;
  readonly environmentStatus: string;
  readonly listDeployments: string;
  readonly listProjects: string;
  readonly listServices: string;
  readonly getServiceConfig: string;
  readonly getLogs: string;
  readonly serviceMetrics: string;
}

export type RailwayMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;

export const defaultRailwayMcpToolNames: RailwayMcpToolNames = {
  waitForDeployment: 'list_deployments',
  readDeployment: 'list_deployments',
  getServiceUrl: '',
  environmentStatus: 'environment_status',
  listDeployments: 'list_deployments',
  listProjects: 'list_projects',
  listServices: 'list_services',
  getServiceConfig: 'get_service_config',
  getLogs: 'get_logs',
  serviceMetrics: 'service_metrics'
} as const;

export interface RailwayMcpDeploymentPortOptions {
  readonly client: McpClient;
  readonly serverId: string;
  readonly timeoutMs?: number | undefined;
  readonly waitMaxAttempts?: number | undefined;
  readonly waitPollIntervalMs?: number | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly toolNames?: Partial<RailwayMcpToolNames> | undefined;
  readonly auditSink?: RailwayMcpAuditSink | undefined;
}

export class RailwayMcpDeploymentPort implements RailwayConnector, DeploymentPort {
  private readonly allowlist: readonly McpToolAllowlistRule[];
  private readonly auditSink: RailwayMcpAuditSink | undefined;
  private readonly client: McpClient;
  private readonly serverId: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number | undefined;
  private readonly toolNames: RailwayMcpToolNames;
  private readonly waitMaxAttempts: number;
  private readonly waitPollIntervalMs: number;

  constructor(options: RailwayMcpDeploymentPortOptions) {
    this.client = options.client;
    this.serverId = options.serverId;
    this.sleep = options.sleep ?? defaultRailwayWaitSleep;
    this.timeoutMs = options.timeoutMs;
    this.waitMaxAttempts = readPositiveIntegerOption(options.waitMaxAttempts, defaultWaitMaxAttempts, 'waitMaxAttempts');
    this.waitPollIntervalMs = readNonNegativeIntegerOption(options.waitPollIntervalMs, defaultWaitPollIntervalMs, 'waitPollIntervalMs');
    this.toolNames = { ...defaultRailwayMcpToolNames, ...options.toolNames };
    this.auditSink = options.auditSink;
    this.allowlist = createRailwayMcpToolRequirements(options.serverId, this.toolNames);
  }

  async waitForDeployment(input: WaitForDeploymentInput): Promise<DeploymentResult> {
    const selector = buildDeploymentResultSelector(input);
    let lastObservation = 'No matching Railway deployment was found.';

    for (let attempt = 1; attempt <= this.waitMaxAttempts; attempt += 1) {
      await this.callRailwayTool(this.toolNames.environmentStatus, 'waitForDeployment', buildRailwayMcpArguments(input.mapping, { includeService: false }));

      const execution = await this.callRailwayTool(this.toolNames.waitForDeployment, 'waitForDeployment', {
        ...buildRailwayMcpArguments(input.mapping, { includeService: true }),
        limit: 25
      });

      const deployment = readDeploymentResultForWait(execution.result.content, selector);
      if (deployment !== undefined) {
        assertMatchingDeploymentWaitResult(deployment, input);
        const mappedDeployment = withDeploymentMapping(deployment, input.mapping);

        if (isTerminalDeploymentStatus(mappedDeployment.status)) {
          return mappedDeployment;
        }

        lastObservation = `Last status: ${mappedDeployment.status}.`;
      }

      if (attempt < this.waitMaxAttempts) {
        await this.sleep(this.waitPollIntervalMs);
      }
    }

    throw new Error(buildDeploymentPollingTimeoutMessage(input, this.waitMaxAttempts, lastObservation));
  }

  async readDeployment(input: ReadDeploymentInput): Promise<DeploymentResult> {
    const execution = await this.callRailwayTool(this.toolNames.readDeployment, 'readDeployment', {
      project_id: input.ref.projectId,
      ...(input.ref.environmentId === undefined ? {} : { environment_id: input.ref.environmentId }),
      service_id: input.ref.serviceId,
      limit: 25
    });

    const deployment = readDeploymentResult(execution.result.content, input.ref);
    assertMatchingDeploymentRef(deployment.ref, input.ref);
    return withDeploymentMapping(deployment, input.mapping);
  }

  async getServiceUrl(input: ServiceUrlInput): Promise<string> {
    if (this.toolNames.getServiceUrl.trim().length === 0) {
      throw new Error('Railway MCP service URL lookup is not configured. Configure repository staging service URLs or set railway.mcp_tools.get_service_url to a safe read-only tool that returns a service URL.');
    }

    const environmentId = input.mapping?.environmentId ?? input.ref.environmentId;
    const execution = await this.callRailwayTool(this.toolNames.getServiceUrl, 'getServiceUrl', {
      project_id: input.ref.projectId,
      ...(environmentId === undefined ? {} : { environment_id: environmentId }),
      service_id: input.ref.serviceId
    });

    return assertHttpServiceUrl(readServiceUrl(execution.result.content));
  }

  private async callRailwayTool(configuredToolName: string, action: RailwayMcpAction, argumentsObject: JsonObject): Promise<McpToolCallExecutionResult> {
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

export function createRailwayMcpToolRequirements(serverId: string, toolNames: Partial<RailwayMcpToolNames> = {}): readonly McpToolAllowlistRule[] {
  const resolvedToolNames: RailwayMcpToolNames = { ...defaultRailwayMcpToolNames, ...toolNames };
  const requirements: McpToolAllowlistRule[] = [
    { serverId, toolName: resolvedToolNames.environmentStatus, port: portName, action: 'waitForDeployment', safety: 'read' },
    { serverId, toolName: resolvedToolNames.waitForDeployment, port: portName, action: 'waitForDeployment', safety: 'read' },
    { serverId, toolName: resolvedToolNames.readDeployment, port: portName, action: 'readDeployment', safety: 'read' },
    { serverId, toolName: resolvedToolNames.listProjects, port: portName, action: 'listProjects', safety: 'read' },
    { serverId, toolName: resolvedToolNames.listServices, port: portName, action: 'listServices', safety: 'read' },
    { serverId, toolName: resolvedToolNames.getServiceConfig, port: portName, action: 'getServiceConfig', safety: 'read' }
  ];

  if (resolvedToolNames.getServiceUrl.trim().length !== 0) {
    requirements.push({ serverId, toolName: resolvedToolNames.getServiceUrl, port: portName, action: 'getServiceUrl', safety: 'read' });
  }

  return requirements;
}

function buildRailwayMcpArguments(mapping: RailwayDeploymentMapping | undefined, options: { readonly includeService: boolean }): JsonObject {
  if (mapping === undefined) {
    return {};
  }

  return {
    ...(mapping.projectId === undefined ? {} : { project_id: mapping.projectId }),
    ...(mapping.environmentId === undefined ? {} : { environment_id: mapping.environmentId }),
    ...(!options.includeService || mapping.serviceId === undefined ? {} : { service_id: mapping.serviceId })
  };
}

function withDeploymentMapping(deployment: DeploymentResult, mapping: RailwayDeploymentMapping | undefined): DeploymentResult {
  if (mapping === undefined) {
    return deployment;
  }

  return {
    ...deployment,
    ref: {
      ...deployment.ref,
      ...(mapping.environmentId === undefined ? {} : { environmentId: mapping.environmentId })
    },
    mapping
  };
}

function buildDeploymentResultSelector(input: WaitForDeploymentInput): DeploymentResultSelector {
  return {
    branch: input.branch,
    commitSha: input.commitSha,
    environment: input.environment,
    projectId: input.mapping?.projectId,
    environmentId: input.mapping?.environmentId,
    serviceId: input.mapping?.serviceId
  };
}

function readDeploymentResultForWait(content: JsonValue | undefined, selector: DeploymentResultSelector): DeploymentResult | undefined {
  try {
    return readDeploymentResult(content, selector);
  } catch (error) {
    if (isMissingRequestedDeploymentError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissingRequestedDeploymentError(error: unknown): boolean {
  return error instanceof Error && error.message === missingRequestedDeploymentMessage;
}

function isTerminalDeploymentStatus(status: DeploymentStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

function buildDeploymentPollingTimeoutMessage(input: WaitForDeploymentInput, attempts: number, lastObservation: string): string {
  return [
    `Railway deployment polling timed out after ${attempts} attempt(s) for ${input.repository.owner}/${input.repository.name} branch ${input.branch} commit ${input.commitSha}.`,
    `Environment: ${input.environment}.`,
    `Railway mapping: ${formatRailwayMapping(input.mapping)}.`,
    lastObservation
  ].join(' ');
}

function formatRailwayMapping(mapping: RailwayDeploymentMapping | undefined): string {
  if (mapping === undefined) {
    return 'not configured';
  }

  return [
    `project_id=${mapping.projectId ?? 'missing'}`,
    `environment_id=${mapping.environmentId ?? 'missing'}`,
    `service_id=${mapping.serviceId ?? 'missing'}`
  ].join(', ');
}

type DeploymentResultSelector = DeploymentRef | {
  readonly branch: string;
  readonly commitSha: string;
  readonly environment: DeploymentEnvironment;
  readonly projectId?: string | undefined;
  readonly environmentId?: string | undefined;
  readonly serviceId?: string | undefined;
};

function readDeploymentResult(content: JsonValue | undefined, selector?: DeploymentResultSelector): DeploymentResult {
  const deployment = readDeploymentObject(content, selector);
  const refSource = deployment.ref ?? deployment.deploymentRef ?? deployment;

  return {
    ref: readDeploymentRef(refSource),
    status: readDeploymentStatus(deployment.status ?? deployment.deploymentStatus),
    branch: readString(deployment.branch ?? deployment.branchName, 'content.deployment.branch'),
    commitSha: readString(deployment.commitSha ?? deployment.commit_sha, 'content.deployment.commitSha'),
    serviceUrl: readOptionalString(deployment.serviceUrl ?? deployment.service_url, 'content.deployment.serviceUrl') ?? 'unavailable',
    smokeChecks: readSmokeChecks(deployment.smokeChecks ?? deployment.smoke_checks),
    startedAt: readString(deployment.startedAt ?? deployment.started_at, 'content.deployment.startedAt'),
    ...(deployment.finishedAt === undefined && deployment.finished_at === undefined ? {} : { finishedAt: readString(deployment.finishedAt ?? deployment.finished_at, 'content.deployment.finishedAt') }),
    summary: readString(deployment.summary, 'content.deployment.summary')
  };
}

function readDeploymentObject(content: JsonValue | undefined, selector: DeploymentResultSelector | undefined): JsonObject {
  const root = readObject(normalizeRailwayMcpContent(content, selector), 'content');

  if (root.deployment !== undefined) {
    return readObject(root.deployment, 'content.deployment');
  }

  if (Array.isArray(root.deployments)) {
    const deployments = root.deployments.map((entry, index) => readObject(entry, `content.deployments[${index}]`));
    const selected = selector === undefined ? deployments[0] : deployments.find((deployment) => deploymentMatchesSelector(deployment, selector));

    if (selected !== undefined) {
      return selected;
    }

    throw new Error(missingRequestedDeploymentMessage);
  }

  throw new Error('content.deployment must be an object, or content.deployments must be an array.');
}

function normalizeRailwayMcpContent(content: JsonValue | undefined, selector: DeploymentResultSelector | undefined): JsonValue | undefined {
  if (typeof content === 'string') {
    return parseRailwayTextContent(content, selector) ?? content;
  }

  if (Array.isArray(content)) {
    const text = content.map(readMcpTextContent).filter((value): value is string => value !== undefined).join('\n').trim();
    if (text.length > 0) {
      return parseRailwayTextContent(text, selector) ?? text;
    }

    return { deployments: content };
  }

  if (content !== undefined && isJsonObject(content)) {
    const nestedContent = content.content;
    if (nestedContent !== undefined && nestedContent !== content) {
      const normalized = normalizeRailwayMcpContent(nestedContent, selector);
      if (normalized !== undefined && normalized !== nestedContent) {
        return normalized;
      }
    }
  }

  return content;
}

function readMcpTextContent(value: JsonValue): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!isJsonObject(value) || value.type !== 'text' || typeof value.text !== 'string') {
    return undefined;
  }

  return value.text;
}

function parseRailwayTextContent(text: string, selector: DeploymentResultSelector | undefined): JsonObject | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    return isJsonObject(parsed) ? parsed : { deployments: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (error) {
    void error;
  }

  const deployments = parseRailwayDeploymentTable(trimmed, selector);
  return deployments.length === 0 ? undefined : { deployments };
}

function parseRailwayDeploymentTable(text: string, selector: DeploymentResultSelector | undefined): readonly JsonObject[] {
  return text
    .split(/\r?\n/u)
    .map((line) => parseRailwayDeploymentTableLine(line, selector))
    .filter((deployment): deployment is JsonObject => deployment !== undefined);
}

function parseRailwayDeploymentTableLine(line: string, selector: DeploymentResultSelector | undefined): JsonObject | undefined {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length < 4 || !isUuidLike(parts[0])) {
    return undefined;
  }

  const [deploymentId, rawStatus, startedAt, commitSha] = parts;
  const environment = selector === undefined ? 'staging' : readSelectorEnvironment(selector);

  return {
    ref: {
      provider: 'railway',
      projectId: readSelectorProjectId(selector),
      ...(readSelectorEnvironmentId(selector) === undefined ? {} : { environmentId: readSelectorEnvironmentId(selector) }),
      serviceId: readSelectorServiceId(selector),
      deploymentId,
      environment
    },
    status: normalizeRailwayDeploymentStatus(rawStatus),
    branch: readSelectorBranch(selector),
    commitSha,
    serviceUrl: 'unavailable',
    smokeChecks: [],
    startedAt,
    summary: `Railway deployment ${deploymentId} returned by text deployment list.`
  };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function readSelectorProjectId(selector: DeploymentResultSelector | undefined): string {
  if (selector === undefined) {
    return 'unknown-project';
  }

  return 'deploymentId' in selector ? selector.projectId : selector.projectId ?? 'unknown-project';
}

function readSelectorEnvironmentId(selector: DeploymentResultSelector | undefined): string | undefined {
  if (selector === undefined) {
    return undefined;
  }

  return 'deploymentId' in selector ? selector.environmentId : selector.environmentId;
}

function readSelectorServiceId(selector: DeploymentResultSelector | undefined): string {
  if (selector === undefined) {
    return 'unknown-service';
  }

  return 'deploymentId' in selector ? selector.serviceId : selector.serviceId ?? 'unknown-service';
}

function readSelectorEnvironment(selector: DeploymentResultSelector): DeploymentEnvironment {
  return 'deploymentId' in selector ? selector.environment : selector.environment;
}

function readSelectorBranch(selector: DeploymentResultSelector | undefined): string {
  if (selector === undefined || 'deploymentId' in selector) {
    return 'unknown';
  }

  return selector.branch;
}

function normalizeRailwayDeploymentStatus(status: string): DeploymentStatus {
  const normalized = status.trim().toUpperCase();

  if (normalized === 'SUCCESS' || normalized === 'SUCCEEDED') {
    return 'success';
  }

  if (normalized === 'FAILED' || normalized === 'FAILURE' || normalized === 'CRASHED') {
    return 'failed';
  }

  if (normalized === 'REMOVED' || normalized === 'CANCELED' || normalized === 'CANCELLED') {
    return 'cancelled';
  }

  if (normalized === 'BUILDING' || normalized === 'DEPLOYING' || normalized === 'ROLLING_OUT') {
    return 'deploying';
  }

  return 'pending';
}

function deploymentMatchesSelector(deployment: JsonObject, selector: DeploymentResultSelector): boolean {
  const refSource = deployment.ref ?? deployment.deploymentRef ?? deployment;
  const branch = readOptionalString(deployment.branch ?? deployment.branchName, 'content.deployments[].branch');
  const commitSha = readOptionalString(deployment.commitSha ?? deployment.commit_sha, 'content.deployments[].commitSha');

  if ('deploymentId' in selector) {
    const ref = readDeploymentRef(refSource);
    return ref.projectId === selector.projectId && ref.serviceId === selector.serviceId && ref.deploymentId === selector.deploymentId && ref.environment === selector.environment;
  }

  const environment = readDeploymentRef(refSource).environment;
  return branch === selector.branch && commitSha === selector.commitSha && environment === selector.environment;
}

function readDeploymentRef(value: JsonValue | undefined): DeploymentRef {
  const ref = readObject(value, 'content.deployment.ref');

  return {
    provider: 'railway',
    projectId: readString(ref.projectId ?? ref.project_id, 'content.deployment.ref.projectId'),
    ...(ref.environmentId === undefined && ref.environment_id === undefined ? {} : { environmentId: readString(ref.environmentId ?? ref.environment_id, 'content.deployment.ref.environmentId') }),
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
  const root = readObject(content, 'content');
  const source = readServiceUrlSource(root);
  const value = source.serviceUrl ?? source.service_url ?? source.url;

  return readString(value, 'content.serviceUrl');
}

function readServiceUrlSource(root: JsonObject): JsonObject {
  for (const key of ['deployment', 'service', 'config', 'serviceConfig', 'service_config']) {
    const value = root[key];

    if (value !== undefined) {
      return readObject(value, `content.${key}`);
    }
  }

  return root;
}

function assertMatchingDeploymentWaitResult(deployment: DeploymentResult, input: WaitForDeploymentInput): void {
  if (deployment.branch !== input.branch) {
    throw new Error(`Railway MCP deployment result branch ${deployment.branch} does not match requested branch ${input.branch}.`);
  }

  if (deployment.commitSha !== input.commitSha) {
    throw new Error(`Railway MCP deployment result commit ${deployment.commitSha} does not match requested commit ${input.commitSha}.`);
  }

  if (deployment.ref.environment !== input.environment) {
    throw new Error(`Railway MCP deployment result environment ${deployment.ref.environment} does not match requested environment ${input.environment}.`);
  }

  if (input.mapping?.projectId !== undefined && deployment.ref.projectId !== input.mapping.projectId) {
    throw new Error(`Railway MCP deployment result projectId ${deployment.ref.projectId} does not match repository mapping projectId ${input.mapping.projectId}.`);
  }

  if (input.mapping?.serviceId !== undefined && deployment.ref.serviceId !== input.mapping.serviceId) {
    throw new Error(`Railway MCP deployment result serviceId ${deployment.ref.serviceId} does not match repository mapping serviceId ${input.mapping.serviceId}.`);
  }

  if (input.mapping?.environmentId !== undefined && deployment.ref.environmentId !== undefined && deployment.ref.environmentId !== input.mapping.environmentId) {
    throw new Error(`Railway MCP deployment result environmentId ${deployment.ref.environmentId} does not match repository mapping environmentId ${input.mapping.environmentId}.`);
  }
}

function assertMatchingDeploymentRef(actual: DeploymentRef, expected: DeploymentRef): void {
  if (actual.projectId !== expected.projectId) {
    throw new Error(`Railway MCP deployment ref projectId ${actual.projectId} does not match requested projectId ${expected.projectId}.`);
  }

  if (actual.serviceId !== expected.serviceId) {
    throw new Error(`Railway MCP deployment ref serviceId ${actual.serviceId} does not match requested serviceId ${expected.serviceId}.`);
  }

  if (expected.environmentId !== undefined && actual.environmentId !== expected.environmentId) {
    throw new Error(`Railway MCP deployment ref environmentId ${actual.environmentId ?? 'missing'} does not match requested environmentId ${expected.environmentId}.`);
  }

  if (actual.deploymentId !== expected.deploymentId) {
    throw new Error(`Railway MCP deployment ref deploymentId ${actual.deploymentId} does not match requested deploymentId ${expected.deploymentId}.`);
  }

  if (actual.environment !== expected.environment) {
    throw new Error(`Railway MCP deployment ref environment ${actual.environment} does not match requested environment ${expected.environment}.`);
  }
}

function assertHttpServiceUrl(serviceUrl: string): string {
  const url = parseServiceUrl(serviceUrl);

  if (url !== undefined && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return serviceUrl;
  }

  throw new Error('content.deployment.serviceUrl must be an HTTP(S) URL.');
}

function parseServiceUrl(serviceUrl: string): URL | undefined {
  try {
    return new URL(serviceUrl);
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }
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

function readOptionalString(value: JsonValue | undefined, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readString(value, path);
}

function readPositiveInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(`${path} must be a non-negative integer.`);
}

function readPositiveIntegerOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new Error(`Railway MCP ${name} must be a positive integer.`);
}

function readNonNegativeIntegerOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(`Railway MCP ${name} must be a non-negative integer.`);
}
