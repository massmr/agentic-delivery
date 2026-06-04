import type { CliProgramIO } from '../cli/program.js';

export type WorkerLogLevel = 'info' | 'warn' | 'error';

export interface WorkerLogger {
  log(level: WorkerLogLevel, event: string, fields?: Readonly<Record<string, string | number | boolean | undefined>>): void;
}

export interface CreateWorkerLoggerOptions {
  readonly io: CliProgramIO;
  readonly now?: (() => Date) | undefined;
}

export function createWorkerLogger(options: CreateWorkerLoggerOptions): WorkerLogger {
  const now = options.now ?? (() => new Date());

  return {
    log(level, event, fields = {}) {
      const renderedFields = Object.entries(fields)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      const suffix = renderedFields.length === 0 ? '' : ` ${renderedFields}`;
      options.io.stdout(`${now().toISOString()} ${level.toUpperCase()} ${event}${suffix}\n`);
    }
  };
}
