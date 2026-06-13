import { startInvocationControlUi, type InvocationControlUiHandle, type StartInvocationControlUiOptions } from '../../ui/local-ui.js';
import type { CliProgramIO } from '../program.js';

export type InvocationControlUiLauncher = (options: StartInvocationControlUiOptions) => Promise<InvocationControlUiHandle>;

export interface UiCommandOptions {
  readonly cwd?: string | undefined;
  readonly io: CliProgramIO;
  readonly launcher?: InvocationControlUiLauncher | undefined;
}

export interface ParsedUiCommandOptions {
  readonly port?: number | undefined;
  readonly hostname?: string | undefined;
}

export async function runUiCommand(args: readonly string[], options: UiCommandOptions): Promise<number> {
  const parsed = parseUiCommandOptions(args);
  const launcher = options.launcher ?? startInvocationControlUi;
  const handle = await launcher({
    workspaceRoot: options.cwd ?? process.cwd(),
    hostname: parsed.hostname,
    port: parsed.port
  });

  options.io.stdout(`Ewokbot UI: ${handle.url}\n`);
  options.io.stdout(`Workspace API: ${handle.apiUrl}\n`);
  options.io.stdout('Local-only invocation control UI started. Press Ctrl+C to stop.\n');

  if (options.launcher !== undefined) {
    return 0;
  }

  return waitForUiProcess(handle);
}

async function waitForUiProcess(handle: InvocationControlUiHandle): Promise<number> {
  return new Promise<number>((resolve) => {
    let settled = false;
    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      handle.process.off('exit', onExit);
    };
    const finish = async (code: number) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      await handle.close();
      resolve(code);
    };
    const onExit = (code: number | null) => {
      void finish(code ?? 0);
    };
    const onSigint = () => {
      void finish(130);
    };
    const onSigterm = () => {
      void finish(143);
    };

    handle.process.once('exit', onExit);
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  });
}

export function parseUiCommandOptions(args: readonly string[]): ParsedUiCommandOptions {
  let port: number | undefined;
  let hostname: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--port') {
      port = parsePort(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg?.startsWith('--port=') === true) {
      port = parsePort(arg.slice('--port='.length));
      continue;
    }

    if (arg === '--hostname') {
      hostname = parseHostname(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg?.startsWith('--hostname=') === true) {
      hostname = parseHostname(arg.slice('--hostname='.length));
      continue;
    }

    throw new Error(`Unknown ui option: ${arg ?? ''}`);
  }

  return { port, hostname };
}

function parsePort(value: string | undefined): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('UI port must be an integer between 1 and 65535.');
  }

  return port;
}

function parseHostname(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error('UI hostname must be a non-empty value.');
  }

  return value.trim();
}
