import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DevRunInput, DevRunResult, DevRunner } from '../../domain/index.js';
import { redactCommand } from './redaction.js';

export interface MockOpenCodeRunnerOptions {
  readonly now?: () => Date;
}

export class MockOpenCodeRunner implements DevRunner {
  private readonly now: () => Date;

  constructor(options: MockOpenCodeRunnerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async run(input: DevRunInput): Promise<DevRunResult> {
    const startedAtDate = this.now();
    const startedAt = startedAtDate.toISOString();
    const finishedAtDate = this.now();
    const finishedAt = finishedAtDate.toISOString();
    const durationMs = Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime());

    await mkdir(dirname(input.implementationLogPath), { recursive: true });
    await writeFile(input.implementationLogPath, renderMockImplementationLog(input, startedAt, finishedAt), 'utf8');

    return {
      provider: 'opencode',
      ticketKey: input.ticketKey,
      runId: input.runId,
      repository: input.repository,
      branchName: input.branchName,
      baseBranch: input.baseBranch,
      command: redactCommand(input.command, input.commandArgs ?? []),
      workingDirectory: input.workingDirectory,
      implementationLogPath: input.implementationLogPath,
      startedAt,
      finishedAt,
      durationMs,
      attempts: [
        {
          attempt: 1,
          command: redactCommand(input.command, input.commandArgs ?? []),
          workingDirectory: input.workingDirectory,
          startedAt,
          finishedAt,
          durationMs,
          exitCode: 0,
          status: 'passed',
          summary: 'Mock OpenCode implementation passed without spawning a process.'
        }
      ],
      status: 'passed',
      summary: 'Mock OpenCode implementation completed successfully without shell, process, or network execution.'
    };
  }
}

function renderMockImplementationLog(input: DevRunInput, startedAt: string, finishedAt: string): string {
  return [
    `# Implementation Log ${input.ticketKey}`,
    '',
    `- Run ID: ${input.runId}`,
    `- Repository: ${input.repository.owner}/${input.repository.name}`,
    `- Branch: ${input.branchName}`,
    `- Base branch: ${input.baseBranch}`,
    `- Working directory: ${input.workingDirectory}`,
    `- Command: ${redactCommand(input.command, input.commandArgs ?? [])}`,
    `- Started at: ${startedAt}`,
    `- Finished at: ${finishedAt}`,
    '',
    '## Mock Implementation Summary',
    '',
    'MockOpenCodeRunner wrote this deterministic implementation log and returned a passed DevRunResult without spawning OpenCode, shell commands, provider calls, or network requests.',
    '',
    '## Prompt Preview',
    '',
    input.prompt,
    ''
  ].join('\n');
}
