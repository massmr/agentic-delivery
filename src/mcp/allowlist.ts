import type { McpCallToolInput } from './client.js';
import { McpToolAllowlistError } from './errors.js';

export type McpToolSafety = 'read' | 'write' | 'danger';

export interface McpToolAllowlistRule {
  readonly serverId: string;
  readonly toolName: string;
  readonly port: string;
  readonly action: string;
  readonly safety: McpToolSafety;
}

export interface McpToolPolicyContext {
  readonly port: string;
  readonly action: string;
  readonly allowDanger?: boolean | undefined;
}

export interface McpToolAuthorization {
  readonly rule: McpToolAllowlistRule;
}

export function findMcpToolAllowlistRule(
  rules: readonly McpToolAllowlistRule[],
  input: McpCallToolInput,
  context: McpToolPolicyContext
): McpToolAllowlistRule | undefined {
  return rules.find(
    (rule) =>
      rule.serverId === input.serverId && rule.toolName === input.toolName && rule.port === context.port && rule.action === context.action
  );
}

export function assertMcpToolAllowed(
  rules: readonly McpToolAllowlistRule[],
  input: McpCallToolInput,
  context: McpToolPolicyContext
): McpToolAuthorization {
  const rule = findMcpToolAllowlistRule(rules, input, context);

  if (rule === undefined || (rule.safety === 'danger' && context.allowDanger !== true)) {
    throw new McpToolAllowlistError(input.serverId, input.toolName, context.port, context.action);
  }

  return { rule };
}
