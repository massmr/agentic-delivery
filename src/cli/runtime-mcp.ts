import type { McpClient } from '../mcp/index.js';
import { createSdkRuntimeMcpClient, createStdioMcpServerConfig, type CreateSdkRuntimeMcpClientOptions } from '../mcp/index.js';
import type { RuntimeMcpClientFactory } from '../providers/index.js';
import { RailwayMcpDiscoveryPort, type RailwayDiscoveryPort } from '../connectors/railway/index.js';
import { railwayCliMcpPreset } from '../setup/index.js';
import type { CliRuntimeMcpOptions } from './program.js';

export interface CreatePublicCliRuntimeMcpOptions extends CreateSdkRuntimeMcpClientOptions {
  readonly environmentProvider?: (() => Readonly<Record<string, string | undefined>>) | undefined;
}

export interface PublicCliRuntimeMcp {
  readonly runtimeMcp: CliRuntimeMcpOptions;
  createRailwayDiscovery(): RailwayDiscoveryPort;
  close(): Promise<void>;
}

export function createPublicCliRuntimeMcp(options: CreatePublicCliRuntimeMcpOptions = {}): PublicCliRuntimeMcp {
  const clients: McpClient[] = [];
  const createMcpClient: RuntimeMcpClientFactory = async (server) => {
    const client = await createSdkRuntimeMcpClient(server, { ...options, environment: options.environmentProvider?.() ?? options.environment });
    clients.push(client);
    return client;
  };

  return {
    runtimeMcp: { createMcpClient },
    createRailwayDiscovery() {
      let railwayClient: Promise<McpClient> | undefined;
      const getRailwayClient = () => {
        railwayClient ??= Promise.resolve(createMcpClient(createRailwayMcpServerConfig()));
        return railwayClient;
      };

      return new RailwayMcpDiscoveryPort({
        client: {
          async listTools(serverId) {
            const client = await getRailwayClient();
            return client.listTools(serverId);
          },
          async callTool(request) {
            const client = await getRailwayClient();
            return client.callTool(request);
          }
        },
        serverId: railwayCliMcpPreset.server.id
      });
    },
    async close() {
      for (const client of [...clients].reverse()) {
        await client.close?.();
      }
    }
  };
}

function createRailwayMcpServerConfig() {
  return createStdioMcpServerConfig({
    id: railwayCliMcpPreset.server.id,
    displayName: 'Railway MCP',
    command: railwayCliMcpPreset.server.command,
    args: railwayCliMcpPreset.server.args,
    envVarNames: railwayCliMcpPreset.server.envVarNames
  });
}
