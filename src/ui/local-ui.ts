import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startInvocationControlApiServer, type InvocationControlApiServer } from './api-server.js';
import type { InvocationControlBackendOptions } from './backend.js';

export interface InvocationControlUiHandle {
  readonly url: string;
  readonly apiUrl: string;
  readonly process: ChildProcess;
  close(): Promise<void>;
}

export interface StartInvocationControlUiOptions extends InvocationControlBackendOptions {
  readonly hostname?: string | undefined;
  readonly port?: number | undefined;
  readonly uiDirectory?: string | undefined;
  readonly nextCommand?: string | undefined;
  readonly readinessTimeoutMs?: number | undefined;
  readonly readinessPollMs?: number | undefined;
}

export async function startInvocationControlUi(options: StartInvocationControlUiOptions): Promise<InvocationControlUiHandle> {
  const hostname = options.hostname ?? '127.0.0.1';
  const port = options.port ?? 3000;
  const url = `http://${hostname}:${port}`;
  const api = await startInvocationControlApiServer({ ...options, hostname, port: undefined, allowedOrigin: url });
  const uiDirectory = options.uiDirectory ?? resolveDefaultUiDirectory();
  const command = options.nextCommand ?? defaultNextCommand(uiDirectory);
  const closeApi = createApiCloser(api);
  const args = command.endsWith('pnpm') || command.endsWith('pnpm.cmd')
    ? ['exec', 'next', 'dev', uiDirectory, '--hostname', hostname, '--port', String(port)]
    : ['dev', uiDirectory, '--hostname', hostname, '--port', String(port)];
  const child = spawn(command, args, {
    cwd: resolve(uiDirectory, '..'),
    env: {
      ...process.env,
      EWOKBOT_UI_WORKSPACE_ROOT: resolve(options.workspaceRoot),
      EWOKBOT_UI_API_BASE: api.url
    },
    shell: false,
    stdio: 'inherit'
  });

  try {
    await waitForUiReadiness(child, url, api.url, {
      timeoutMs: options.readinessTimeoutMs ?? 30_000,
      pollMs: options.readinessPollMs ?? 250
    });
  } catch (error) {
    await closeUi(child, closeApi);
    throw error;
  }

  return {
    url,
    apiUrl: api.url,
    process: child,
    close: async () => closeUi(child, closeApi)
  };
}

interface ReadinessOptions {
  readonly timeoutMs: number;
  readonly pollMs: number;
}

async function waitForUiReadiness(child: ChildProcess, url: string, apiUrl: string, options: ReadinessOptions): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined;
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exit = { code, signal };
  };
  child.once('exit', onExit);

  try {
    while (Date.now() <= deadline) {
      if (await isHealthyUi(url, apiUrl)) {
        return;
      }

      await sleep(options.pollMs);
    }
  } finally {
    child.off('exit', onExit);
  }

  const code = exit?.code ?? child.exitCode;
  const signal = exit?.signal ?? child.signalCode;
  const exitDetails = exit !== undefined || code !== null || signal !== null
    ? ` Last observed launcher exit: code ${code ?? 'none'}, signal ${signal ?? 'none'}.`
    : '';
  throw new Error(`Timed out after ${options.timeoutMs}ms waiting for the local UI at ${url} to render with a reachable workspace API.${exitDetails} Check whether Next can bind the requested host and port.`);
}

async function isHealthyUi(url: string, apiUrl: string): Promise<boolean> {
  if (!await isJsonEndpointHealthy(`${apiUrl}/api/summary`) || !await isJsonEndpointHealthy(`${apiUrl}/api/doctor`)) {
    return false;
  }

  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return body.includes('Ewokbot Invocation Control')
      && !body.includes('Application error')
      && !body.includes('fetch failed')
      && !body.includes('ECONNREFUSED');
  } catch {
    return false;
  }
}

async function isJsonEndpointHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return false;
    }

    await response.json();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeUi(child: ChildProcess, closeApi: () => Promise<void>): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }

  await closeApi();
}

function createApiCloser(api: InvocationControlApiServer): () => Promise<void> {
  let closed = false;
  return async () => {
    if (closed) {
      return;
    }

    closed = true;
    await api.close();
  };
}

function resolveDefaultUiDirectory(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const candidates = [
    resolve(dirname(currentFile), '..', '..', '..', 'ui'),
    resolve(dirname(currentFile), '..', '..', 'ui')
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function defaultNextCommand(uiDirectory: string): string {
  const rootDirectory = resolve(uiDirectory, '..');
  const nextBinary = process.platform === 'win32' ? 'next.cmd' : 'next';
  const candidates = [
    join(rootDirectory, 'node_modules', '.bin', nextBinary),
    join(process.cwd(), 'node_modules', '.bin', nextBinary),
    join(rootDirectory, 'node_modules', 'next', 'dist', 'bin', 'next'),
    join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
}
