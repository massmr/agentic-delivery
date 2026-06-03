export type McpServerTransport = 'stdio' | 'http';

export interface McpServerConfig {
  readonly id: string;
  readonly displayName: string;
  readonly transport: McpServerTransport;
  readonly command?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly url?: string | undefined;
  readonly timeoutMs: number;
  readonly envVarNames?: readonly string[] | undefined;
}

export interface McpServerConfigValidationIssue {
  readonly field: string;
  readonly message: string;
}

export const defaultMcpToolTimeoutMs = 30_000;

export function createStdioMcpServerConfig(input: {
  readonly id: string;
  readonly displayName?: string | undefined;
  readonly command: string;
  readonly args?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
  readonly envVarNames?: readonly string[] | undefined;
}): McpServerConfig {
  return {
    id: input.id,
    displayName: input.displayName ?? input.id,
    transport: 'stdio',
    command: input.command,
    args: input.args ?? [],
    timeoutMs: input.timeoutMs ?? defaultMcpToolTimeoutMs,
    envVarNames: input.envVarNames ?? []
  };
}

export function createHttpMcpServerConfig(input: {
  readonly id: string;
  readonly displayName?: string | undefined;
  readonly url: string;
  readonly timeoutMs?: number | undefined;
  readonly envVarNames?: readonly string[] | undefined;
}): McpServerConfig {
  return {
    id: input.id,
    displayName: input.displayName ?? input.id,
    transport: 'http',
    url: input.url,
    timeoutMs: input.timeoutMs ?? defaultMcpToolTimeoutMs,
    envVarNames: input.envVarNames ?? []
  };
}

export function validateMcpServerConfig(config: McpServerConfig): readonly McpServerConfigValidationIssue[] {
  const issues: McpServerConfigValidationIssue[] = [];

  if (config.id.trim().length === 0) {
    issues.push({ field: 'id', message: 'MCP server id is required.' });
  }

  if (config.displayName.trim().length === 0) {
    issues.push({ field: 'displayName', message: 'MCP server display name is required.' });
  }

  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    issues.push({ field: 'timeoutMs', message: 'MCP server timeout must be a positive integer in milliseconds.' });
  }

  if (config.transport === 'stdio') {
    if (config.command === undefined || config.command.trim().length === 0) {
      issues.push({ field: 'command', message: 'stdio MCP servers require a command.' });
    }
  } else if (config.url === undefined || config.url.trim().length === 0) {
    issues.push({ field: 'url', message: 'http MCP servers require a URL.' });
  }

  return issues;
}
