import type { JsonObject, JsonValue } from './json.js';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

export interface McpListToolsInput {
  readonly serverId: string;
}

export interface McpCallToolInput {
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments: JsonObject;
  readonly timeoutMs?: number | undefined;
}

export interface McpToolCallResult {
  readonly content: JsonValue;
  readonly isError: boolean;
}

export interface McpClient {
  listTools(input: McpListToolsInput): Promise<readonly McpToolDefinition[]>;
  callTool(input: McpCallToolInput): Promise<McpToolCallResult>;
  close?(): Promise<void>;
}
