import type { JsonObject, JsonValue } from './json.js';
import type { McpMappedError } from './errors.js';
import type { McpToolSafety } from './allowlist.js';
import { isJsonObject } from './json.js';

export type McpToolCallAuditStatus = 'started' | 'succeeded' | 'failed';

export interface McpToolCallAuditRecord {
  readonly auditId: string;
  readonly runId?: string | undefined;
  readonly serverId: string;
  readonly toolName: string;
  readonly port: string;
  readonly action: string;
  readonly safety: McpToolSafety;
  readonly status: McpToolCallAuditStatus;
  readonly inputHash: string;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly error?: McpMappedError | undefined;
}

export interface CreateMcpToolCallAuditRecordInput {
  readonly runId?: string | undefined;
  readonly serverId: string;
  readonly toolName: string;
  readonly port: string;
  readonly action: string;
  readonly safety: McpToolSafety;
  readonly arguments: JsonObject;
  readonly status: McpToolCallAuditStatus;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly error?: McpMappedError | undefined;
}

export function createMcpToolCallAuditRecord(input: CreateMcpToolCallAuditRecordInput): McpToolCallAuditRecord {
  return {
    auditId: buildAuditId(input),
    runId: input.runId,
    serverId: input.serverId,
    toolName: input.toolName,
    port: input.port,
    action: input.action,
    safety: input.safety,
    status: input.status,
    inputHash: stableHash(stableStringify(input.arguments)),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    error: input.error
  };
}

function buildAuditId(input: CreateMcpToolCallAuditRecordInput): string {
  return `mcp-${stableHash(`${input.runId ?? 'no-run'}:${input.serverId}:${input.toolName}:${input.port}:${input.action}:${input.startedAt}`)}`;
}

function stableHash(source: string): string {
  let hash = 0;

  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function stableStringify(value: JsonValue | undefined): string {
  if (value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (isJsonObject(value)) {
    const entries = Object.entries(value)
      .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}
