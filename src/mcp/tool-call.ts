import type { McpClient, McpCallToolInput, McpToolCallResult } from './client.js';
import type { McpToolAllowlistRule, McpToolPolicyContext } from './allowlist.js';
import type { McpToolCallAuditRecord } from './audit.js';
import { assertMcpToolAllowed } from './allowlist.js';
import { createMcpToolCallAuditRecord } from './audit.js';
import { mapMcpError, withMcpTimeout } from './errors.js';

export interface McpToolCallExecutionResult {
  readonly result: McpToolCallResult;
  readonly auditRecords: readonly McpToolCallAuditRecord[];
}

export async function callAllowedMcpTool(input: {
  readonly client: McpClient;
  readonly allowlist: readonly McpToolAllowlistRule[];
  readonly call: McpCallToolInput;
  readonly context: McpToolPolicyContext;
  readonly runId?: string | undefined;
  readonly now?: (() => Date) | undefined;
}): Promise<McpToolCallExecutionResult> {
  const authorization = assertMcpToolAllowed(input.allowlist, input.call, input.context);
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const started = createMcpToolCallAuditRecord({
    runId: input.runId,
    serverId: input.call.serverId,
    toolName: input.call.toolName,
    port: input.context.port,
    action: input.context.action,
    safety: authorization.rule.safety,
    arguments: input.call.arguments,
    status: 'started',
    startedAt
  });

  try {
    const operation = input.client.callTool(input.call);
    const result = input.call.timeoutMs === undefined
      ? await operation
      : await withMcpTimeout({ serverId: input.call.serverId, toolName: input.call.toolName, timeoutMs: input.call.timeoutMs, operation });

    if (result.isError) {
      throw new Error(`MCP tool ${input.call.serverId}.${input.call.toolName} returned an error result: ${summarizeMcpToolErrorResult(result)}.`);
    }

    const finishedAt = now().toISOString();
    const succeeded = createMcpToolCallAuditRecord({
      runId: input.runId,
      serverId: input.call.serverId,
      toolName: input.call.toolName,
      port: input.context.port,
      action: input.context.action,
      safety: authorization.rule.safety,
      arguments: input.call.arguments,
      status: 'succeeded',
      startedAt,
      finishedAt
    });

    return { result, auditRecords: [started, succeeded] };
  } catch (error) {
    const finishedAt = now().toISOString();
    const failed = createMcpToolCallAuditRecord({
      runId: input.runId,
      serverId: input.call.serverId,
      toolName: input.call.toolName,
      port: input.context.port,
      action: input.context.action,
      safety: authorization.rule.safety,
      arguments: input.call.arguments,
      status: 'failed',
      startedAt,
      finishedAt,
      error: mapMcpError(error)
    });

    throw Object.assign(error instanceof Error ? error : new Error('Unknown MCP tool call error.'), { auditRecords: [started, failed] });
  }
}

function summarizeMcpToolErrorResult(result: McpToolCallResult): string {
  if (typeof result.content === 'string') {
    return result.content;
  }

  return JSON.stringify(result.content);
}
