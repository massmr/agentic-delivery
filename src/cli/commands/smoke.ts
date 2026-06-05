import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/index.js';
import type { SmokeUrlVerifier } from '../../deployment/index.js';
import { runRealProviderSmokeRun } from '../../delivery/index.js';
import type { RealProviderSmokeRunResult, SmokeQualityRunner } from '../../delivery/index.js';
import type { GitCommandRunner } from '../../git/index.js';
import type { RuntimeProviderFactoryOptions, WorkspaceAdapters } from '../../providers/index.js';
import { createRuntimeWorkspaceAdapters } from '../../providers/index.js';
import { loadWorkspaceEnvironment, runLocalDoctor } from '../../setup/index.js';
import type { DoctorCheck, DoctorProbeOptions } from '../../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface SmokeCommandDeliveryOptions {
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly smokeVerifier?: SmokeUrlVerifier | undefined;
  readonly qualityRunner?: SmokeQualityRunner | undefined;
  readonly now?: (() => Date) | undefined;
}

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
    options.io.stderr('Refusing real-provider smoke run: missing --confirm-real-provider-smoke. No doctor, config, MCP, run state, git, OpenCode, PR, deployment, ledger, or provider writes were started.\n');
    return 1;
  }

  const cwd = options.cwd ?? process.cwd();
  const environment = loadWorkspaceEnvironment(cwd);
  options.io.stdout(`Real-provider smoke run requested for ${ticketKey}.\n`);
  options.io.stdout('Scope: one Jira ticket, exactly one selected repository, develop PR, staging verification, production PR preparation only.\n');
  options.io.stdout('Production boundary: Ewokbot will not merge production or deploy production. Human approval remains required.\n');
  options.io.stdout('Phase 1/6: running local doctor before side effects.\n');

  const doctorReport = runLocalDoctor(cwd, options.doctorOptions);
  renderDoctorReport(options.io, doctorReport.checks);

  if (!doctorReport.ok) {
    options.io.stderr('Smoke preflight failed: fix FAIL checks above before running real-provider smoke. No run state, git, OpenCode, PR, deployment, ledger, or provider writes were started.\n');
    return 1;
  }

  options.io.stdout(`Phase 2/6: loading ${ewokbotWorkspaceConfigPath} and validating explicit MCP provider modes.\n`);
  const config = await loadSmokeConfig(cwd, options.configPath, options.io);

  if (config === undefined) {
    return 1;
  }

  const modeError = validateSmokeConfig(config);

  if (modeError !== undefined) {
    options.io.stderr(`${modeError}\n`);
    options.io.stderr(`Smoke preflight failed before runtime adapters or provider side effects. Set jira.mode, github.mode, and railway.mode to mcp in ${ewokbotWorkspaceConfigPath}.\n`);
    return 1;
  }

  options.io.stdout(`Provider Modes: Jira=${config.jira.mode}, GitHub=${config.github.mode}, Railway=${config.railway.mode}.\n`);
  options.io.stdout('Phase 3/6: validating MCP client/tool readiness through typed runtime adapters.\n');
  const adapters = await createSmokeAdapters(config, environment, options.runtimeMcp, options.io);

  if (adapters === undefined) {
    return 1;
  }

  options.io.stdout('Phase 4/6: reading one Jira ticket through TicketPort.getTicket and planning exactly one repository.\n');

  try {
    const result = await runRealProviderSmokeRun({
      ticketKey,
      config,
      adapters,
      rootPath: cwd,
      runId: options.runId,
      now: options.delivery?.now,
      gitCommandRunner: options.delivery?.gitCommandRunner,
      smokeVerifier: options.delivery?.smokeVerifier,
      qualityRunner: options.delivery?.qualityRunner,
      environment
    });

    renderSmokeResult(options.io, ticketKey, result);
    return result.state.state === 'PRODUCTION_PR_OPENED' ? 0 : 1;
  } catch (error) {
    options.io.stderr(`Smoke run failed: ${error instanceof Error ? error.message : String(error)}\n`);
    options.io.stderr('Review local reports if a run id was created. Production merge/deploy was not attempted.\n');
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
  const failures = [
    config.jira.mode === 'mcp' ? undefined : `Jira mode is ${config.jira.mode}`,
    config.github.mode === 'mcp' ? undefined : `GitHub mode is ${config.github.mode}`,
    config.railway.mode === 'mcp' ? undefined : `Railway mode is ${config.railway.mode}`,
    config.workspace.stagingBranch === 'develop' ? undefined : `workspace staging branch is ${config.workspace.stagingBranch}`,
    config.workspace.productionBranch === 'main' ? undefined : `workspace production branch is ${config.workspace.productionBranch}`
  ].filter((message): message is string => message !== undefined);

  if (failures.length === 0) {
    return undefined;
  }

  return `Real-provider smoke requires Jira, GitHub, and Railway provider modes to be explicit MCP mode and the existing develop-to-main production PR contract. ${failures.join('; ')}.`;
}

async function loadSmokeConfig(cwd: string, configPath: string | undefined, io: CliProgramIO): Promise<Awaited<ReturnType<typeof loadWorkspaceConfig>> | undefined> {
  try {
    return await loadWorkspaceConfig(resolve(cwd, configPath ?? ewokbotWorkspaceConfigPath), { workspaceRoot: cwd });
  } catch (error) {
    io.stderr(`Smoke preflight failed while loading ${ewokbotWorkspaceConfigPath}: ${formatError(error)}\n`);
    io.stderr('No runtime adapters, run state, git, OpenCode, PR, deployment, ledger, or provider writes were started.\n');
    return undefined;
  }
}

async function createSmokeAdapters(
  config: Awaited<ReturnType<typeof loadWorkspaceConfig>>,
  environment: Readonly<Record<string, string | undefined>>,
  runtimeMcp: CliRuntimeMcpOptions | undefined,
  io: CliProgramIO
): Promise<WorkspaceAdapters | undefined> {
  try {
    return await createRuntimeWorkspaceAdapters({
      config,
      environment,
      ...(runtimeMcp ?? {})
    } satisfies RuntimeProviderFactoryOptions);
  } catch (error) {
    io.stderr(`Smoke preflight failed while validating MCP readiness: ${formatError(error)}\n`);
    io.stderr('No run state, git, OpenCode, PR, deployment, ledger, or provider writes were started.\n');
    return undefined;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderDoctorReport(io: CliProgramIO, checks: readonly DoctorCheck[]): void {
  for (const check of checks) {
    const nextStep = check.nextStep === undefined ? '' : ` Next step: ${check.nextStep}`;
    io.stdout(`${check.status.toUpperCase()}: ${check.label}: ${check.message}${nextStep}\n`);
  }
}

function renderSmokeResult(io: CliProgramIO, ticketKey: string, result: RealProviderSmokeRunResult): void {
  io.stdout('Phase 5/6: delivery contracts completed through staging verification.\n');
  io.stdout('Phase 6/6: production PR preparation completed; merge/deploy remains human-only.\n');
  io.stdout(`Smoke run ${ticketKey} completed as ${result.runId}.\n`);
  io.stdout(`Final State: ${result.state.state}\n`);
  io.stdout(`Run Directory: ${result.runDirectoryPath}\n`);
  io.stdout(`Plan Report: ${result.planReportPath}\n`);
  io.stdout(`Implementation Log: ${result.implementationLogPath ?? 'n/a'}\n`);
  io.stdout(`Quality Report: ${result.qualityReportPath ?? 'n/a'}\n`);
  io.stdout(`Staging Report: ${result.stagingReportPath ?? 'n/a'}\n`);
  io.stdout(`Final Report: ${result.finalReportPath ?? 'n/a'}\n`);
  io.stdout('Human-only production boundary: review and merge the production PR manually if appropriate; Ewokbot did not merge or deploy production.\n');
}
