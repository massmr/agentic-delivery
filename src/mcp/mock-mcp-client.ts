import type { McpCallToolInput, McpClient, McpListToolsInput, McpToolCallResult, McpToolDefinition } from './client.js';
import type { JsonObject } from './json.js';
import { McpToolNotFoundError } from './errors.js';

export type MockMcpToolHandler = (input: McpCallToolInput) => Promise<McpToolCallResult> | McpToolCallResult;

export interface MockMcpToolRegistration {
  readonly serverId: string;
  readonly definition: McpToolDefinition;
  readonly handler: MockMcpToolHandler;
}

export class MockMcpClient implements McpClient {
  readonly listToolRequests: McpListToolsInput[] = [];
  readonly toolCallRequests: McpCallToolInput[] = [];
  private readonly tools = new Map<string, MockMcpToolRegistration>();

  constructor(registrations: readonly MockMcpToolRegistration[] = []) {
    for (const registration of registrations) {
      this.registerTool(registration);
    }
  }

  registerTool(registration: MockMcpToolRegistration): void {
    this.tools.set(toolKey(registration.serverId, registration.definition.name), registration);
  }

  async listTools(input: McpListToolsInput): Promise<readonly McpToolDefinition[]> {
    this.listToolRequests.push(input);

    return Array.from(this.tools.values())
      .filter((registration) => registration.serverId === input.serverId)
      .map((registration) => registration.definition)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async callTool(input: McpCallToolInput): Promise<McpToolCallResult> {
    this.toolCallRequests.push(input);
    const registration = this.tools.get(toolKey(input.serverId, input.toolName));

    if (registration === undefined) {
      throw new McpToolNotFoundError(input.serverId, input.toolName);
    }

    return await registration.handler(input);
  }
}

export function createMockMcpTool(serverId: string, toolName: string, handler: MockMcpToolHandler, inputSchema: JsonObject = {}): MockMcpToolRegistration {
  return {
    serverId,
    definition: {
      name: toolName,
      description: `Mock MCP tool ${toolName}.`,
      inputSchema
    },
    handler
  };
}

function toolKey(serverId: string, toolName: string): string {
  return `${serverId}:${toolName}`;
}
