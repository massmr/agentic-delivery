import type { McpClient, McpToolDefinition } from './client.js';
import { McpToolNotFoundError } from './errors.js';

export interface DiscoveredMcpTool extends McpToolDefinition {
  readonly serverId: string;
}

export interface McpToolCatalog {
  readonly serverId: string;
  readonly tools: readonly DiscoveredMcpTool[];
}

export async function discoverMcpTools(client: McpClient, serverId: string): Promise<McpToolCatalog> {
  const tools = await client.listTools({ serverId });

  return {
    serverId,
    tools: tools.map((tool) => ({ ...tool, serverId }))
  };
}

export function findDiscoveredMcpTool(catalog: McpToolCatalog, toolName: string): DiscoveredMcpTool | undefined {
  return catalog.tools.find((tool) => tool.name === toolName);
}

export function requireDiscoveredMcpTool(catalog: McpToolCatalog, toolName: string): DiscoveredMcpTool {
  const tool = findDiscoveredMcpTool(catalog, toolName);

  if (tool === undefined) {
    throw new McpToolNotFoundError(catalog.serverId, toolName);
  }

  return tool;
}
