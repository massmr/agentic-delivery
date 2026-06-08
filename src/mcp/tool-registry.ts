import type { McpToolDefinition } from './client.js';
import type { JsonObject } from './json.js';
import { sanitizeMcpJsonValue } from './schema-sanitizer.js';

export type McpToolRegistryProvider = 'atlassian' | 'railway' | 'github' | 'custom';
export type McpToolRegistryClassification = 'read' | 'write' | 'destructive' | 'secret_sensitive' | 'unknown' | 'custom';
export type McpToolRegistryCategory = 'ticketing' | 'deployment' | 'code_hosting' | 'custom' | 'unknown';
export type McpToolRegistrySource = 'inspection';
export type McpToolRegistryDefaultAuthorization = 'deny';

export interface McpToolRegistryEntry {
  readonly provider: McpToolRegistryProvider;
  readonly serverId: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject | undefined;
  readonly outputMetadata?: JsonObject | undefined;
  readonly category: McpToolRegistryCategory;
  readonly classification: McpToolRegistryClassification;
  readonly source: McpToolRegistrySource;
  readonly defaultAuthorization: McpToolRegistryDefaultAuthorization;
  readonly policyRequired: true;
  readonly unknownReason?: string | undefined;
}

export interface McpToolRegistry {
  readonly provider: McpToolRegistryProvider;
  readonly serverId: string;
  readonly entries: readonly McpToolRegistryEntry[];
  readonly safety: {
    readonly source: McpToolRegistrySource;
    readonly defaultAuthorization: McpToolRegistryDefaultAuthorization;
    readonly unknownToolsDeniedByDefault: true;
    readonly mcpMethodsCalled: readonly ['listTools'];
    readonly toolCallsPerformed: 0;
  };
}

export interface CreateMcpToolRegistryInput {
  readonly provider: McpToolRegistryProvider;
  readonly serverId: string;
  readonly tools: readonly McpToolDefinition[];
}

export function createMcpToolRegistry(input: CreateMcpToolRegistryInput): McpToolRegistry {
  return {
    provider: input.provider,
    serverId: input.serverId,
    entries: input.tools.map((tool) => createMcpToolRegistryEntry(input.provider, input.serverId, tool)),
    safety: {
      source: 'inspection',
      defaultAuthorization: 'deny',
      unknownToolsDeniedByDefault: true,
      mcpMethodsCalled: ['listTools'],
      toolCallsPerformed: 0
    }
  };
}

export function createAtlassianMcpToolRegistry(serverId: string, tools: readonly McpToolDefinition[]): McpToolRegistry {
  return createMcpToolRegistry({ provider: 'atlassian', serverId, tools });
}

export function createRailwayMcpToolRegistry(serverId: string, tools: readonly McpToolDefinition[]): McpToolRegistry {
  return createMcpToolRegistry({ provider: 'railway', serverId, tools });
}

export function createGitHubMcpToolRegistry(serverId: string, tools: readonly McpToolDefinition[]): McpToolRegistry {
  return createMcpToolRegistry({ provider: 'github', serverId, tools });
}

export function createCustomMcpToolRegistry(serverId: string, tools: readonly McpToolDefinition[]): McpToolRegistry {
  return createMcpToolRegistry({ provider: 'custom', serverId, tools });
}

export function inferMcpToolRegistryProvider(serverId: string): McpToolRegistryProvider {
  const normalized = serverId.toLowerCase();

  if (normalized.includes('atlassian') || normalized.includes('jira')) {
    return 'atlassian';
  }

  if (normalized.includes('railway')) {
    return 'railway';
  }

  if (normalized.includes('github')) {
    return 'github';
  }

  return 'custom';
}

function createMcpToolRegistryEntry(provider: McpToolRegistryProvider, serverId: string, tool: McpToolDefinition): McpToolRegistryEntry {
  const classification = classifyTool(tool.name, provider);
  const category = categorizeProvider(provider, classification);
  const base = {
    provider,
    serverId,
    toolName: tool.name,
    description: tool.description,
    inputSchema: sanitizeMcpJsonValue(tool.inputSchema) as JsonObject,
    outputSchema: tool.outputSchema === undefined ? undefined : sanitizeMcpJsonValue(tool.outputSchema) as JsonObject,
    outputMetadata: tool.outputMetadata === undefined ? undefined : sanitizeMcpJsonValue(tool.outputMetadata) as JsonObject,
    category,
    classification,
    source: 'inspection' as const,
    defaultAuthorization: 'deny' as const,
    policyRequired: true as const
  };

  if (classification === 'unknown') {
    return { ...base, unknownReason: 'Tool was discovered from MCP inspection data but has no built-in AV classification.' };
  }

  return base;
}

function classifyTool(toolName: string, provider: McpToolRegistryProvider): McpToolRegistryClassification {
  const normalized = normalizeToolName(toolName);

  if (hasSecretSensitiveName(toolName, normalized)) {
    return 'secret_sensitive';
  }

  if (/^(get|list|search|read|fetch|find|check|status|view|describe|inspect|query)/u.test(normalized)) {
    return 'read';
  }

  if (/(delete|remove|destroy|deploy|rollback|merge|transition|close|archive|cancel|restart|scale|provision|generatedomain|createpullrequest|openpullrequest|push)/u.test(normalized)) {
    return 'destructive';
  }

  if (/(add|create|update|edit|set|write|comment|assign|label|approve|reject|rerun)/u.test(normalized)) {
    return 'write';
  }

  if (/(get|list|search|read|fetch|find|check|status|view|describe|inspect|query|issue|project|service|deployment|pullrequest|repository|repo)/u.test(normalized)) {
    return 'read';
  }

  if (provider === 'custom' && normalized.startsWith('custom')) {
    return 'custom';
  }

  return 'unknown';
}

function categorizeProvider(provider: McpToolRegistryProvider, classification: McpToolRegistryClassification): McpToolRegistryCategory {
  if (classification === 'unknown') {
    return 'unknown';
  }

  if (provider === 'atlassian') {
    return 'ticketing';
  }

  if (provider === 'railway') {
    return 'deployment';
  }

  if (provider === 'github') {
    return 'code_hosting';
  }

  return 'custom';
}

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[-_\s]/gu, '').toLowerCase();
}

function hasSecretSensitiveName(toolName: string, normalized: string): boolean {
  if (/(token|secret|credential|password|envvar|environmentvariable|apikey|auth)/u.test(normalized)) {
    return true;
  }

  const tokens = tokenizeToolName(toolName);
  return tokens.some((token) => token === 'variable' || token === 'variables' || token === 'env' || token === 'envvar' || token === 'environmentvariable');
}

function tokenizeToolName(toolName: string): readonly string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
}
