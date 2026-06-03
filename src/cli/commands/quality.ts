import { join, resolve } from 'node:path';

import type { DeliveryRunStateRecord } from '../../domain/run.js';
import type { QualityReport } from '../../domain/quality.js';
import { buildQualityGateDefinitions, loadRepositoryQualityConfig } from '../../quality/quality-config.js';
import { QualityRunner } from '../../quality/quality-runner.js';
import { MarkdownReportWriter } from '../../reports/markdown-report-writer.js';
import { JsonRunStateStore, createDeliveryRunStateRecord, getRunDirectoryPath, transitionDeliveryRunState } from '../../state/run-state-store.js';
import type { CliProgramIO } from '../program.js';

export interface QualityCommandOptions {
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly now?: () => Date;
  readonly runId?: string;
  readonly ticketKey?: string;
}

export async function runQualityCommand(repositoryPath: string, options: QualityCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const ticketKey = options.ticketKey?.trim();

  if (ticketKey === undefined || ticketKey.length === 0) {
    options.io.stderr('Missing required --ticket-key for quality command.\n');
    return 1;
  }

  const runId = options.runId ?? createRunId(ticketKey, now());
  const repositoryRoot = resolve(cwd, repositoryPath);
  const stateStore = new JsonRunStateStore(cwd);
  const startedAt = now().toISOString();
  const initialState = createDeliveryRunStateRecord({
    runId,
    ticket: {
      provider: 'jira',
      key: ticketKey,
      url: `https://mock-jira.local/browse/${ticketKey}`
    },
    targetRepositories: [],
    timestamps: {
      createdAt: startedAt,
      updatedAt: startedAt
    }
  });
  const runningState = transitionDeliveryRunState(initialState, 'LOCAL_CHECKS_RUNNING', startedAt);

  await stateStore.write(runningState);

  try {
    const config = await loadRepositoryQualityConfig(repositoryRoot);
    const gates = buildQualityGateDefinitions(config, repositoryRoot);
    const logRootPath = join(cwd, getRunDirectoryPath(ticketKey, runId), 'quality-logs');
    const report = await new QualityRunner({ logRootPath, now }).run(gates);
    const reportPath = await new MarkdownReportWriter(cwd).writeQuality(ticketKey, runId, report);
    const completedAt = now().toISOString();
    const stateWithReport = appendQualityReport(runningState, report);

    if (report.status === 'failed') {
      const failureState: DeliveryRunStateRecord = {
        ...transitionDeliveryRunState(stateWithReport, 'FAILED', completedAt),
        failure: {
          state: 'LOCAL_CHECKS_RUNNING',
          reason: summarizeRequiredFailure(report),
          occurredAt: completedAt
        }
      };

      await stateStore.write(failureState);
      options.io.stderr(`Quality failed for ${ticketKey} as ${runId}.\n`);
      options.io.stderr(`Report: ${reportPath}\n`);
      return 1;
    }

    await stateStore.write(transitionDeliveryRunState(stateWithReport, 'LOCAL_CHECKS_PASSED', completedAt));
    options.io.stdout(`Quality passed for ${ticketKey} as ${runId}.\n`);
    options.io.stdout(`Report: ${reportPath}\n`);
    return 0;
  } catch (error: unknown) {
    const failedAt = now().toISOString();
    const reason = error instanceof Error ? error.message : String(error);
    const failedState: DeliveryRunStateRecord = {
      ...transitionDeliveryRunState(runningState, 'FAILED', failedAt),
      failure: {
        state: 'LOCAL_CHECKS_RUNNING',
        reason,
        occurredAt: failedAt
      }
    };

    await stateStore.write(failedState);
    options.io.stderr(`Quality configuration failed for ${ticketKey} as ${runId}: ${reason}\n`);
    return 1;
  }
}

export function parseQualityCommandOptions(args: readonly string[]): { readonly repositoryPath?: string; readonly runId?: string; readonly ticketKey?: string } {
  const [repositoryPath, ...flags] = args;
  let ticketKey: string | undefined;
  let runId: string | undefined;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];

    if (flag === '--ticket-key') {
      ticketKey = value;
      index += 1;
    } else if (flag === '--run-id') {
      runId = value;
      index += 1;
    }
  }

  return { repositoryPath, runId, ticketKey };
}

function appendQualityReport(state: DeliveryRunStateRecord, report: QualityReport): DeliveryRunStateRecord {
  return {
    ...state,
    qualityReports: [...state.qualityReports, report]
  };
}

function summarizeRequiredFailure(report: QualityReport): string {
  const failedGate = report.required.find((result) => result.status === 'failed');

  return failedGate === undefined ? 'Required quality gate failed.' : failedGate.summary;
}

function createRunId(ticketKey: string, date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.]/gu, '').replace('T', '-').replace('Z', '');
  return `${ticketKey}-${timestamp}`;
}
