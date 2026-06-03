export type McpMappedErrorKind = 'timeout' | 'auth' | 'session' | 'tool_not_found' | 'allowlist' | 'provider_error' | 'unknown';

export interface McpMappedError {
  readonly kind: McpMappedErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly requiresHumanAction: boolean;
}

export class McpToolCallTimeoutError extends Error {
  readonly serverId: string;
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(serverId: string, toolName: string, timeoutMs: number) {
    super(`MCP tool ${serverId}.${toolName} timed out after ${timeoutMs}ms.`);
    this.name = 'McpToolCallTimeoutError';
    this.serverId = serverId;
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

export class McpToolNotFoundError extends Error {
  readonly serverId: string;
  readonly toolName: string;

  constructor(serverId: string, toolName: string) {
    super(`MCP tool ${serverId}.${toolName} was not discovered. Configure or allow the MCP server tool before retrying.`);
    this.name = 'McpToolNotFoundError';
    this.serverId = serverId;
    this.toolName = toolName;
  }
}

export class McpToolAllowlistError extends Error {
  readonly serverId: string;
  readonly toolName: string;
  readonly port: string;
  readonly action: string;

  constructor(serverId: string, toolName: string, port: string, action: string) {
    super(`MCP tool ${serverId}.${toolName} is not allowlisted for ${port}.${action}.`);
    this.name = 'McpToolAllowlistError';
    this.serverId = serverId;
    this.toolName = toolName;
    this.port = port;
    this.action = action;
  }
}

export function mapMcpError(error: unknown): McpMappedError {
  if (error instanceof McpToolCallTimeoutError) {
    return {
      kind: 'timeout',
      message: error.message,
      retryable: true,
      requiresHumanAction: false
    };
  }

  if (error instanceof McpToolNotFoundError) {
    return {
      kind: 'tool_not_found',
      message: error.message,
      retryable: false,
      requiresHumanAction: false
    };
  }

  if (error instanceof McpToolAllowlistError) {
    return {
      kind: 'allowlist',
      message: error.message,
      retryable: false,
      requiresHumanAction: true
    };
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('oauth') || message.includes('unauthorized') || message.includes('forbidden')) {
      return {
        kind: 'auth',
        message: error.message,
        retryable: false,
        requiresHumanAction: true
      };
    }

    if (message.includes('session') || message.includes('expired')) {
      return {
        kind: 'session',
        message: error.message,
        retryable: true,
        requiresHumanAction: false
      };
    }

    return {
      kind: 'provider_error',
      message: error.message,
      retryable: false,
      requiresHumanAction: false
    };
  }

  return {
    kind: 'unknown',
    message: 'Unknown MCP client error.',
    retryable: false,
    requiresHumanAction: false
  };
}

export async function withMcpTimeout<T>(input: {
  readonly serverId: string;
  readonly toolName: string;
  readonly timeoutMs: number;
  readonly operation: Promise<T>;
}): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new McpToolCallTimeoutError(input.serverId, input.toolName, input.timeoutMs));
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([input.operation, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
