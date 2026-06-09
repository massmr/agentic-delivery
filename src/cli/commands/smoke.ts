import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import { runRealProviderSmokeRun } from '../../delivery/index.js';
import type { RealProviderSmokeRunResult, SmokeQualityRunner } from '../../delivery/index.js';
import type { SmokeUrlVerifier } from '../../deployment/index.js';
import type { DevRunner } from '../../domain/index.js';
import { mapMcpError } from '../../mcp/index.js';
import type { GitCommandRunner } from '../../git/index.js';
import { createRuntimeWorkspaceAdapters } from '../../providers/index.js';
import { loadWorkspaceEnvironment, runLocalDoctor } from '../../setup/index.js';
import type { DoctorCheck, DoctorProbeOptions, DoctorReport } from '../../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface SmokeCommandDeliveryOptions {
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly qualityRunner?: SmokeQualityRunner | undefined;
  readonly devRunner?: DevRunner | undefined;
  readonly smokeVerifier?: SmokeUrlVerifier | undefined;
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
  options.io.stdout(`Atlassian MCP Jira work-item smoke run requested for ${ticketKey}.\n`);
  options.io.stdout('Scope: one Jira work item, one selected repository, local branch, OpenCode, quality, develop PR handoff, read-only Railway staging verification, and evidence only.\n');
  options.io.stdout('Production boundary: Ewokbot will not prepare a production PR, merge production, deploy production, or call Railway mutating tools.\n');
  options.io.stdout('Phase 1/3: running local doctor before side effects.\n');

  const doctorReport = runAtSmokeDoctor(cwd, options.doctorOptions);
  renderDoctorReport(options.io, doctorReport.checks);

  if (!doctorReport.ok) {
    options.io.stderr('Smoke preflight failed: fix FAIL checks above before running Atlassian MCP Jira work-item preflight. No run state, git, OpenCode, quality, provider, or deployment writes were started.\n');
    return 1;
  }

  options.io.stdout(`Phase 2/3: loading ${ewokbotWorkspaceConfigPath}, workspace env, and validating runtime MCP readiness for Jira, GitHub handoff, and Railway staging reads.\n`);
  const config = await loadSmokeConfig(cwd, options.configPath, options.io);

  if (config === undefined) {
    return 1;
  }

  const modeError = validateSmokeConfig(config);

  if (modeError !== undefined) {
    options.io.stderr(`${modeError}\n`);
    options.io.stderr(`Smoke preflight failed before run state, git, OpenCode, quality, GitHub, Railway, operation ledger, staging report, production PR, merge, or deploy side effects. Set jira.mode, github.mode, and railway.mode to mcp in ${ewokbotWorkspaceConfigPath}.\n`);
    return 1;
  }

  try {
    const adapters = await createRuntimeWorkspaceAdapters({
      config,
      environment,
      requiredJiraMcpActions: ['getTicket'],
      requiredGitHubMcpActions: ['createBranch', 'openPullRequest', 'getChecks', 'commentOnPullRequest'],
      requiredRailwayMcpActions: ['waitForDeployment', 'getServiceUrl'],
      ...(options.runtimeMcp ?? {})
    });

    const runtimeAdapters = options.delivery?.devRunner === undefined ? adapters : { ...adapters, devRunner: options.delivery.devRunner };

    options.io.stdout('Phase 3/3: runtime readiness confirmed; running local execution, develop PR handoff, and read-only Railway staging verification.\n');
    const result = await runRealProviderSmokeRun({
      ticketKey,
      config,
      adapters: runtimeAdapters,
      rootPath: cwd,
      runId: options.runId,
      now: options.delivery?.now,
      gitCommandRunner: options.delivery?.gitCommandRunner,
      qualityRunner: options.delivery?.qualityRunner,
      smokeVerifier: options.delivery?.smokeVerifier,
      environment,
      runtimeMcp: options.runtimeMcp
    });

    renderSmokeResult(options.io, ticketKey, result);
    return result.state.state === 'STAGING_VERIFIED' ? 0 : 1;
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
  if (config.jira.mode === 'mcp' && config.github.mode === 'mcp' && config.railway.mode === 'mcp') {
    return undefined;
  }

  return `Configured provider modes are jira.mode=${config.jira.mode}, github.mode=${config.github.mode}, railway.mode=${config.railway.mode}. Smoke preflight requires jira.mode, github.mode, and railway.mode to be mcp for BB.`;
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

function renderSmokeResult(io: CliProgramIO, ticketKey: string, result: RealProviderSmokeRunResult): void {
  io.stdout('Smoke delivery evidence completed through local quality, develop PR handoff, and read-only Railway staging verification.\n');
  io.stdout(`Smoke run ${ticketKey} completed as ${result.runId}.\n`);
  io.stdout(`Final State: ${result.state.state}\n`);
  io.stdout(`Run Directory: ${result.runDirectoryPath}\n`);
  io.stdout(`Plan Report: ${result.planReportPath}\n`);
  io.stdout(`Implementation Log: ${result.implementationLogPath ?? 'n/a'}\n`);
  if (result.state.meaningfulDiff !== undefined) {
    io.stdout(`Meaningful Diff: ${result.state.meaningfulDiff.decision.toUpperCase()} - ${result.state.meaningfulDiff.reason}\n`);
  }
  if (result.state.agentCompletion !== undefined) {
    io.stdout(`Agent Completion: ${result.state.agentCompletion.decision.toUpperCase()} - ${result.state.agentCompletion.reason}\n`);
  }
  if (result.state.coreSafety !== undefined) {
    io.stdout(`Core Safety: ${result.state.coreSafety.decision.toUpperCase()} - ${result.state.coreSafety.reason}\n`);
  }
  io.stdout(`Quality Report: ${result.qualityReportPath ?? 'n/a'}\n`);
  if (result.state.testRelevance !== undefined) {
    io.stdout(`Test Relevance: ${result.state.testRelevance.decision.toUpperCase()} - ${result.state.testRelevance.reason}\n`);
  }
  io.stdout(`Develop Handoff Commit: ${result.state.developHandoffCommit?.commitSha ?? 'n/a'}\n`);
  io.stdout(`Staging Report: ${result.stagingReportPath ?? 'n/a'}\n`);
  if (result.state.failure !== undefined) {
    io.stdout(`Failure Reason: ${result.state.failure.reason}\n`);
  }
  if (result.state.humanActionNeeded !== undefined) {
    io.stdout(`Human Action Needed: ${result.state.humanActionNeeded.reason}\n`);
  }
  io.stdout(`Final Report: ${result.finalReportPath ?? 'n/a'}\n`);
  io.stdout('BB boundary preserved: no production PR preparation, production merge, production deploy, Railway deploy/rollback/scale/variable/domain mutation, or Vercel deployment was attempted.\n');
}

function formatSmokeFailure(ticketKey: string, error: unknown): string {
  const mappedError = mapMcpError(error);
  const originalMessage = error instanceof Error ? error.message : mappedError.message;

  return [
    `Smoke run failed: ${formatSmokeFailureReason(ticketKey, mappedError.kind, originalMessage)}.`,
    'Review persisted evidence to determine the last completed boundary. Production PR preparation, production merge, production deploy, and Railway mutating actions are never attempted by this BB smoke path.',
    'If a run id was created, review local evidence under .ewokbot/runs/.'
  ].join('\n') + '\n';
}

function formatSmokeFailureReason(ticketKey: string, kind: ReturnType<typeof mapMcpError>['kind'], message: string): string {
  const providerContext = inferSmokeFailureProviderContext(message);

  switch (kind) {
    case 'tool_not_found':
      return `missing required runtime MCP tool for the Jira/GitHub/Railway smoke path (${message})`;
    case 'allowlist':
      return `runtime MCP tool is not allowlisted for the Jira/GitHub/Railway smoke path (${message})`;
    case 'auth':
    case 'session':
      if (providerContext !== undefined) {
        return `${providerContext}; MCP auth/session is not ready (${message})`;
      }
      return `unable to read Jira work item ${ticketKey}; MCP auth/session is not ready (${message})`;
    case 'timeout':
      if (providerContext !== undefined) {
        return `${providerContext}; MCP tool call timed out (${message})`;
      }
      return `unable to read Jira work item ${ticketKey}; MCP tool call timed out (${message})`;
    case 'provider_error':
      if (providerContext !== undefined) {
        return `${providerContext} (${message})`;
      }
      return `unable to read Jira work item ${ticketKey}; check the configured MCP client/server and work-item access (${message})`;
    case 'unknown':
      return message;
  }
}

function inferSmokeFailureProviderContext(message: string): string | undefined {
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('github') ||
    lowerMessage.includes('codehostport') ||
    lowerMessage.includes('openpullrequest') ||
    lowerMessage.includes('create_pull_request') ||
    lowerMessage.includes('pull request')
  ) {
    return 'GitHub develop PR handoff failed';
  }

  if (lowerMessage.includes('railway') || lowerMessage.includes('deploymentport') || lowerMessage.includes('waitfordeployment')) {
    return 'Railway staging verification failed';
  }

  return undefined;
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
