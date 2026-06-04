import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  runApproveCommand,
  runInspectCommand,
  runLogsCommand,
  runPauseCommand,
  runRejectCommand,
  runResumeCommand,
  runRunsCommand
} from './commands/control.js';
import { runInitCommand } from './commands/init.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runPlanCommand } from './commands/plan.js';
import { parseQualityCommandOptions, runQualityCommand } from './commands/quality.js';
import { parseRunCommandOptions, runRunCommand } from './commands/run.js';
import { runScanCommand } from './commands/scan.js';
import { parseSmokeCommandOptions, runSmokeCommand } from './commands/smoke.js';
import type { SmokeCommandDeliveryOptions } from './commands/smoke.js';
import { parseStatusCommandOptions, runStatusCommand } from './commands/status.js';
import { parseWorkerCommandOptions, runWorkerCommand } from './commands/worker.js';
import type { RuntimeProviderFactoryOptions } from '../providers/index.js';
import type { DoctorProbeOptions } from '../setup/index.js';
import type { InitPrompter } from './commands/init.js';

const HELP_TEXT = [
  'Ewokbot',
  '',
  'Autonomous software delivery runtime. The ewokbot, ewok, and agentic binaries are aliases.',
  '',
  'Usage:',
  '  ewokbot [--help]',
  '  ewokbot init',
  '  ewokbot doctor',
  '  ewokbot scan',
  '  ewokbot plan <ticket-key>',
  '  ewokbot run <ticket-key> [--run-id <run-id>]',
  '  ewokbot smoke <ticket-key> --confirm-real-provider-smoke [--run-id <run-id>]',
  '  ewokbot runs',
  '  ewokbot inspect <run-id>',
  '  ewokbot pause',
  '  ewokbot resume <run-id>',
  '  ewokbot approve <run-id>',
  '  ewokbot reject <run-id>',
  '  ewokbot logs <run-id>',
  '  ewokbot worker start [--once] [--dry-run] [--concurrency <n>] [--max-cycles <n>] [--poll-interval-ms <ms>]',
  '  ewokbot worker [--concurrency <n>] [--max-cycles <n>] [--max-attempts <n>] [--poll-interval-ms <ms>] (legacy)',
  '  ewokbot status <ticket-key> [--run-id <run-id>]',
  '  ewokbot quality <repo-path> --ticket-key <ticket-key> [--run-id <run-id>]',
  '',
  'Commands:',
  '  init        Create config/workspace.yml and .env.example for local onboarding.',
  '  doctor      Validate local setup files without live provider calls.',
  '  scan        List Jira backlog tickets through the configured typed TicketPort.',
  '  plan        Create a local mock plan and run state for one ticket.',
  '  run         Execute one ticket through the complete mock delivery lifecycle.',
  '  smoke       Execute one explicitly confirmed real-provider single-ticket smoke run.',
  '  runs        List persisted local runs without contacting providers.',
  '  inspect     Show detailed local run state, reports, control intent, and next action.',
  '  pause       Pause workspace worker processing using runs/control.json.',
  '  resume      Record a local resume intent for a resumable run and clear workspace pause.',
  '  approve     Record local human approval for a production PR; does not merge or deploy.',
  '  reject      Record local human rejection for a production PR; does not merge or deploy.',
  '  logs        Print known local report and quality log files for a run.',
  '  worker      Run the foreground worker runtime; start mode adds locking, dry-run, and graceful shutdown.',
  '  status      Inspect existing local run state and next action.',
  '  quality     Run local repository quality gates and write a quality report.',
  '',
  'Options:',
  '  -h, --help  Show this help message.',
  '',
  'Mock mode remains the default. No credentials, production merge, or production deployment are performed by default.'
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
  readonly initPrompter?: InitPrompter;
  readonly doctorOptions?: DoctorProbeOptions | undefined;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
  readonly smokeDelivery?: SmokeCommandDeliveryOptions | undefined;
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

      if (args.length === 0) {
        const cwd = options.cwd ?? process.cwd();
        const configExists = existsSync(join(cwd, 'config', 'workspace.yml'));
        const hint = configExists
          ? 'No command provided. Run ewokbot doctor to validate setup, ewokbot worker to process work, or ewokbot status to inspect a run.'
          : 'No command provided. Run ewokbot init to create config/workspace.yml and .env.example.';

        io.stdout(`${hint}\n\n`);
        printHelp();
        return 0;
      }

      if (args.some(isHelpFlag)) {
        printHelp();
        return 0;
      }

      if (args[0] === 'init') {
        return runInitCommand({ cwd: options.cwd, io, args: args.slice(1), prompter: options.initPrompter });
      }

      if (args[0] === 'doctor') {
        return runDoctorCommand({ cwd: options.cwd, io, doctorOptions: options.doctorOptions });
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

      if (args[0] === 'smoke') {
        const parsed = parseSmokeCommandOptions(args.slice(1));

        if (parsed.ticketKey === undefined || parsed.ticketKey.trim().length === 0) {
          io.stderr('Missing ticket key for smoke command.\n\n');
          printHelp();
          return 1;
        }

        return runSmokeCommand(parsed.ticketKey, {
          cwd: options.cwd,
          configPath: options.configPath,
          io,
          runId: parsed.runId,
          confirmed: parsed.confirmed,
          doctorOptions: options.doctorOptions,
          runtimeMcp: options.runtimeMcp,
          delivery: options.smokeDelivery
        });
      }

      if (args[0] === 'runs') {
        return runRunsCommand({ cwd: options.cwd, io });
      }

      if (args[0] === 'inspect') {
        const runId = args[1];

        if (runId === undefined || runId.trim().length === 0) {
          io.stderr('Missing run id for inspect command.\n\n');
          printHelp();
          return 1;
        }

        return runInspectCommand(runId, { cwd: options.cwd, io });
      }

      if (args[0] === 'pause') {
        return runPauseCommand({ cwd: options.cwd, io });
      }

      if (args[0] === 'resume') {
        const runId = args[1];

        if (runId === undefined || runId.trim().length === 0) {
          io.stderr('Missing run id for resume command.\n\n');
          printHelp();
          return 1;
        }

        return runResumeCommand(runId, { cwd: options.cwd, io });
      }

      if (args[0] === 'approve') {
        const runId = args[1];

        if (runId === undefined || runId.trim().length === 0) {
          io.stderr('Missing run id for approve command.\n\n');
          printHelp();
          return 1;
        }

        return runApproveCommand(runId, { cwd: options.cwd, io });
      }

      if (args[0] === 'reject') {
        const runId = args[1];

        if (runId === undefined || runId.trim().length === 0) {
          io.stderr('Missing run id for reject command.\n\n');
          printHelp();
          return 1;
        }

        return runRejectCommand(runId, { cwd: options.cwd, io });
      }

      if (args[0] === 'logs') {
        const runId = args[1];

        if (runId === undefined || runId.trim().length === 0) {
          io.stderr('Missing run id for logs command.\n\n');
          printHelp();
          return 1;
        }

        return runLogsCommand(runId, { cwd: options.cwd, io });
      }

      if (args[0] === 'worker') {
        const parsed = parseWorkerCommandOptions(args.slice(1));

        return runWorkerCommand({
          cwd: options.cwd,
          configPath: options.configPath,
          io,
          workerMode: parsed.workerMode,
          once: parsed.once,
          dryRun: parsed.dryRun,
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
