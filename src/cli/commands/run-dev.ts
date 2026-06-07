import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import { runDevelopmentExecution } from '../../delivery/index.js';
import type { DevelopmentRunBoundary, DevelopmentRunResult, DevelopmentQualityRunner } from '../../delivery/index.js';
import type { CoreSafetyLimits, DevRunner } from '../../domain/index.js';
import type { GitCommandRunner } from '../../git/index.js';
import { mapMcpError } from '../../mcp/index.js';
import { createDevRunner, createRuntimeTicketPort } from '../../providers/index.js';
import { loadWorkspaceEnvironment } from '../../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface RunDevCommandDeliveryOptions {
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly readFile?: ((path: string) => Promise<string>) | undefined;
  readonly qualityRunner?: DevelopmentQualityRunner | undefined;
  readonly coreSafetyLimits?: Partial<CoreSafetyLimits> | undefined;
  readonly devRunner?: DevRunner | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface RunDevCommandOptions {
  readonly configPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly io: CliProgramIO;
  readonly runId?: string | undefined;
  readonly confirmed: boolean;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
  readonly delivery?: RunDevCommandDeliveryOptions | undefined;
}

export async function runRunDevCommand(ticketKey: string, options: RunDevCommandOptions): Promise<number> {
  if (!options.confirmed) {
    options.io.stderr('Refusing development execution: missing --confirm-dev-execution. No config, MCP readiness, run state, git, OpenCode, quality, provider calls, PRs, deployments, ledgers, production merge, or production deploy were started.\n');
    return 1;
  }

  const cwd = options.cwd ?? process.cwd();
  const environment = loadWorkspaceEnvironment(cwd);
  options.io.stdout(`Development execution requested for ${ticketKey}.\n`);
  options.io.stdout('Scope: one Jira ticket, exactly one selected repository, local branch, OpenCode, agent completion check, local quality gates, and local evidence only.\n');
  options.io.stdout('Local-only boundary: Ewokbot will not push, open PRs, call Railway/Vercel, verify deployments, merge production, or deploy production.\n');
  options.io.stdout(`Phase 1/3: loading ${ewokbotWorkspaceConfigPath} and creating Jira TicketPort.getTicket runtime path.\n`);

  try {
    const config = await loadWorkspaceConfig(resolve(cwd, options.configPath ?? ewokbotWorkspaceConfigPath), { workspaceRoot: cwd });
    const ticketPort = await createRuntimeTicketPort({ config, environment, ...options.runtimeMcp, requiredJiraMcpActions: ['getTicket'] });
    const devRunner = options.delivery?.devRunner ?? createDevRunner({ config, environment });

    options.io.stdout('Phase 2/3: reading one Jira ticket and planning a single repository before side effects.\n');
    const result = await runDevelopmentExecution({
      ticketKey,
      config,
      ticketPort,
      devRunner,
      rootPath: cwd,
      runId: options.runId,
      now: options.delivery?.now,
      gitCommandRunner: options.delivery?.gitCommandRunner,
      readFile: options.delivery?.readFile,
      qualityRunner: options.delivery?.qualityRunner,
      coreSafetyLimits: options.delivery?.coreSafetyLimits,
      environment,
      onBoundaryReady: (boundary) => renderBoundary(options.io, boundary)
    });

    renderRunDevResult(options.io, ticketKey, result);
    return result.state.state === 'LOCAL_CHECKS_PASSED' ? 0 : 1;
  } catch (error) {
    options.io.stderr(formatRunDevFailure(ticketKey, error));
    return 1;
  }
}

export function parseRunDevCommandOptions(args: readonly string[]): { readonly ticketKey?: string | undefined; readonly runId?: string | undefined; readonly confirmed: boolean } {
  const [ticketKey, ...flags] = args;
  let runId: string | undefined;
  let confirmed = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];

    if (flag === '--confirm-dev-execution') {
      confirmed = true;
    } else if (flag === '--run-id') {
      runId = value;
      index += 1;
    }
  }

  return { ticketKey, runId, confirmed };
}

function renderBoundary(io: CliProgramIO, boundary: DevelopmentRunBoundary): void {
  const gateNames = boundary.qualityGates.map((gate) => gate.name).join(', ') || 'none configured';

  io.stdout('Execution boundary confirmed before run state, git, OpenCode, and quality side effects:\n');
  io.stdout(`- Ticket: ${boundary.ticketKey} - ${boundary.ticketSummary}\n`);
  io.stdout(`- Repository: ${boundary.repository.owner}/${boundary.repository.name} at ${boundary.repositoryLocalPath}\n`);
  io.stdout(`- Branch: ${boundary.branchName} from ${boundary.baseBranch}\n`);
  io.stdout(`- Quality: ${gateNames}\n`);
  io.stdout(`- Evidence: ${boundary.runDirectoryPath}\n`);
  io.stdout('- Local-only stop: LOCAL_CHECKS_PASSED or FAILED; no provider handoff follows.\n');
}

function renderRunDevResult(io: CliProgramIO, ticketKey: string, result: DevelopmentRunResult): void {
  io.stdout('Phase 3/3: local branch, OpenCode, agent completion check, core safety, and local quality gates completed.\n');
  io.stdout(`Development run ${ticketKey} completed as ${result.runId}.\n`);
  io.stdout(`Final State: ${result.state.state}\n`);
  io.stdout(`Run Directory: ${result.runDirectoryPath}\n`);
  io.stdout(`Plan Report: ${result.planReportPath}\n`);
  io.stdout(`Implementation Log: ${result.implementationLogPath ?? 'n/a'}\n`);
  io.stdout(`Meaningful Diff Report: ${result.meaningfulDiffReportPath ?? 'n/a'}\n`);
  if (result.state.meaningfulDiff !== undefined) {
    io.stdout(`Meaningful Diff: ${result.state.meaningfulDiff.decision.toUpperCase()} - ${result.state.meaningfulDiff.reason}\n`);
  }
  io.stdout(`Agent Completion Report: ${result.agentCompletionReportPath ?? 'n/a'}\n`);
  if (result.state.agentCompletion !== undefined) {
    io.stdout(`Agent Completion: ${result.state.agentCompletion.decision.toUpperCase()} - ${result.state.agentCompletion.reason}\n`);
  }
  io.stdout(`Core Safety Report: ${result.coreSafetyReportPath ?? 'n/a'}\n`);
  if (result.state.coreSafety !== undefined) {
    io.stdout(`Core Safety: ${result.state.coreSafety.decision.toUpperCase()} - ${result.state.coreSafety.reason}\n`);
  }
  io.stdout(`Quality Report: ${result.qualityReportPath ?? 'n/a'}\n`);
  if (result.state.failure !== undefined) {
    io.stdout(`Failure Reason: ${result.state.failure.reason}\n`);
  }
  if (result.state.humanActionNeeded !== undefined) {
    io.stdout(`Human Action Needed: ${result.state.humanActionNeeded.reason}\n`);
  }
  io.stdout(`Final Report: ${result.finalReportPath ?? 'n/a'}\n`);
  io.stdout('Local-only boundary preserved: no git push, GitHub PR, Railway/Vercel deployment verification, operation ledger, production merge, or production deploy was attempted.\n');
}

function formatRunDevFailure(ticketKey: string, error: unknown): string {
  const mappedError = mapMcpError(error);
  const originalMessage = error instanceof Error ? error.message : mappedError.message;

  return [
    `Development execution failed: ${formatRunDevFailureReason(ticketKey, mappedError.kind, originalMessage)}.`,
    'No GitHub PR, Railway/Vercel deployment verification, operation ledger, production merge, or production deploy was attempted.',
    'Review local reports if a run id was created.'
  ].join('\n') + '\n';
}

function formatRunDevFailureReason(ticketKey: string, kind: ReturnType<typeof mapMcpError>['kind'], message: string): string {
  switch (kind) {
    case 'tool_not_found':
      return `missing required Jira MCP tool for TicketPort.getTicket (${message})`;
    case 'allowlist':
      return `Jira MCP tool is not allowlisted for TicketPort.getTicket (${message})`;
    case 'auth':
    case 'session':
      return `unable to read Jira ticket ${ticketKey}; MCP auth/session is not ready (${message})`;
    case 'timeout':
      return `unable to read Jira ticket ${ticketKey}; MCP tool call timed out (${message})`;
    case 'provider_error':
      return `unable to read Jira ticket ${ticketKey}; check the configured MCP client/server and ticket access (${message})`;
    case 'unknown':
      return message;
  }
}
