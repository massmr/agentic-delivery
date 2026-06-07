import { resolve } from 'node:path';

import { HarnessFixtureError, listHarnessFixtureIds, runHarness } from '../../harness/index.js';
import type { HarnessFixtureResult } from '../../harness/index.js';
import type { CliProgramIO } from '../program.js';

export interface HarnessCommandOptions {
  readonly cwd?: string | undefined;
  readonly io: CliProgramIO;
  readonly args: readonly string[];
  readonly fixturesRoot?: string | undefined;
}

export async function runHarnessCommand(options: HarnessCommandOptions): Promise<number> {
  const [subcommand, ...args] = options.args;

  if (subcommand !== 'run') {
    options.io.stderr('Missing harness subcommand. Use: ewokbot harness run <fixture-id> or ewokbot harness run --all.\n');
    return 1;
  }

  const cwd = options.cwd ?? process.cwd();
  const fixturesRoot = resolve(cwd, options.fixturesRoot ?? 'fixtures/harness');

  try {
    const parsed = parseHarnessRunArgs(args);
    const result = await runHarness({
      fixtureId: parsed.fixtureId,
      all: parsed.all,
      cwd,
      fixturesRoot
    });

    options.io.stdout(`Harness fixtures root: ${result.fixturesRoot}\n`);
    options.io.stdout('Fixture | Status | Score | Final State | Evidence\n');
    options.io.stdout('--- | --- | --- | --- | ---\n');

    for (const fixtureResult of result.results) {
      renderFixtureResult(options.io, fixtureResult);
    }

    options.io.stdout(`Harness result: ${result.status.toUpperCase()}\n`);
    options.io.stdout('Local-only boundary preserved: no live OpenCode, Jira, GitHub, Railway, Vercel, MCP, git push, PR, merge, or deploy was attempted.\n');
    return result.status === 'passed' ? 0 : 1;
  } catch (error) {
    if (error instanceof HarnessFixtureError) {
      options.io.stderr(`${error.message}\n`);
      await renderAvailableFixtures(options.io, fixturesRoot);
      return 1;
    }

    const message = error instanceof Error ? error.message : String(error);
    options.io.stderr(`Harness run failed: ${message}\n`);
    await renderAvailableFixtures(options.io, fixturesRoot);
    return 1;
  }
}

export function parseHarnessRunArgs(args: readonly string[]): { readonly fixtureId?: string | undefined; readonly all: boolean } {
  let all = false;
  let fixtureId: string | undefined;

  for (const arg of args) {
    if (arg === '--all') {
      all = true;
    } else if (fixtureId === undefined) {
      fixtureId = arg;
    }
  }

  if (all && fixtureId !== undefined) {
    throw new HarnessFixtureError('Choose either a fixture id or --all, not both.');
  }

  if (!all && fixtureId === undefined) {
    throw new HarnessFixtureError('Missing fixture id. Use: ewokbot harness run <fixture-id> or ewokbot harness run --all.');
  }

  return { fixtureId, all };
}

function renderFixtureResult(io: CliProgramIO, result: HarnessFixtureResult): void {
  io.stdout(`${result.fixtureId} | ${result.status} | ${result.score.passed}/${result.score.total} | ${result.finalState} | ${result.runDirectoryPath}\n`);

  for (const check of result.checks.filter((candidate) => !candidate.passed)) {
    io.stdout(`  - ${check.name}: expected ${check.expected}, got ${check.actual}\n`);
  }
}

async function renderAvailableFixtures(io: CliProgramIO, fixturesRoot: string): Promise<void> {
  try {
    const fixtureIds = await listHarnessFixtureIds(fixturesRoot);
    io.stderr(`Available fixtures: ${fixtureIds.join(', ') || 'none'}\n`);
  } catch {
    io.stderr('Available fixtures: none\n');
  }
}
