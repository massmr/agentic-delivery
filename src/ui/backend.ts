import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isMap, parseDocument } from 'yaml';

import { JsonRunControlStore, type ListedRun } from '../control/index.js';
import type { DeliveryTicket } from '../domain/index.js';
import type { TicketPort } from '../ports/index.js';
import { createRuntimeTicketPort, type RuntimeProviderFactoryOptions } from '../providers/index.js';
import { runLocalDoctor, type DoctorReport } from '../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../workspace-layout.js';
import {
  WorkspaceConfigError,
  loadWorkspaceConfig,
  parseWorkspaceConfig,
  type WorkspaceConfig,
  type WorkspaceRepositoryConfig
} from '../config/index.js';

export interface InvocationControlBackendOptions {
  readonly workspaceRoot: string;
  readonly ticketPort?: TicketPort | undefined;
  readonly runtimeMcp?: Pick<RuntimeProviderFactoryOptions, 'mcpClients' | 'createMcpClient' | 'mcpAllowlist' | 'mcpAuditSink'> | undefined;
}

export interface UiWorkspaceConfigStatus {
  readonly path: string;
  readonly exists: boolean;
  readonly parses: boolean;
  readonly issues: readonly string[];
}

export interface UiProviderSummary {
  readonly jira: Record<string, unknown>;
  readonly github: Record<string, unknown>;
  readonly railway: Record<string, unknown>;
  readonly devRunner: Record<string, unknown>;
}

export interface UiDeliveryPolicySummary {
  readonly noRemoteChecks: string;
  readonly develop: Record<string, unknown>;
  readonly main: Record<string, unknown>;
}

export interface UiMcpServerSummary {
  readonly id: string;
  readonly displayName?: string | undefined;
  readonly transport: string;
  readonly configuredProviders: readonly string[];
  readonly command?: string | undefined;
  readonly url?: string | undefined;
  readonly envVarNames: readonly string[];
  readonly timeoutMs?: number | undefined;
}

export interface UiRepositorySummary {
  readonly id: string;
  readonly path: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly url: string;
  readonly stagingDeployment?: UiRailwayMappingSummary | undefined;
}

export interface UiRailwayMappingSummary {
  readonly projectId?: string | undefined;
  readonly environmentId?: string | undefined;
  readonly serviceId?: string | undefined;
  readonly serviceUrl?: string | undefined;
  readonly verification: string;
  readonly status: 'configured' | 'placeholder';
}

export interface UiRunSummary {
  readonly runId: string;
  readonly ticketKey: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly reports: readonly UiReportSummary[];
}

export interface UiReportSummary {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly exists: boolean;
}

export interface InvocationControlSummary {
  readonly workspaceRoot: string;
  readonly config: UiWorkspaceConfigStatus;
  readonly workspaceSettings?: UiWorkspaceSettings | undefined;
  readonly providers?: UiProviderSummary | undefined;
  readonly deliveryPolicy?: UiDeliveryPolicySummary | undefined;
  readonly mcpServers: readonly UiMcpServerSummary[];
  readonly repositories: readonly UiRepositorySummary[];
  readonly railwayMappings: readonly UiRailwayMappingSummary[];
  readonly runs: readonly UiRunSummary[];
}

export interface UiWorkspaceSettings {
  readonly name: string;
  readonly autonomy: string;
  readonly maxConcurrentTickets: number;
}

export interface UiRunInspection {
  readonly run: UiRunSummary;
  readonly state: unknown;
}

export interface UiReportReadResult {
  readonly report: UiReportSummary;
  readonly content?: string | undefined;
  readonly error?: string | undefined;
}

export interface UiConfigPatch {
  readonly workspaceName?: string | undefined;
  readonly autonomy?: string | undefined;
  readonly maxConcurrentTickets?: number | undefined;
}

const reportDefinitions = [
  { id: 'plan', label: 'Plan', fileName: 'plan.md' },
  { id: 'implementation-log', label: 'Implementation Log', fileName: 'implementation-log.md' },
  { id: 'quality-report', label: 'Quality Report', fileName: 'quality-report.md' },
  { id: 'staging-report', label: 'Staging Report', fileName: 'staging-report.md' },
  { id: 'final-report', label: 'Final Report', fileName: 'final-report.md' },
  { id: 'agent-completion', label: 'Agent Completion', fileName: 'agent-completion.json' },
  { id: 'core-safety', label: 'Core Safety', fileName: 'core-safety.json' },
  { id: 'test-relevance', label: 'Test Relevance', fileName: 'test-relevance.json' }
] as const;

export async function buildInvocationControlSummary(options: InvocationControlBackendOptions): Promise<InvocationControlSummary> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const configStatus = readConfigStatus(workspaceRoot);
  const runs = await listUiRuns(workspaceRoot);

  if (!configStatus.parses) {
    return {
      workspaceRoot,
      config: configStatus,
      mcpServers: [],
      repositories: [],
      railwayMappings: [],
      runs
    };
  }

  const config = await loadWorkspaceConfig(join(workspaceRoot, ewokbotWorkspaceConfigPath), { workspaceRoot });

  return {
    workspaceRoot,
    config: configStatus,
    workspaceSettings: {
      name: config.workspace.name,
      autonomy: config.workspace.autonomy,
      maxConcurrentTickets: config.workspace.maxConcurrentTickets
    },
    providers: summarizeProviders(config),
    deliveryPolicy: summarizeDeliveryPolicy(config),
    mcpServers: summarizeMcpServers(config),
    repositories: config.repos.map(summarizeRepository),
    railwayMappings: config.repos.flatMap((repo) => repo.deployments?.staging === undefined ? [] : [summarizeRailwayMapping(repo)]),
    runs
  };
}

export function runInvocationControlDoctor(workspaceRoot: string): DoctorReport {
  return runLocalDoctor(resolve(workspaceRoot));
}

export async function listInvocationControlTickets(options: InvocationControlBackendOptions): Promise<readonly DeliveryTicket[]> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const config = await loadWorkspaceConfig(join(workspaceRoot, ewokbotWorkspaceConfigPath), { workspaceRoot });
  const ticketPort = options.ticketPort ?? await createRuntimeTicketPort({
    config,
    requiredJiraMcpActions: ['listBacklog'],
    ...options.runtimeMcp
  });

  return ticketPort.listBacklog();
}

export async function inspectInvocationControlRun(workspaceRoot: string, runId: string): Promise<UiRunInspection> {
  const store = new JsonRunControlStore(resolve(workspaceRoot));
  const lookup = await store.resolveRun(runId);

  return {
    run: summarizeRun(resolve(workspaceRoot), lookup.state),
    state: lookup.state
  };
}

export async function readInvocationControlReport(workspaceRoot: string, runId: string, reportId: string): Promise<UiReportReadResult> {
  const inspection = await inspectInvocationControlRun(workspaceRoot, runId);
  const report = inspection.run.reports.find((candidate) => candidate.id === reportId);

  if (report === undefined) {
    throw new Error(`Report '${reportId}' is not known for run '${runId}'.`);
  }

  const root = resolve(workspaceRoot);
  const absolutePath = resolve(root, report.path);

  if (!isInside(root, absolutePath)) {
    return { report, error: 'Blocked unsafe report path.' };
  }

  if (!report.exists) {
    return { report, error: 'Report file was not found.' };
  }

  return { report, content: readFileSync(absolutePath, 'utf8') };
}

export function applyInvocationControlConfigPatch(workspaceRoot: string, patch: UiConfigPatch): UiWorkspaceConfigStatus {
  assertAllowedConfigPatch(patch);
  const root = resolve(workspaceRoot);
  const configPath = join(root, ewokbotWorkspaceConfigPath);

  if (!existsSync(configPath)) {
    throw new Error(`${ewokbotWorkspaceConfigPath} does not exist.`);
  }

  const document = parseDocument(readFileSync(configPath, 'utf8'));
  const workspace = document.get('workspace', true);

  if (!isMap(workspace)) {
    throw new Error(`${ewokbotWorkspaceConfigPath} is missing a workspace mapping.`);
  }

  if (patch.workspaceName !== undefined) {
    workspace.set('name', patch.workspaceName);
  }

  if (patch.autonomy !== undefined) {
    workspace.set('autonomy', patch.autonomy);
  }

  if (patch.maxConcurrentTickets !== undefined) {
    workspace.set('max_concurrent_tickets', patch.maxConcurrentTickets);
  }

  const nextYaml = document.toString();
  parseWorkspaceConfig(nextYaml, { workspaceRoot: root });
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, nextYaml, 'utf8');

  return readConfigStatus(root);
}

function assertAllowedConfigPatch(patch: UiConfigPatch): void {
  const allowed = new Set(['workspaceName', 'autonomy', 'maxConcurrentTickets']);
  const unsupported = Object.keys(patch).filter((key) => !allowed.has(key));

  if (unsupported.length > 0) {
    throw new Error(`Unsupported UI config field(s): ${unsupported.join(', ')}.`);
  }
}

async function listUiRuns(workspaceRoot: string): Promise<readonly UiRunSummary[]> {
  const store = new JsonRunControlStore(workspaceRoot);
  const runs = await store.listRuns();
  return runs.map((run) => summarizeListedRun(workspaceRoot, run));
}

function readConfigStatus(workspaceRoot: string): UiWorkspaceConfigStatus {
  const configPath = join(workspaceRoot, ewokbotWorkspaceConfigPath);

  if (!existsSync(configPath)) {
    return { path: ewokbotWorkspaceConfigPath, exists: false, parses: false, issues: [`Missing ${ewokbotWorkspaceConfigPath}.`] };
  }

  try {
    parseWorkspaceConfig(readFileSync(configPath, 'utf8'), { workspaceRoot });
    return { path: ewokbotWorkspaceConfigPath, exists: true, parses: true, issues: [] };
  } catch (error) {
    const message = error instanceof WorkspaceConfigError ? error.message : String(error);
    return { path: ewokbotWorkspaceConfigPath, exists: true, parses: false, issues: [message] };
  }
}

function summarizeProviders(config: WorkspaceConfig): UiProviderSummary {
  return {
    jira: {
      mode: config.jira.mode,
      baseUrl: config.jira.baseUrl,
      projectKeys: config.jira.projectKeys,
      mcpServerId: config.jira.mcpServerId,
      mcpToolNames: config.jira.mcpToolNames
    },
    github: {
      mode: config.github.mode,
      organization: config.github.organization,
      mcpServerId: config.github.mcpServerId,
      mcpToolNames: config.github.mcpToolNames
    },
    railway: {
      mode: config.railway.mode,
      stagingBranch: config.railway.stagingBranch,
      productionBranch: config.railway.productionBranch,
      mcpServerId: config.railway.mcpServerId,
      mcpToolNames: config.railway.mcpToolNames
    },
    devRunner: {
      mode: config.devRunner.mode,
      provider: config.devRunner.provider,
      command: config.devRunner.command,
      args: config.devRunner.args,
      envVarNames: config.devRunner.envVarNames
    }
  };
}

function summarizeDeliveryPolicy(config: WorkspaceConfig): UiDeliveryPolicySummary {
  return {
    noRemoteChecks: config.delivery.checks.noRemoteChecks,
    develop: summarizePullRequestPolicy(config.delivery.pullRequests.develop),
    main: summarizePullRequestPolicy(config.delivery.pullRequests.main)
  };
}

function summarizePullRequestPolicy(policy: WorkspaceConfig['delivery']['pullRequests']['develop']): Record<string, unknown> {
  return {
    autoMerge: policy.autoMerge,
    mergeMethod: policy.mergeMethod,
    requireChecks: policy.requireChecks,
    requireHumanApproval: policy.requireHumanApproval,
    draftMode: policy.draftMode,
    verifyDeployment: policy.afterMerge.verifyDeployment
  };
}

function summarizeMcpServers(config: WorkspaceConfig): readonly UiMcpServerSummary[] {
  return config.mcpServers.map((server) => ({
    id: server.id,
    displayName: server.displayName,
    transport: server.transport,
    configuredProviders: configuredProvidersForServer(config, server.id),
    command: server.transport === 'stdio' ? server.command : undefined,
    url: server.transport === 'http' ? server.url : undefined,
    envVarNames: server.envVarNames ?? [],
    timeoutMs: server.timeoutMs
  }));
}

function configuredProvidersForServer(config: WorkspaceConfig, serverId: string): readonly string[] {
  const providers: string[] = [];

  if (config.jira.mcpServerId === serverId) providers.push('jira');
  if (config.github.mcpServerId === serverId) providers.push('github');
  if (config.railway.mcpServerId === serverId) providers.push('railway');

  return providers;
}

function summarizeRepository(repo: WorkspaceRepositoryConfig): UiRepositorySummary {
  return {
    id: repo.name,
    path: repo.localPath,
    owner: repo.name.includes('/') ? repo.name.split('/')[0] ?? repo.name : repo.name,
    name: repo.name.includes('/') ? repo.name.split('/')[1] ?? repo.name : repo.name,
    defaultBranch: repo.defaultBranch,
    url: repo.url,
    stagingDeployment: repo.deployments?.staging === undefined ? undefined : summarizeRailwayMapping(repo)
  };
}

function summarizeRailwayMapping(repo: WorkspaceRepositoryConfig): UiRailwayMappingSummary {
  const mapping = repo.deployments?.staging;

  if (mapping === undefined) {
    return { verification: 'none', status: 'placeholder' };
  }

  const configured = [mapping.projectId, mapping.environmentId, mapping.serviceId].every((value) => value !== undefined && value.trim().length > 0);

  return {
    projectId: mapping.projectId,
    environmentId: mapping.environmentId,
    serviceId: mapping.serviceId,
    verification: mapping.verification.mode,
    status: configured ? 'configured' : 'placeholder'
  };
}

function summarizeListedRun(workspaceRoot: string, run: ListedRun): UiRunSummary {
  return {
    runId: run.runId,
    ticketKey: run.ticketKey,
    state: run.state,
    updatedAt: run.updatedAt,
    reports: summarizeReports(workspaceRoot, run.ticketKey, run.runId)
  };
}

function summarizeRun(workspaceRoot: string, state: { readonly runId: string; readonly ticket: { readonly key: string }; readonly state: string; readonly timestamps: { readonly updatedAt: string } }): UiRunSummary {
  return {
    runId: state.runId,
    ticketKey: state.ticket.key,
    state: state.state,
    updatedAt: state.timestamps.updatedAt,
    reports: summarizeReports(workspaceRoot, state.ticket.key, state.runId)
  };
}

function summarizeReports(workspaceRoot: string, ticketKey: string, runId: string): readonly UiReportSummary[] {
  return reportDefinitions.map((definition) => {
    const path = join('.ewokbot', 'runs', ticketKey, runId, definition.fileName);
    return {
      id: definition.id,
      label: definition.label,
      path,
      exists: existsSync(join(workspaceRoot, path))
    };
  });
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath.length === 0 || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
}
