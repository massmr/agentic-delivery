import { join } from 'node:path';

import type { BranchRef, DeliveryRunStateRecord, DeliveryTicket, DevRunner, QualityGateDefinition, RepositoryConfig } from '../../domain/index.js';
import type { RunStateStore } from '../../state/index.js';
import { getRunDirectoryPath, recordDevRunResult, transitionDeliveryRunState } from '../../state/index.js';
import { buildOpenCodeImplementationPrompt } from './prompt-builder.js';

export interface RunOpenCodeImplementationInput {
  readonly state: DeliveryRunStateRecord;
  readonly ticket: DeliveryTicket;
  readonly repository: RepositoryConfig;
  readonly branch: BranchRef;
  readonly qualityGates?: readonly QualityGateDefinition[];
  readonly definitionOfDone: readonly string[];
  readonly command: string;
  readonly commandArgs?: readonly string[] | undefined;
  readonly timeoutMs?: number | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly environmentAllowlist?: readonly string[] | undefined;
  readonly abortSignal?: AbortSignal | undefined;
  readonly rootPath: string;
  readonly stateStore: RunStateStore;
  readonly runner: DevRunner;
  readonly maxAttempts: number;
  readonly now?: () => Date;
}

export async function runOpenCodeImplementation(input: RunOpenCodeImplementationInput): Promise<DeliveryRunStateRecord> {
  const now = input.now ?? (() => new Date());
  const implementingAt = now().toISOString();
  const implementingState = transitionDeliveryRunState(input.state, 'IMPLEMENTING', implementingAt);

  await input.stateStore.write(implementingState);

  const prompt = buildOpenCodeImplementationPrompt({
    ticket: input.ticket,
    analysis: implementingState.ticketAnalysis ?? {
      ticketKey: input.ticket.ref.key,
      goal: input.ticket.summary,
      requirements: [],
      constraints: [],
      risks: []
    },
    repository: {
      ...input.repository,
      qualityGates: input.qualityGates ?? input.repository.qualityGates
    },
    branch: {
      name: input.branch.name,
      baseBranch: input.branch.baseBranch
    },
    definitionOfDone: input.definitionOfDone
  });
  const result = await input.runner.run({
    ticketKey: input.ticket.ref.key,
    runId: input.state.runId,
    repository: input.repository.ref,
    branchName: input.branch.name,
    baseBranch: input.branch.baseBranch,
    command: input.command,
    commandArgs: input.commandArgs ?? [],
    workingDirectory: input.repository.localPath,
    workspaceRoot: input.rootPath,
    prompt,
    implementationLogPath: join(input.rootPath, getRunDirectoryPath(input.ticket.ref.key, input.state.runId), 'implementation-log.md'),
    maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs,
    environment: input.environment,
    environmentAllowlist: input.environmentAllowlist,
    abortSignal: input.abortSignal
  });
  const completedAt = now().toISOString();
  const completedState = recordDevRunResult(implementingState, result, completedAt);

  await input.stateStore.write(completedState);

  return completedState;
}
