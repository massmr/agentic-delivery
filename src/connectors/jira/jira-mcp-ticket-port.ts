import type { DeliveryTicket, TicketPriority } from '../../domain/ticket.js';
import type { JsonObject, JsonValue, McpClient, McpToolAllowlistRule, McpToolCallAuditRecord, McpToolCallExecutionResult } from '../../mcp/index.js';
import { callAllowedMcpTool, discoverMcpTools, isJsonObject, requireDiscoveredMcpTool } from '../../mcp/index.js';
import { assertValidJiraProjectKeys } from './jira-project-key-validation.js';
import type { JiraConnector } from './jira-connector.js';

const portName = 'TicketPort';

export class JiraMcpProjectKeyValidationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = 'JiraMcpProjectKeyValidationError';
    this.issues = issues;
  }
}
export interface JiraMcpToolNames {
  readonly listBacklog: string;
  readonly getTicket: string;
  readonly comment: string;
}

export type JiraMcpAuditSink = (records: readonly McpToolCallAuditRecord[]) => void;

export const defaultJiraMcpToolNames: JiraMcpToolNames = {
  listBacklog: 'searchJiraIssuesUsingJql',
  getTicket: 'getJiraIssue',
  comment: 'addCommentToJiraIssue'
} as const;

export interface JiraMcpTicketPortOptions {
  readonly client: McpClient;
  readonly serverId: string;
  readonly baseUrl: string;
  readonly projectKeys: readonly string[];
  readonly timeoutMs?: number | undefined;
  readonly toolNames?: Partial<JiraMcpToolNames> | undefined;
  readonly auditSink?: JiraMcpAuditSink | undefined;
}

export class JiraMcpTicketPort implements JiraConnector {
  private readonly auditSink: JiraMcpAuditSink | undefined;
  private readonly allowlist: readonly McpToolAllowlistRule[];
  private readonly baseUrl: string;
  private readonly client: McpClient;
  private readonly projectKeys: readonly string[];
  private readonly serverId: string;
  private readonly timeoutMs: number | undefined;
  private readonly toolNames: JiraMcpToolNames;

  constructor(options: JiraMcpTicketPortOptions) {
    assertValidJiraProjectKeys(options.projectKeys);

    this.client = options.client;
    this.serverId = options.serverId;
    this.baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.projectKeys = options.projectKeys;
    this.timeoutMs = options.timeoutMs;
    this.toolNames = { ...defaultJiraMcpToolNames, ...options.toolNames };
    this.auditSink = options.auditSink;
    this.allowlist = createJiraMcpToolRequirements(options.serverId, this.toolNames);
  }

  async listBacklog(): Promise<readonly DeliveryTicket[]> {
    const execution = await this.callJiraTool(this.toolNames.listBacklog, 'listBacklog', { jql: this.buildBacklogJql() });

    return extractIssueList(execution.result.content).map((issue) => this.toDeliveryTicket(issue));
  }

  async getTicket(key: string): Promise<DeliveryTicket> {
    const execution = await this.callJiraTool(this.toolNames.getTicket, 'getTicket', { issueKey: key });

    return this.toDeliveryTicket(extractIssue(execution.result.content));
  }

  async comment(key: string, body: string): Promise<void> {
    await this.callJiraTool(this.toolNames.comment, 'comment', { issueKey: key, comment: body });
  }

  private async callJiraTool(configuredToolName: string, action: 'listBacklog' | 'getTicket' | 'comment', argumentsObject: JsonObject): Promise<McpToolCallExecutionResult> {
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

  private buildBacklogJql(): string {
    return `project in (${this.projectKeys.join(', ')}) ORDER BY updated DESC`;
  }

  private toDeliveryTicket(issue: JsonObject): DeliveryTicket {
    const key = readString(issue.key, 'issue.key');
    const fields = readObject(issue.fields, 'issue.fields');

    return {
      ref: {
        provider: 'jira',
        key,
        url: `${this.baseUrl}/browse/${key}`
      },
      summary: readString(fields.summary, 'issue.fields.summary'),
      description: stringifyDescription(fields.description),
      status: readNamedValue(fields.status, 'issue.fields.status'),
      priority: toTicketPriority(readNamedValue(fields.priority, 'issue.fields.priority')),
      labels: readStringList(fields.labels, 'issue.fields.labels'),
      assignee: readOptionalNamedValue(fields.assignee),
      reporter: readOptionalNamedValue(fields.reporter),
      createdAt: readString(fields.created, 'issue.fields.created'),
      updatedAt: readString(fields.updated, 'issue.fields.updated')
    };
  }
  private recordAudit(records: readonly McpToolCallAuditRecord[]): void {
    if (records.length > 0) {
      this.auditSink?.(records);
    }
  }
}

export function createJiraMcpToolRequirements(serverId: string, toolNames: Partial<JiraMcpToolNames> = {}): readonly McpToolAllowlistRule[] {
  const resolvedToolNames: JiraMcpToolNames = { ...defaultJiraMcpToolNames, ...toolNames };

  return [
    { serverId, toolName: resolvedToolNames.listBacklog, port: portName, action: 'listBacklog', safety: 'read' },
    { serverId, toolName: resolvedToolNames.getTicket, port: portName, action: 'getTicket', safety: 'read' },
    { serverId, toolName: resolvedToolNames.comment, port: portName, action: 'comment', safety: 'write' }
  ];
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

function extractIssueList(content: JsonValue): readonly JsonObject[] {
  if (Array.isArray(content)) {
    return content.map((entry, index) => readObject(entry, `content[${index}]`));
  }

  const root = readObject(content, 'content');
  const issues = root.issues;

  if (!Array.isArray(issues)) {
    throw new Error('Jira MCP backlog response must include an issues array.');
  }

  return issues.map((entry, index) => readObject(entry, `content.issues[${index}]`));
}

function extractIssue(content: JsonValue): JsonObject {
  const root = readObject(content, 'content');
  return root.issue !== undefined && isJsonObject(root.issue) ? root.issue : root;
}

function stringifyDescription(value: JsonValue | undefined): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value !== undefined && isJsonObject(value) && typeof value.text === 'string') {
    return value.text;
  }

  if (value === undefined || value === null) {
    return '';
  }

  return JSON.stringify(value);
}

function readNamedValue(value: JsonValue | undefined, path: string): string {
  if (typeof value === 'string') {
    return value;
  }

  const object = readObject(value, path);
  return readString(object.name, `${path}.name`);
}

function readOptionalNamedValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (isJsonObject(value) && typeof value.displayName === 'string') {
    return value.displayName;
  }

  if (isJsonObject(value) && typeof value.name === 'string') {
    return value.name;
  }

  return undefined;
}

function readStringList(value: JsonValue | undefined, path: string): readonly string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of strings.`);
  }

  return value.map((entry, index) => readString(entry, `${path}[${index}]`));
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

function toTicketPriority(value: string): TicketPriority {
  const normalized = value.toLowerCase();

  if (normalized === 'lowest' || normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'highest') {
    return normalized;
  }

  return 'medium';
}
