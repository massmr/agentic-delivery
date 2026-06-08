import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import { runDevelopmentExecution } from '../../delivery/index.js';
import type { DevelopmentQualityRunner, DevelopmentRunBoundary, DevelopmentRunResult } from '../../delivery/index.js';
import type { CoreSafetyLimits, DevRunner } from '../../domain/index.js';
import { mapMcpError } from '../../mcp/index.js';
import type { GitCommandRunner } from '../../git/index.js';
import { createDevRunner, createRuntimeTicketPort } from '../../providers/index.js';
import { loadWorkspaceEnvironment, runLocalDoctor } from '../../setup/index.js';
import type { DoctorCheck, DoctorProbeOptions, DoctorReport } from '../../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface SmokeCommandDeliveryOptions {
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly qualityRunner?: DevelopmentQualityRunner | undefined;
  readonly coreSafetyLimits?: Partial<CoreSafetyLimits> | undefined;
  readonly devRunner?: DevRunner | undefined;
  readonly now?: (() => Date) | undefined;
}

const nonAtSmokeDoctorLabels = new Set(['GitHub', 'Railway', 'Vercel']);

export interface SmokeCommandOptions {
  readonly configPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly io: CliProgramIO;
  readonly runId?: string | undefined;
  readonly confirmed: boolean;
  readonly doctorOptions?: DoctorProbeOptions | undefined;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
  readonly delivery?: SmokeCommandDeliveryOptions | undefined;
}

export async function runSmokeCommand(ticketKey: string, options: SmokeCommandOptions): Promise<number> {
  if (!options.confirmed) {
    options.io.stderr('Refusing smoke preflight: missing --confirm-real-provider-smoke. No doctor, config, MCP, run state, git, OpenCode, quality, provider, or deployment writes were started.\n');
    return 1;
  }

  const cwd = options.cwd ?? process.cwd();
  const environment = loadWorkspaceEnvironment(cwd);
  options.io.stdout(`AT Jira-only smoke run requested for ${ticketKey}.\n`);
  options.io.stdout('Scope: one Jira ticket, one selected repository, local branch, OpenCode, quality, and evidence only; no PR, deployment, or provider handoff.\n');
  options.io.stdout('Local-only boundary: Ewokbot will not push, open GitHub PRs, call Railway or Vercel, verify deployments, write an operation ledger, or merge/deploy production.\n');
  options.io.stdout('Phase 1/3: running local doctor before side effects.\n');

  const doctorReport = runAtSmokeDoctor(cwd, options.doctorOptions);
  renderDoctorReport(options.io, doctorReport.checks);

  if (!doctorReport.ok) {
    options.io.stderr('Smoke preflight failed: fix FAIL checks above before running Jira-only MCP preflight. No run state, git, OpenCode, quality, provider, or deployment writes were started.\n');
    return 1;
  }

  options.io.stdout(`Phase 2/3: loading ${ewokbotWorkspaceConfigPath}, workspace env, and validating Jira MCP TicketPort.getTicket readiness.\n`);
  const config = await loadSmokeConfig(cwd, options.configPath, options.io);

  if (config === undefined) {
    return 1;
  }

  const modeError = validateSmokeConfig(config);

  if (modeError !== undefined) {
    options.io.stderr(`${modeError}\n`);
    options.io.stderr(`Smoke preflight failed before run state, git, OpenCode, quality, or provider side effects. Set jira.mode to mcp in ${ewokbotWorkspaceConfigPath}.\n`);
    return 1;
  }

  try {
    const ticketPort = await createRuntimeTicketPort({
      config,
      environment,
      ...(options.runtimeMcp ?? {}),
      requiredJiraMcpActions: ['getTicket']
    });

    const devRunner = options.delivery?.devRunner ?? createDevRunner({ config, environment });

    options.io.stdout('Phase 3/3: Jira MCP getTicket readiness confirmed; reading the ticket and running local execution evidence.\n');
    const result = await runDevelopmentExecution({
      ticketKey,
      config,
      ticketPort,
      devRunner,
      rootPath: cwd,
      runId: options.runId,
      now: options.delivery?.now,
      gitCommandRunner: options.delivery?.gitCommandRunner,
      qualityRunner: options.delivery?.qualityRunner,
      coreSafetyLimits: options.delivery?.coreSafetyLimits,
      environment,
      onBoundaryReady: (boundary) => renderBoundary(options.io, boundary)
    });

    renderSmokeResult(options.io, ticketKey, result);
    return result.state.state === 'LOCAL_CHECKS_PASSED' ? 0 : 1;
  } catch (error) {
    options.io.stderr(formatSmokeFailure(ticketKey, error));
    return 1;
  }
}

export function parseSmokeCommandOptions(args: readonly string[]): { readonly ticketKey?: string | undefined; readonly runId?: string | undefined; readonly confirmed: boolean } {
  const [ticketKey, ...flags] = args;
  let runId: string | undefined;
  let confirmed = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];

    if (flag === '--confirm-real-provider-smoke') {
      confirmed = true;
    } else if (flag === '--run-id') {
      runId = value;
      index += 1;
    }
  }

  return { ticketKey, runId, confirmed };
}

function validateSmokeConfig(config: Awaited<ReturnType<typeof loadWorkspaceConfig>>): string | undefined {
  if (config.jira.mode === 'mcp') {
    return undefined;
  }

  return `Jira mode is ${config.jira.mode}. Smoke preflight requires jira.mode to be mcp for TicketPort.getTicket readiness.`;
}

async function loadSmokeConfig(cwd: string, configPath: string | undefined, io: CliProgramIO): Promise<Awaited<ReturnType<typeof loadWorkspaceConfig>> | undefined> {
  try {
    return await loadWorkspaceConfig(resolve(cwd, configPath ?? ewokbotWorkspaceConfigPath), { workspaceRoot: cwd });
  } catch (error) {
    io.stderr(`Smoke preflight failed while loading ${ewokbotWorkspaceConfigPath}: ${formatError(error)}\n`);
    io.stderr('No run state, git, OpenCode, quality, provider, or deployment writes were started.\n');
    return undefined;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function renderSmokeResult(io: CliProgramIO, ticketKey: string, result: DevelopmentRunResult): void {
  io.stdout('Local execution evidence completed: local branch, OpenCode, agent completion check, core safety, test relevance, and local quality gates.\n');
  io.stdout(`Smoke run ${ticketKey} completed as ${result.runId}.\n`);
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
  io.stdout(`Test Relevance Report: ${result.testRelevanceReportPath ?? 'n/a'}\n`);
  if (result.state.testRelevance !== undefined) {
    io.stdout(`Test Relevance: ${result.state.testRelevance.decision.toUpperCase()} - ${result.state.testRelevance.reason}\n`);
  }
  if (result.state.failure !== undefined) {
    io.stdout(`Failure Reason: ${result.state.failure.reason}\n`);
  }
  if (result.state.humanActionNeeded !== undefined) {
    io.stdout(`Human Action Needed: ${result.state.humanActionNeeded.reason}\n`);
  }
  io.stdout(`Final Report: ${result.finalReportPath ?? 'n/a'}\n`);
  io.stdout('Local-only boundary preserved: no git push, GitHub PR, Railway/Vercel deployment verification, operation ledger, Jira comment/transition, staging report, production merge, or production deploy was attempted.\n');
}

function formatSmokeFailure(ticketKey: string, error: unknown): string {
  const mappedError = mapMcpError(error);
  const originalMessage = error instanceof Error ? error.message : mappedError.message;

  return [
    `Smoke run failed: ${formatSmokeFailureReason(ticketKey, mappedError.kind, originalMessage)}.`,
    'No git push, GitHub PR, Railway/Vercel deployment verification, operation ledger, Jira comment/transition, staging report, production merge, or production deploy was attempted.',
    'If a run id was created, review local evidence under .ewokbot/runs/.'
  ].join('\n') + '\n';
}

function formatSmokeFailureReason(ticketKey: string, kind: ReturnType<typeof mapMcpError>['kind'], message: string): string {
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

function renderDoctorReport(io: CliProgramIO, checks: readonly DoctorCheck[]): void {
  for (const check of checks) {
    const nextStep = check.nextStep === undefined ? '' : ` Next step: ${check.nextStep}`;
    io.stdout(`${check.status.toUpperCase()}: ${check.label}: ${check.message}${nextStep}\n`);
  }
}

function runAtSmokeDoctor(cwd: string, options: DoctorProbeOptions | undefined): DoctorReport {
  const report = runLocalDoctor(cwd, options);
  const checks = report.checks.filter((check) => !nonAtSmokeDoctorLabels.has(check.label));
  const issues = checks.flatMap((check) => check.status === 'pass' ? [] : [{ severity: check.status, message: `${check.label}: ${check.message}` }] as const);

  return {
    ...report,
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
    issues
  };
}
