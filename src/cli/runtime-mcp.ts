import type { McpClient } from '../mcp/index.js';
import { createSdkRuntimeMcpClient, type CreateSdkRuntimeMcpClientOptions } from '../mcp/index.js';
import type { RuntimeMcpClientFactory } from '../providers/index.js';
import type { CliRuntimeMcpOptions } from './program.js';

export interface CreatePublicCliRuntimeMcpOptions extends CreateSdkRuntimeMcpClientOptions {}

export interface PublicCliRuntimeMcp {
  readonly runtimeMcp: CliRuntimeMcpOptions;
  close(): Promise<void>;
}

export function createPublicCliRuntimeMcp(options: CreatePublicCliRuntimeMcpOptions = {}): PublicCliRuntimeMcp {
  const clients: McpClient[] = [];
  const createMcpClient: RuntimeMcpClientFactory = async (server) => {
    const client = await createSdkRuntimeMcpClient(server, options);
    clients.push(client);
    return client;
  };

  return {
    runtimeMcp: { createMcpClient },
    async close() {
      for (const client of [...clients].reverse()) {
        await client.close?.();
      }
    }
  };
}
