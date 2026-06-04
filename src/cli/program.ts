import { runInitCommand } from './commands/init.js';
import { runPlanCommand } from './commands/plan.js';
import { parseQualityCommandOptions, runQualityCommand } from './commands/quality.js';
import { parseRunCommandOptions, runRunCommand } from './commands/run.js';
import { runScanCommand } from './commands/scan.js';
import { parseStatusCommandOptions, runStatusCommand } from './commands/status.js';
import { parseWorkerCommandOptions, runWorkerCommand } from './commands/worker.js';
import type { RuntimeProviderFactoryOptions } from '../providers/index.js';

const HELP_TEXT = [
  'Agentic Delivery',
  '',
  'Usage:',
  '  agentic [--help]',
  '  agentic init',
  '  agentic scan',
  '  agentic plan <ticket-key>',
  '  agentic run <ticket-key> [--run-id <run-id>]',
  '  agentic worker [--concurrency <n>] [--max-cycles <n>] [--max-attempts <n>] [--poll-interval-ms <ms>]',
  '  agentic status <ticket-key> [--run-id <run-id>]',
  '  agentic quality <repo-path> --ticket-key <ticket-key> [--run-id <run-id>]',
  '',
  'Commands:',
  '  init        Copy config/workspace.example.yml to config/workspace.yml.',
  '  scan        List Jira backlog tickets through the configured typed TicketPort.',
  '  plan        Create a local mock plan and run state for one ticket.',
  '  run         Execute one ticket through the complete mock delivery lifecycle.',
  '  worker      Process queued Jira backlog tickets with concurrency, retry, and safe stop limits.',
  '  status      Inspect existing local run state and next action.',
  '  quality     Run local repository quality gates and write a quality report.',
  '',
  'Options:',
  '  -h, --help  Show this help message.',
  '',
  'Mock mode only. No real provider integrations, credentials, production merge, or production deployment are performed.'
].join('\n');

export interface CliProgramIO {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export type CliRuntimeMcpOptions = Pick<RuntimeProviderFactoryOptions, 'mcpClients' | 'createMcpClient' | 'mcpAllowlist' | 'mcpAuditSink'>;

export interface CliProgramOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly io?: CliProgramIO;
  readonly initTemplatePath?: string;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
}

export interface CliProgram {
  run(argv: readonly string[]): Promise<number>;
}

function defaultStdout(text: string): void {
  process.stdout.write(text);
}

function defaultStderr(text: string): void {
  process.stderr.write(text);
}

function isHelpFlag(value: string): boolean {
  return value === '--help' || value === '-h';
}

export function createCliProgram(options: CliProgramOptions = {}): CliProgram {
  const io = options.io ?? {
    stdout: defaultStdout,
    stderr: defaultStderr
  };

  function printHelp(): void {
    io.stdout(`${HELP_TEXT}\n`);
  }

  return {
    async run(argv: readonly string[]): Promise<number> {
      const args = argv.slice(2);

      if (args.length === 0 || args.some(isHelpFlag)) {
        printHelp();
        return 0;
      }

      if (args[0] === 'init') {
        return runInitCommand({ cwd: options.cwd, io, templatePath: options.initTemplatePath });
      }

      if (args[0] === 'scan') {
        return runScanCommand({ cwd: options.cwd, configPath: options.configPath, io, runtimeMcp: options.runtimeMcp });
      }

      if (args[0] === 'plan') {
        const ticketKey = args[1];

        if (ticketKey === undefined || ticketKey.trim().length === 0) {
          io.stderr('Missing ticket key for plan command.\n\n');
          printHelp();
          return 1;
        }

        return runPlanCommand(ticketKey, { cwd: options.cwd, configPath: options.configPath, io });
      }

      if (args[0] === 'run') {
        const parsed = parseRunCommandOptions(args.slice(1));

        if (parsed.ticketKey === undefined || parsed.ticketKey.trim().length === 0) {
          io.stderr('Missing ticket key for run command.\n\n');
          printHelp();
          return 1;
        }

        return runRunCommand(parsed.ticketKey, { cwd: options.cwd, configPath: options.configPath, io, runId: parsed.runId });
      }

      if (args[0] === 'worker') {
        const parsed = parseWorkerCommandOptions(args.slice(1));

        return runWorkerCommand({
          cwd: options.cwd,
          configPath: options.configPath,
          io,
          concurrencyLimit: parsed.concurrencyLimit,
          maxAttempts: parsed.maxAttempts,
          maxBackoffMs: parsed.maxBackoffMs,
          maxCycles: parsed.maxCycles,
          baseBackoffMs: parsed.baseBackoffMs,
          pollIntervalMs: parsed.pollIntervalMs,
          runtimeMcp: options.runtimeMcp
        });
      }

      if (args[0] === 'status') {
        const parsed = parseStatusCommandOptions(args.slice(1));

        if (parsed.ticketKey === undefined || parsed.ticketKey.trim().length === 0) {
          io.stderr('Missing ticket key for status command.\n\n');
          printHelp();
          return 1;
        }

        return runStatusCommand(parsed.ticketKey, { cwd: options.cwd, io, runId: parsed.runId });
      }

      if (args[0] === 'quality') {
        const parsed = parseQualityCommandOptions(args.slice(1));

        if (parsed.repositoryPath === undefined || parsed.repositoryPath.trim().length === 0) {
          io.stderr('Missing repository path for quality command.\n\n');
          printHelp();
          return 1;
        }

        return runQualityCommand(parsed.repositoryPath, { cwd: options.cwd, io, runId: parsed.runId, ticketKey: parsed.ticketKey });
      }

      io.stderr(`Unknown command: ${args[0]}\n\n`);
      printHelp();
      return 1;
    }
  };
}
