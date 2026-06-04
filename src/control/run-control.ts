import { constants, type Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import type { DeliveryRunStateRecord } from '../domain/index.js';
import { getRunDirectoryPath, getRunStateFilePath } from '../state/index.js';
import { getNextActionForState, readRunState } from '../status/index.js';

export type RunControlDecision = 'approved' | 'rejected';

export interface WorkspaceControlRecord {
  readonly paused: boolean;
  readonly updatedAt: string;
  readonly reason: string;
}

export interface RunResumeIntent {
  readonly requestedAt: string;
  readonly state: DeliveryRunStateRecord['state'];
  readonly nextAction: string;
}

export interface RunDecisionIntent {
  readonly decision: RunControlDecision;
  readonly decidedAt: string;
  readonly state: DeliveryRunStateRecord['state'];
  readonly note: string;
}

export interface RunControlRecord {
  readonly runId: string;
  readonly ticketKey: string;
  readonly updatedAt: string;
  readonly resume?: RunResumeIntent;
  readonly decision?: RunDecisionIntent;
}

export interface RunLookupResult {
  readonly ticketKey: string;
  readonly runId: string;
  readonly state: DeliveryRunStateRecord;
  readonly runDirectory: string;
}

export interface ListedRun {
  readonly ticketKey: string;
  readonly runId: string;
  readonly state: DeliveryRunStateRecord['state'];
  readonly updatedAt: string;
  readonly decision: string;
  readonly nextAction: string;
}

export interface RunLogFile {
  readonly label: string;
  readonly path: string;
  readonly content?: string;
}

interface ResolvedLogPath {
  readonly path: string;
  readonly safe: boolean;
}

export interface RunLogsResult {
  readonly lookup: RunLookupResult;
  readonly files: readonly RunLogFile[];
}

export interface RunControlStore {
  readWorkspaceControl(): Promise<WorkspaceControlRecord | undefined>;
  isWorkspacePaused(): Promise<boolean>;
  pauseWorkspace(reason: string, now?: Date): Promise<WorkspaceControlRecord>;
  clearWorkspacePause(now?: Date): Promise<WorkspaceControlRecord>;
  readRunControl(ticketKey: string, runId: string): Promise<RunControlRecord | undefined>;
  writeResumeIntent(lookup: RunLookupResult, now?: Date): Promise<RunControlRecord>;
  writeDecision(lookup: RunLookupResult, decision: RunControlDecision, now?: Date): Promise<RunControlRecord>;
  listRuns(): Promise<readonly ListedRun[]>;
  resolveRun(runId: string): Promise<RunLookupResult>;
  readRunLogs(runId: string): Promise<RunLogsResult>;
}

const workspaceControlPath = join('runs', 'control.json');
const runControlFileName = 'control.json';
const knownReportFiles: readonly RunLogFile[] = [
  { label: 'Plan', path: 'plan.md' },
  { label: 'Implementation Log', path: 'implementation-log.md' },
  { label: 'Quality Report', path: 'quality-report.md' },
  { label: 'Staging Report', path: 'staging-report.md' },
  { label: 'Final Report', path: 'final-report.md' }
];

export function getWorkspaceControlFilePath(): string {
  return workspaceControlPath;
}

export function getRunControlFilePath(ticketKey: string, runId: string): string {
  return join(getRunDirectoryPath(ticketKey, runId), runControlFileName);
}

export class JsonRunControlStore implements RunControlStore {
  constructor(private readonly rootPath: string = process.cwd()) {}

  async readWorkspaceControl(): Promise<WorkspaceControlRecord | undefined> {
    return readOptionalJson<WorkspaceControlRecord>(join(this.rootPath, workspaceControlPath));
  }

  async isWorkspacePaused(): Promise<boolean> {
    return (await this.readWorkspaceControl())?.paused === true;
  }

  async pauseWorkspace(reason: string, now: Date = new Date()): Promise<WorkspaceControlRecord> {
    const record: WorkspaceControlRecord = {
      paused: true,
      updatedAt: now.toISOString(),
      reason: reason.trim().length === 0 ? 'Paused by operator.' : reason.trim()
    };

    await writeJson(join(this.rootPath, workspaceControlPath), record);
    return record;
  }

  async clearWorkspacePause(now: Date = new Date()): Promise<WorkspaceControlRecord> {
    const existing = await this.readWorkspaceControl();
    const record: WorkspaceControlRecord = {
      paused: false,
      updatedAt: now.toISOString(),
      reason: existing?.reason ?? 'Workspace pause cleared by operator resume intent.'
    };

    await writeJson(join(this.rootPath, workspaceControlPath), record);
    return record;
  }

  async readRunControl(ticketKey: string, runId: string): Promise<RunControlRecord | undefined> {
    return readOptionalJson<RunControlRecord>(join(this.rootPath, getRunControlFilePath(ticketKey, runId)));
  }

  async writeResumeIntent(lookup: RunLookupResult, now: Date = new Date()): Promise<RunControlRecord> {
    const existing = await this.readRunControl(lookup.ticketKey, lookup.runId);
    const record: RunControlRecord = {
      ...baseRunControl(existing, lookup, now),
      resume: {
        requestedAt: now.toISOString(),
        state: lookup.state.state,
        nextAction: getNextActionForState(lookup.state)
      }
    };

    await writeJson(join(this.rootPath, getRunControlFilePath(lookup.ticketKey, lookup.runId)), record);
    return record;
  }

  async writeDecision(lookup: RunLookupResult, decision: RunControlDecision, now: Date = new Date()): Promise<RunControlRecord> {
    const existing = await this.readRunControl(lookup.ticketKey, lookup.runId);
    const record: RunControlRecord = {
      ...baseRunControl(existing, lookup, now),
      decision: {
        decision,
        decidedAt: now.toISOString(),
        state: lookup.state.state,
        note: 'Local operator decision only; no merge or deployment was performed.'
      }
    };

    await writeJson(join(this.rootPath, getRunControlFilePath(lookup.ticketKey, lookup.runId)), record);
    return record;
  }

  async listRuns(): Promise<readonly ListedRun[]> {
    const lookups = await this.scanRunStates();
    const listed = await Promise.all(
      lookups.map(async (lookup) => {
        const control = await this.readRunControl(lookup.ticketKey, lookup.runId);
        return {
          ticketKey: lookup.ticketKey,
          runId: lookup.runId,
          state: lookup.state.state,
          updatedAt: lookup.state.timestamps.updatedAt,
          decision: control?.decision?.decision ?? 'none',
          nextAction: getNextActionForState(lookup.state)
        } satisfies ListedRun;
      })
    );

    return listed.sort(compareListedRuns);
  }

  async resolveRun(runId: string): Promise<RunLookupResult> {
    const matches = (await this.scanRunStates()).filter((lookup) => lookup.runId === runId);

    if (matches.length === 0) {
      throw new Error(`No run found for run id ${runId}. Expected runs/<ticket-key>/${runId}/state.json.`);
    }

    if (matches.length > 1) {
      throw new Error(`Run id ${runId} is ambiguous across tickets: ${matches.map((match) => match.ticketKey).sort().join(', ')}.`);
    }

    return matches[0];
  }

  async readRunLogs(runId: string): Promise<RunLogsResult> {
    const lookup = await this.resolveRun(runId);
    const state = lookup.state;
    const runDirectory = join(this.rootPath, lookup.runDirectory);
    const latestQualityReport = state.qualityReports[state.qualityReports.length - 1];
    const implementationLogPaths = state.devRuns.map((devRun) => devRun.implementationLogPath);
    const qualityLogPaths = (latestQualityReport === undefined ? [] : [...latestQualityReport.required, ...latestQualityReport.optional])
      .flatMap((gate) => [gate.stdoutLogPath, gate.stderrLogPath]);
    const paths = uniqueLogFiles([...knownReportFiles.map((file) => file.path), ...implementationLogPaths, ...qualityLogPaths]);
    const files = await Promise.all(
      paths.map(async (path) => {
        const resolvedLogPath = resolveLogPath(this.rootPath, runDirectory, path);
        return {
          label: labelForLogPath(path),
          path,
          content: resolvedLogPath.safe ? await readOptionalText(resolvedLogPath.path) : 'blocked unsafe log path'
        };
      })
    );

    return { lookup, files };
  }

  private async scanRunStates(): Promise<readonly RunLookupResult[]> {
    const runsDirectory = join(this.rootPath, 'runs');
    const ticketEntries = await readDirectoryIfExists(runsDirectory);
    const lookups: RunLookupResult[] = [];

    for (const ticketEntry of ticketEntries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      const ticketKey = ticketEntry.name;
      const ticketDirectory = join(runsDirectory, ticketKey);
      const runEntries = await readDirectoryIfExists(ticketDirectory);

      for (const runEntry of runEntries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
        const runId = runEntry.name;
        const statePath = join(this.rootPath, getRunStateFilePath(ticketKey, runId));

        if (await fileExists(statePath)) {
          lookups.push({
            ticketKey,
            runId,
            state: await readRunState(this.rootPath, ticketKey, runId),
            runDirectory: getRunDirectoryPath(ticketKey, runId)
          });
        }
      }
    }

    return lookups;
  }
}

export function renderRunsList(runs: readonly ListedRun[]): string {
  if (runs.length === 0) {
    return 'No runs found under runs/<ticket-key>/<run-id>/state.json. Start one with ewokbot run <ticket-key> or ewokbot worker start --once.';
  }

  return [
    'Run ID | Ticket | State | Updated | Decision | Next Action',
    ...runs.map((run) => `${run.runId} | ${run.ticketKey} | ${run.state} | ${run.updatedAt} | ${run.decision} | ${run.nextAction}`)
  ].join('\n');
}

export async function renderRunInspection(store: RunControlStore, lookup: RunLookupResult): Promise<string> {
  const control = await store.readRunControl(lookup.ticketKey, lookup.runId);
  const reportPaths = knownReportFiles.map((file) => join(lookup.runDirectory, file.path));
  const devLogPaths = lookup.state.devRuns.map((devRun) => devRun.implementationLogPath);
  const qualityLogPaths = lookup.state.qualityReports
    .flatMap((report) => [...report.required, ...report.optional])
    .flatMap((gate) => [gate.stdoutLogPath, gate.stderrLogPath]);
  const allReportPaths = uniqueLogFiles([...reportPaths, ...devLogPaths, ...qualityLogPaths]);

  return [
    `Run ID: ${lookup.runId}`,
    `Ticket: ${lookup.ticketKey}`,
    `State: ${lookup.state.state}`,
    `Run Directory: ${lookup.runDirectory}`,
    `Updated: ${lookup.state.timestamps.updatedAt}`,
    `Next Action: ${getNextActionForState(lookup.state)}`,
    `Decision: ${control?.decision?.decision ?? 'none'}`,
    `Decision At: ${control?.decision?.decidedAt ?? 'not recorded'}`,
    `Resume Requested At: ${control?.resume?.requestedAt ?? 'not recorded'}`,
    `Resume State: ${control?.resume?.state ?? 'not recorded'}`,
    `Resume Next Action: ${control?.resume?.nextAction ?? 'not recorded'}`,
    'Report Paths:',
    ...(allReportPaths.length === 0 ? ['- none'] : allReportPaths.map((path) => `- ${path}`)),
    'Human-only Production Note: approval and rejection commands record local intent only; Ewokbot does not merge or deploy production automatically.'
  ].join('\n');
}

export function renderRunLogs(result: RunLogsResult): string {
  const sections = result.files.map((file) => {
    const content = file.content === undefined ? 'not found' : file.content.trimEnd();
    return [`## ${file.label}`, `Path: ${file.path}`, '', content].join('\n');
  });

  return [`# Run Logs ${result.lookup.runId}`, `Ticket: ${result.lookup.ticketKey}`, `Run Directory: ${result.lookup.runDirectory}`, '', ...sections].join('\n');
}

function baseRunControl(existing: RunControlRecord | undefined, lookup: RunLookupResult, now: Date): RunControlRecord {
  return {
    runId: lookup.runId,
    ticketKey: lookup.ticketKey,
    updatedAt: now.toISOString(),
    ...(existing?.resume === undefined ? {} : { resume: existing.resume }),
    ...(existing?.decision === undefined ? {} : { decision: existing.decision })
  };
}

function compareListedRuns(left: ListedRun, right: ListedRun): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }

  if (left.ticketKey !== right.ticketKey) {
    return left.ticketKey.localeCompare(right.ticketKey);
  }

  return left.runId.localeCompare(right.runId);
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readDirectoryIfExists(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function uniqueLogFiles(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      unique.push(path);
    }
  }

  return unique;
}

function resolveLogPath(rootPath: string, runDirectory: string, path: string): ResolvedLogPath {
  const resolvedRunDirectory = resolve(runDirectory);
  const candidatePath = path.startsWith('runs/') ? resolve(rootPath, path) : resolve(runDirectory, path);
  const safePrefix = `${resolvedRunDirectory}${sep}`;

  return { path: candidatePath, safe: candidatePath.startsWith(safePrefix) };
}

function labelForLogPath(path: string): string {
  const known = knownReportFiles.find((file) => file.path === path);

  if (known !== undefined) {
    return known.label;
  }

  if (path.endsWith('.stdout.log')) {
    return `Quality Stdout ${path}`;
  }

  if (path.endsWith('.stderr.log')) {
    return `Quality Stderr ${path}`;
  }

  return `Log ${path}`;
}
