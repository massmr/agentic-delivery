import { JsonRunControlStore, renderRunInspection, renderRunLogs, renderRunsList } from '../../control/index.js';
import { assertStateResumable } from '../../status/index.js';
import type { CliProgramIO } from '../program.js';

export interface ControlCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
}

export async function runRunsCommand(options: ControlCommandOptions): Promise<number> {
  try {
    const store = new JsonRunControlStore(options.cwd ?? process.cwd());
    options.io.stdout(`${renderRunsList(await store.listRuns())}\n`);
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runInspectCommand(runId: string, options: ControlCommandOptions): Promise<number> {
  try {
    const store = new JsonRunControlStore(options.cwd ?? process.cwd());
    const lookup = await store.resolveRun(runId);
    options.io.stdout(`${await renderRunInspection(store, lookup)}\n`);
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runPauseCommand(options: ControlCommandOptions): Promise<number> {
  try {
    const store = new JsonRunControlStore(options.cwd ?? process.cwd());
    const record = await store.pauseWorkspace('Paused by operator.');
    options.io.stdout(`Workspace paused: true\nUpdated: ${record.updatedAt}\nReason: ${record.reason}\nNo provider, OpenCode, git, pull request, merge, or deployment side effects were performed.\n`);
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runResumeCommand(runId: string, options: ControlCommandOptions): Promise<number> {
  try {
    const store = new JsonRunControlStore(options.cwd ?? process.cwd());
    const lookup = await store.resolveRun(runId);
    assertStateResumable(lookup.state);
    const control = await store.writeResumeIntent(lookup);
    const workspaceControl = await store.clearWorkspacePause();

    options.io.stdout([
      `Resume intent recorded for ${lookup.ticketKey}/${lookup.runId}.`,
      `Run State: ${lookup.state.state}`,
      `Resume Requested At: ${control.resume?.requestedAt ?? control.updatedAt}`,
      `Workspace Paused: ${workspaceControl.paused}`,
      'No provider, OpenCode, git, pull request, merge, deployment, or production side effects were performed.'
    ].join('\n'));
    options.io.stdout('\n');
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function runApproveCommand(runId: string, options: ControlCommandOptions): Promise<number> {
  return runDecisionCommand(runId, 'approved', options);
}

export async function runRejectCommand(runId: string, options: ControlCommandOptions): Promise<number> {
  return runDecisionCommand(runId, 'rejected', options);
}

export async function runLogsCommand(runId: string, options: ControlCommandOptions): Promise<number> {
  try {
    const store = new JsonRunControlStore(options.cwd ?? process.cwd());
    options.io.stdout(`${renderRunLogs(await store.readRunLogs(runId))}\n`);
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runDecisionCommand(runId: string, decision: 'approved' | 'rejected', options: ControlCommandOptions): Promise<number> {
  try {
    const store = new JsonRunControlStore(options.cwd ?? process.cwd());
    const lookup = await store.resolveRun(runId);

    if (lookup.state.state !== 'PRODUCTION_PR_OPENED') {
      throw new Error(`Run ${lookup.ticketKey}/${lookup.runId} must be in PRODUCTION_PR_OPENED before ${decision}; current state is ${lookup.state.state}.`);
    }

    const control = await store.writeDecision(lookup, decision);
    options.io.stdout([
      `Production decision recorded locally for ${lookup.ticketKey}/${lookup.runId}: ${decision}.`,
      `Decision At: ${control.decision?.decidedAt ?? control.updatedAt}`,
      'state.json was not changed.',
      'No merge, production deployment, provider call, OpenCode run, git push, or MCP/network side effect was performed.'
    ].join('\n'));
    options.io.stdout('\n');
    return 0;
  } catch (error) {
    options.io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
