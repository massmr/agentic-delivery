import type { McpToolRegistryClassification, McpToolRegistryEntry } from './tool-registry.js';

export const mcpPolicyModes = ['read_only', 'supervised', 'trusted', 'custom'] as const;
export type McpPolicyMode = typeof mcpPolicyModes[number];

export const mcpPolicyDecisions = ['allow', 'allow_redacted', 'require_human', 'deny'] as const;
export type McpPolicyDecision = typeof mcpPolicyDecisions[number];

export type McpPolicyOverrideScope = 'provider' | 'server' | 'tool';

export interface McpPolicyOverride {
  readonly decision: McpPolicyDecision;
  readonly reason?: string | undefined;
}

export interface McpPolicyConfig {
  readonly mode: McpPolicyMode;
  readonly providers?: Readonly<Record<string, McpPolicyOverride | undefined>> | undefined;
  readonly servers?: Readonly<Record<string, McpPolicyOverride | undefined>> | undefined;
  readonly tools?: Readonly<Record<string, McpPolicyOverride | undefined>> | undefined;
}

export interface McpPolicyEvaluationInput {
  readonly entry: McpToolRegistryEntry;
  readonly policy?: McpPolicyConfig | undefined;
}

export interface McpPolicyMatchedOverride {
  readonly scope: McpPolicyOverrideScope;
  readonly key: string;
  readonly decision: McpPolicyDecision;
  readonly reason?: string | undefined;
}

export interface McpPolicyEvaluation {
  readonly provider: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly classification: McpToolRegistryClassification;
  readonly mode: McpPolicyMode;
  readonly decision: McpPolicyDecision;
  readonly reason: string;
  readonly matchedOverride?: McpPolicyMatchedOverride | undefined;
  readonly redacted: boolean;
  readonly humanApprovalRequired: boolean;
  readonly blocked: boolean;
}

export interface McpPolicyReport {
  readonly mode: McpPolicyMode;
  readonly evaluations: readonly McpPolicyEvaluation[];
  readonly summary: {
    readonly allow: number;
    readonly allowRedacted: number;
    readonly requireHuman: number;
    readonly deny: number;
  };
}

const defaultMcpPolicyConfig: McpPolicyConfig = {
  mode: 'read_only',
  providers: {},
  servers: {},
  tools: {}
};

export function createDefaultMcpPolicyConfig(): McpPolicyConfig {
  return defaultMcpPolicyConfig;
}

export function evaluateMcpToolPolicy(input: McpPolicyEvaluationInput): McpPolicyEvaluation {
  const policy = normalizePolicyConfig(input.policy);
  const override = findPolicyOverride(input.entry, policy);
  const base = evaluateModeDefault(input.entry, policy.mode);
  const decision = applyPolicyOverride(input.entry, base, override);

  return {
    provider: input.entry.provider,
    serverId: input.entry.serverId,
    toolName: input.entry.toolName,
    classification: input.entry.classification,
    mode: policy.mode,
    decision: decision.decision,
    reason: decision.reason,
    matchedOverride: override,
    redacted: decision.decision === 'allow_redacted',
    humanApprovalRequired: decision.decision === 'require_human',
    blocked: decision.decision === 'deny'
  };
}

export function createMcpPolicyReport(entries: readonly McpToolRegistryEntry[], policy?: McpPolicyConfig | undefined): McpPolicyReport {
  const normalizedPolicy = normalizePolicyConfig(policy);
  const evaluations = entries.map((entry) => evaluateMcpToolPolicy({ entry, policy: normalizedPolicy }));

  return {
    mode: normalizedPolicy.mode,
    evaluations,
    summary: {
      allow: evaluations.filter((evaluation) => evaluation.decision === 'allow').length,
      allowRedacted: evaluations.filter((evaluation) => evaluation.decision === 'allow_redacted').length,
      requireHuman: evaluations.filter((evaluation) => evaluation.decision === 'require_human').length,
      deny: evaluations.filter((evaluation) => evaluation.decision === 'deny').length
    }
  };
}

function normalizePolicyConfig(policy: McpPolicyConfig | undefined): McpPolicyConfig {
  if (policy === undefined) {
    return defaultMcpPolicyConfig;
  }

  return {
    mode: policy.mode,
    providers: policy.providers ?? {},
    servers: policy.servers ?? {},
    tools: policy.tools ?? {}
  };
}

interface BaseDecision {
  readonly decision: McpPolicyDecision;
  readonly reason: string;
}

function evaluateModeDefault(entry: McpToolRegistryEntry, mode: McpPolicyMode): BaseDecision {
  if (entry.classification === 'unknown') {
    return deny(entry.unknownReason ?? 'Tool has no registry classification and is denied by default.');
  }

  if (entry.classification === 'custom') {
    return deny('Custom-classified tools require an explicit MCP policy override.');
  }

  if (entry.classification === 'secret_sensitive') {
    return deny('Secret-sensitive tools are denied by default to avoid exposing credentials or environment values.');
  }

  if (entry.classification === 'destructive') {
    return deny('Destructive tools are denied by default and require explicit human approval.');
  }

  if (mode === 'read_only') {
    return entry.classification === 'read'
      ? allow('Read-only mode allows read-classified tools.')
      : deny('Read-only mode denies non-read MCP tools.');
  }

  if (mode === 'supervised') {
    if (entry.classification === 'read') {
      return allow('Supervised mode allows read-classified tools.');
    }

    if (entry.classification === 'write') {
      return requireHuman('Supervised mode requires human approval for write-classified tools unless explicitly overridden.');
    }
  }

  if (mode === 'trusted') {
    if (entry.classification === 'read') {
      return allow('Trusted mode allows read-classified tools.');
    }

    if (entry.classification === 'write') {
      return allow('Trusted mode allows non-destructive write-classified tools.');
    }
  }

  return deny('Custom mode denies tools unless an explicit MCP policy override applies.');
}

function applyPolicyOverride(entry: McpToolRegistryEntry, base: BaseDecision, override: McpPolicyMatchedOverride | undefined): BaseDecision {
  if (override === undefined) {
    return protectProductionBoundary(entry, base, undefined);
  }

  if (entry.classification === 'unknown') {
    return denyWithOverride('Unknown MCP tools remain denied even when an override is configured.', override);
  }

  if (entry.classification === 'custom' && override.decision === 'allow_redacted') {
    return denyWithOverride('Custom-classified tools cannot use allow_redacted because redaction semantics are undefined.', override);
  }

  if (entry.classification !== 'secret_sensitive' && override.decision === 'allow_redacted') {
    return denyWithOverride('allow_redacted is only valid for secret-sensitive registry entries.', override);
  }

  if (entry.classification === 'secret_sensitive' && override.decision === 'allow') {
    return denyWithOverride('Secret-sensitive tools cannot be autonomously allowed; use allow_redacted for reporting or require_human.', override);
  }

  if (entry.classification === 'destructive' && override.decision === 'allow' && isDestructiveDelete(entry)) {
    return denyWithOverride('Destructive delete/remove MCP tools cannot be autonomously allowed by policy overrides.', override);
  }

  if (entry.classification === 'destructive' && override.decision === 'allow' && isGitHubMergePullRequest(entry)) {
    return requireHuman(`GitHub merge_pull_request requires human approval regardless of policy mode. Override ${override.key} cannot bypass this boundary.`);
  }

  return protectProductionBoundary(entry, {
    decision: override.decision,
    reason: override.reason ?? `Explicit ${override.scope} MCP policy override selected ${override.decision}.`
  }, override);
}

function protectProductionBoundary(entry: McpToolRegistryEntry, decision: BaseDecision, override: McpPolicyMatchedOverride | undefined): BaseDecision {
  if (decision.decision !== 'allow' || (!isProductionMergeOrDeploy(entry) && !isGitHubMergePullRequest(entry))) {
    return decision;
  }

  const suffix = override === undefined ? '' : ` Override ${override.key} cannot bypass this boundary.`;
  const reason = isGitHubMergePullRequest(entry)
    ? 'GitHub merge_pull_request requires human approval regardless of policy mode.'
    : 'Production merge/deploy MCP tools require human approval regardless of policy mode.';
  return requireHuman(`${reason}${suffix}`);
}

function findPolicyOverride(entry: McpToolRegistryEntry, policy: McpPolicyConfig): McpPolicyMatchedOverride | undefined {
  const toolOverride = findToolOverride(entry, policy.tools ?? {});
  if (toolOverride !== undefined) {
    return toolOverride;
  }

  const serverOverride = policy.servers?.[entry.serverId];
  if (serverOverride !== undefined) {
    return { scope: 'server', key: entry.serverId, decision: serverOverride.decision, reason: serverOverride.reason };
  }

  const providerOverride = policy.providers?.[entry.provider];
  if (providerOverride !== undefined) {
    return { scope: 'provider', key: entry.provider, decision: providerOverride.decision, reason: providerOverride.reason };
  }

  return undefined;
}

function findToolOverride(entry: McpToolRegistryEntry, tools: Readonly<Record<string, McpPolicyOverride | undefined>>): McpPolicyMatchedOverride | undefined {
  const candidates = [`${entry.serverId}.${entry.toolName}`, `${entry.provider}.${entry.toolName}`, entry.toolName];

  for (const key of candidates) {
    const override = tools[key];
    if (override !== undefined) {
      return { scope: 'tool', key, decision: override.decision, reason: override.reason };
    }
  }

  return undefined;
}

function isProductionMergeOrDeploy(entry: McpToolRegistryEntry): boolean {
  const normalized = `${entry.toolName} ${entry.description}`.replace(/[-_\s]/gu, '').toLowerCase();
  const productionBound = /(production|prod|main|release)/u.test(normalized);
  return productionBound && /(merge|deploy)/u.test(normalized);
}

function isDestructiveDelete(entry: McpToolRegistryEntry): boolean {
  const normalized = `${entry.toolName} ${entry.description}`.replace(/[-_\s]/gu, '').toLowerCase();
  return /(delete|remove|destroy)/u.test(normalized);
}

function isGitHubMergePullRequest(entry: McpToolRegistryEntry): boolean {
  const normalized = entry.toolName.replace(/[-_\s]/gu, '').toLowerCase();
  return entry.provider === 'github' && normalized === 'mergepullrequest';
}

function allow(reason: string): BaseDecision {
  return { decision: 'allow', reason };
}

function requireHuman(reason: string): BaseDecision {
  return { decision: 'require_human', reason };
}

function deny(reason: string): BaseDecision {
  return { decision: 'deny', reason };
}

function denyWithOverride(reason: string, override: McpPolicyMatchedOverride): BaseDecision {
  return deny(`${reason} Matched override: ${override.scope} ${override.key}.`);
}
