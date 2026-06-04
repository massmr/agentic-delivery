export type AdapterKind = 'mcp' | 'native' | 'subprocess' | 'mock';

export type NativeFallbackPort =
  | 'TicketPort'
  | 'CodeHostPort'
  | 'DeploymentPort'
  | 'WorkspacePort'
  | 'FilesystemPort'
  | 'QualityGateRunner'
  | 'DevRunnerPort'
  | 'ProductionControl';

export type NativeFallbackRule = 'not-allowed' | 'allowed-when-mcp-imprecise' | 'required' | 'not-applicable';

export interface NativeFallbackContract {
  readonly port: NativeFallbackPort;
  readonly action: string;
  readonly preferredAdapter: AdapterKind | 'human';
  readonly allowedAdapters: readonly AdapterKind[];
  readonly mcpDefault: boolean;
  readonly nativeFallback: NativeFallbackRule;
  readonly requiresHumanApproval: boolean;
  readonly reason: string;
}

export class NativeFallbackContractNotFoundError extends Error {
  constructor(port: string, action: string) {
    super(`No native fallback contract is defined for ${port}.${action}. Add an explicit Milestone S contract before using this operation.`);
    this.name = 'NativeFallbackContractNotFoundError';
  }
}

export class NativeFallbackContractViolationError extends Error {
  constructor(contract: NativeFallbackContract, adapter: AdapterKind) {
    super(`${adapter} is not allowed for ${contract.port}.${contract.action}. Allowed adapters: ${formatAllowedAdapters(contract)}.`);
    this.name = 'NativeFallbackContractViolationError';
  }
}

const mcpExternal = freezeAdapterKinds(['mcp', 'mock'] as const);
const mcpExternalWithNativeFallback = freezeAdapterKinds(['mcp', 'native', 'mock'] as const);
const nativeLocal = freezeAdapterKinds(['native', 'subprocess', 'mock'] as const);
const subprocessLocal = freezeAdapterKinds(['subprocess', 'mock'] as const);

export const nativeFallbackContracts = Object.freeze([
  contract('TicketPort', 'listBacklog', 'mcp', mcpExternal, true, 'not-allowed', false, 'Jira backlog reads remain MCP-first; mock is allowed for local deterministic runs and tests.'),
  contract('TicketPort', 'getTicket', 'mcp', mcpExternal, true, 'not-allowed', false, 'Jira ticket reads remain MCP-first; mock is allowed for local deterministic runs and tests.'),
  contract('TicketPort', 'comment', 'mcp', mcpExternal, true, 'not-allowed', false, 'Jira comments are provider writes and must go through the typed MCP TicketPort or mock test adapter.'),
  contract('CodeHostPort', 'createBranch', 'mcp', mcpExternal, true, 'not-allowed', false, 'GitHub branch metadata creation remains MCP-first when the MCP tool exposes a precise typed branch contract.'),
  contract('CodeHostPort', 'pushBranch', 'subprocess', nativeLocal, false, 'required', false, 'Actual branch pushes rely on local git credentials and repository state; MCP push is disallowed until a precise push contract exists.'),
  contract('CodeHostPort', 'openPullRequest', 'mcp', mcpExternalWithNativeFallback, true, 'allowed-when-mcp-imprecise', false, 'GitHub PR creation is MCP-first, with native API fallback allowed only if MCP cannot express the required PR fields exactly.'),
  contract('CodeHostPort', 'getChecks', 'mcp', mcpExternalWithNativeFallback, true, 'allowed-when-mcp-imprecise', false, 'GitHub checks are MCP-first, with native API fallback allowed when MCP lacks required status, suite, or conclusion precision.'),
  contract('CodeHostPort', 'commentOnPullRequest', 'mcp', mcpExternalWithNativeFallback, true, 'allowed-when-mcp-imprecise', false, 'GitHub PR comments are MCP-first, with native API fallback allowed only when MCP cannot target the exact PR/comment surface.'),
  contract('DeploymentPort', 'waitForDeployment', 'mcp', mcpExternalWithNativeFallback, true, 'allowed-when-mcp-imprecise', false, 'Railway deployment polling is MCP-first, with native API fallback allowed when MCP lacks precise polling state or timeout guarantees.'),
  contract('DeploymentPort', 'readDeployment', 'mcp', mcpExternalWithNativeFallback, true, 'allowed-when-mcp-imprecise', false, 'Railway deployment reads are MCP-first, with native API fallback allowed when MCP omits required deployment metadata.'),
  contract('DeploymentPort', 'getServiceUrl', 'mcp', mcpExternalWithNativeFallback, true, 'allowed-when-mcp-imprecise', false, 'Railway service URL lookup is MCP-first, with native API fallback allowed when MCP cannot identify the exact service/environment URL.'),
  contract('WorkspacePort', 'checkout', 'subprocess', nativeLocal, false, 'required', false, 'Local repository checkout uses native filesystem and git subprocess operations, not MCP.'),
  contract('WorkspacePort', 'diff', 'subprocess', nativeLocal, false, 'required', false, 'Local repository diffs use native filesystem and git subprocess operations, not MCP.'),
  contract('WorkspacePort', 'commit', 'subprocess', nativeLocal, false, 'required', false, 'Local commits use native filesystem and git subprocess operations, not MCP.'),
  contract('FilesystemPort', 'readWriteRunState', 'native', ['native', 'mock'] as const, false, 'required', false, 'Run state and reports are runtime-owned local files and must not be delegated to an external SaaS MCP tool.'),
  contract('QualityGateRunner', 'runRequiredGates', 'subprocess', subprocessLocal, false, 'required', false, 'Quality gates execute repository-local commands and filesystem log capture before any push or PR action.'),
  contract('DevRunnerPort', 'runOpenCode', 'subprocess', subprocessLocal, false, 'required', false, 'OpenCode is invoked as a subprocess unless a stable future OpenCode MCP server is explicitly contracted.'),
  contract('ProductionControl', 'mergeProductionPullRequest', 'human', [], false, 'not-applicable', true, 'Production merges are danger actions and remain human-only.'),
  contract('ProductionControl', 'deployProduction', 'human', [], false, 'not-applicable', true, 'Production deployment mutation and configuration changes are human-only.')
] satisfies readonly NativeFallbackContract[]);

export function getNativeFallbackContract(port: NativeFallbackPort, action: string): NativeFallbackContract {
  const found = nativeFallbackContracts.find((contract) => contract.port === port && contract.action === action);

  if (found === undefined) {
    throw new NativeFallbackContractNotFoundError(port, action);
  }

  return found;
}

export function isAdapterAllowedForAction(port: NativeFallbackPort, action: string, adapter: AdapterKind): boolean {
  return isAdapterAllowed(getNativeFallbackContract(port, action), adapter);
}

export function assertAdapterAllowedForAction(port: NativeFallbackPort, action: string, adapter: AdapterKind): NativeFallbackContract {
  const found = getNativeFallbackContract(port, action);

  if (!isAdapterAllowed(found, adapter)) {
    throw new NativeFallbackContractViolationError(found, adapter);
  }

  return found;
}

export function isAdapterAllowed(contract: NativeFallbackContract, adapter: AdapterKind): boolean {
  return !contract.requiresHumanApproval && contract.allowedAdapters.includes(adapter);
}

function contract(
  port: NativeFallbackPort,
  action: string,
  preferredAdapter: AdapterKind | 'human',
  allowedAdapters: readonly AdapterKind[],
  mcpDefault: boolean,
  nativeFallback: NativeFallbackRule,
  requiresHumanApproval: boolean,
  reason: string
): NativeFallbackContract {
  return Object.freeze({
    port,
    action,
    preferredAdapter,
    allowedAdapters: freezeAdapterKinds(allowedAdapters),
    mcpDefault,
    nativeFallback,
    requiresHumanApproval,
    reason
  });
}

function formatAllowedAdapters(contract: NativeFallbackContract): string {
  if (contract.requiresHumanApproval) {
    return 'human approval only';
  }

  return contract.allowedAdapters.join(', ');
}

function freezeAdapterKinds(adapters: readonly AdapterKind[]): readonly AdapterKind[] {
  return Object.freeze([...adapters]);
}
