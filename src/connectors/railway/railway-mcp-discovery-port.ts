import type { JsonObject, JsonValue, McpClient, McpToolAllowlistRule, McpToolCallAuditRecord, McpToolCallExecutionResult } from '../../mcp/index.js';
import { callAllowedMcpTool, discoverMcpTools, isJsonObject, requireDiscoveredMcpTool } from '../../mcp/index.js';
import { defaultRailwayMcpToolNames, type RailwayMcpAuditSink, type RailwayMcpToolNames } from './railway-mcp-deployment-port.js';

const discoveryPortName = 'RailwayDiscoveryPort';
type RailwayDiscoveryMcpAction = 'listProjects' | 'listServices' | 'getServiceConfig';

export interface RailwayDiscoveryProject {
  readonly id: string;
  readonly name: string;
}

export interface RailwayDiscoveryService {
  readonly id: string;
  readonly name: string;
  readonly projectId?: string | undefined;
  readonly projectName?: string | undefined;
  readonly environmentId?: string | undefined;
  readonly environmentName?: string | undefined;
  readonly branch?: string | undefined;
}

export interface RailwayDiscoverySnapshot {
  readonly projects: readonly RailwayDiscoveryProject[];
  readonly services: readonly RailwayDiscoveryService[];
}

export interface RailwayDiscoveryPort {
  discover(): Promise<RailwayDiscoverySnapshot>;
}

export interface RailwayMcpDiscoveryPortOptions {
  readonly client: McpClient;
  readonly serverId: string;
  readonly timeoutMs?: number | undefined;
  readonly toolNames?: Pick<Partial<RailwayMcpToolNames>, 'listProjects' | 'listServices' | 'getServiceConfig'> | undefined;
  readonly auditSink?: RailwayMcpAuditSink | undefined;
}

export class RailwayMcpDiscoveryPort implements RailwayDiscoveryPort {
  private readonly allowlist: readonly McpToolAllowlistRule[];
  private readonly auditSink: RailwayMcpAuditSink | undefined;
  private readonly client: McpClient;
  private readonly serverId: string;
  private readonly timeoutMs: number | undefined;
  private readonly toolNames: Pick<RailwayMcpToolNames, 'listProjects' | 'listServices' | 'getServiceConfig'>;

  constructor(options: RailwayMcpDiscoveryPortOptions) {
    this.client = options.client;
    this.serverId = options.serverId;
    this.timeoutMs = options.timeoutMs;
    this.toolNames = {
      listProjects: options.toolNames?.listProjects ?? defaultRailwayMcpToolNames.listProjects,
      listServices: options.toolNames?.listServices ?? defaultRailwayMcpToolNames.listServices,
      getServiceConfig: options.toolNames?.getServiceConfig ?? defaultRailwayMcpToolNames.getServiceConfig
    };
    this.auditSink = options.auditSink;
    this.allowlist = createRailwayDiscoveryMcpToolRequirements(options.serverId, this.toolNames);
  }

  async discover(): Promise<RailwayDiscoverySnapshot> {
    const projectsExecution = await this.callRailwayTool(this.toolNames.listProjects, 'listProjects', {});
    const projects = readProjects(projectsExecution.result.content);
    const services: RailwayDiscoveryService[] = [];

    if (projects.length === 0) {
      const servicesExecution = await this.callRailwayTool(this.toolNames.listServices, 'listServices', {});
      return { projects, services: readServices(servicesExecution.result.content, undefined) };
    }

    for (const project of projects) {
      const servicesExecution = await this.callRailwayTool(this.toolNames.listServices, 'listServices', { project_id: project.id });
      services.push(...readServices(servicesExecution.result.content, project));
    }

    return { projects, services };
  }

  private async callRailwayTool(configuredToolName: string, action: RailwayDiscoveryMcpAction, argumentsObject: JsonObject): Promise<McpToolCallExecutionResult> {
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
        context: { port: discoveryPortName, action }
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

export function createRailwayDiscoveryMcpToolRequirements(
  serverId: string,
  toolNames: Pick<Partial<RailwayMcpToolNames>, 'listProjects' | 'listServices' | 'getServiceConfig'> = {}
): readonly McpToolAllowlistRule[] {
  const resolvedToolNames = {
    listProjects: toolNames.listProjects ?? defaultRailwayMcpToolNames.listProjects,
    listServices: toolNames.listServices ?? defaultRailwayMcpToolNames.listServices,
    getServiceConfig: toolNames.getServiceConfig ?? defaultRailwayMcpToolNames.getServiceConfig
  };

  return [
    { serverId, toolName: resolvedToolNames.listProjects, port: discoveryPortName, action: 'listProjects', safety: 'read' },
    { serverId, toolName: resolvedToolNames.listServices, port: discoveryPortName, action: 'listServices', safety: 'read' },
    { serverId, toolName: resolvedToolNames.getServiceConfig, port: discoveryPortName, action: 'getServiceConfig', safety: 'read' }
  ];
}

function readProjects(content: JsonValue | undefined): readonly RailwayDiscoveryProject[] {
  const candidates = collectArrayCandidates(content, ['projects', 'project']);
  const projects: RailwayDiscoveryProject[] = [];

  for (const candidate of candidates) {
    const project = readProject(candidate);

    if (project !== undefined && projects.every((existing) => existing.id !== project.id)) {
      projects.push(project);
    }
  }

  return projects;
}

function readProject(value: JsonValue | undefined): RailwayDiscoveryProject | undefined {
  if (value === undefined || !isJsonObject(value)) {
    return undefined;
  }

  const id = readOptionalString(value.id ?? value.projectId ?? value.project_id);
  const name = readOptionalString(value.name ?? value.projectName ?? value.project_name) ?? id;

  return id === undefined || name === undefined ? undefined : { id, name };
}

function readServices(content: JsonValue | undefined, project: RailwayDiscoveryProject | undefined): readonly RailwayDiscoveryService[] {
  const candidates = collectArrayCandidates(content, ['services', 'service']);
  const services: RailwayDiscoveryService[] = [];

  for (const candidate of candidates) {
    const service = readService(candidate, project);

    if (service !== undefined && services.every((existing) => existing.id !== service.id || existing.environmentId !== service.environmentId)) {
      services.push(service);
    }
  }

  return services;
}

function readService(value: JsonValue | undefined, project: RailwayDiscoveryProject | undefined): RailwayDiscoveryService | undefined {
  if (value === undefined || !isJsonObject(value)) {
    return undefined;
  }

  const id = readOptionalString(value.id ?? value.serviceId ?? value.service_id);
  const name = readOptionalString(value.name ?? value.serviceName ?? value.service_name) ?? id;

  if (id === undefined || name === undefined) {
    return undefined;
  }

  const embeddedProject = readProject(value.project);
  const projectId = readOptionalString(value.projectId ?? value.project_id) ?? embeddedProject?.id ?? project?.id;
  const projectName = readOptionalString(value.projectName ?? value.project_name) ?? embeddedProject?.name ?? project?.name;
  const environment = readEnvironment(value.environment);
  const environmentId = readOptionalString(value.environmentId ?? value.environment_id ?? value.stagingEnvironmentId ?? value.staging_environment_id) ?? environment?.id;
  const environmentName = readOptionalString(value.environmentName ?? value.environment_name ?? value.stagingEnvironmentName ?? value.staging_environment_name) ?? environment?.name;
  const branch = readOptionalString(value.branch ?? value.branchName ?? value.branch_name ?? value.stagingBranch ?? value.staging_branch);

  return {
    id,
    name,
    ...(projectId === undefined ? {} : { projectId }),
    ...(projectName === undefined ? {} : { projectName }),
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(environmentName === undefined ? {} : { environmentName }),
    ...(branch === undefined ? {} : { branch })
  };
}

function readEnvironment(value: JsonValue | undefined): { readonly id?: string | undefined; readonly name?: string | undefined } | undefined {
  if (value === undefined || !isJsonObject(value)) {
    return undefined;
  }

  return {
    id: readOptionalString(value.id ?? value.environmentId ?? value.environment_id),
    name: readOptionalString(value.name ?? value.environmentName ?? value.environment_name)
  };
}

function collectArrayCandidates(content: JsonValue | undefined, keys: readonly string[]): readonly JsonValue[] {
  if (Array.isArray(content)) {
    return content;
  }

  if (content === undefined || !isJsonObject(content)) {
    return [];
  }

  for (const key of keys) {
    const value = content[key];

    if (Array.isArray(value)) {
      return value;
    }

    if (value !== undefined && isJsonObject(value)) {
      return [value];
    }
  }

  const data = content.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (data !== undefined && isJsonObject(data)) {
    return collectArrayCandidates(data, keys);
  }

  return [];
}

function readOptionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readAuditRecords(error: unknown): readonly McpToolCallAuditRecord[] {
  if (typeof error === 'object' && error !== null && 'auditRecords' in error) {
    const auditRecords = (error as { readonly auditRecords?: unknown }).auditRecords;

    if (Array.isArray(auditRecords)) {
      return auditRecords.map((record) => record as McpToolCallAuditRecord);
    }
  }

  return [];
}
