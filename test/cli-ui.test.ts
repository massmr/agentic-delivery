import * as assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import {
  createCliProgram,
  startInvocationControlUi,
  type CliProgramIO,
  type StartInvocationControlUiOptions
} from '../src/index.js';

test('ewokbot ui starts a local invocation UI through the injected launcher', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-cli-'));
  const captured = createCapturedIO();
  let launched: StartInvocationControlUiOptions | undefined;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    uiLauncher: async (options) => {
      launched = options;
      return {
        url: 'http://127.0.0.1:4199',
        apiUrl: 'http://127.0.0.1:51234',
        process: new EventEmitter() as never,
        close: async () => {}
      };
    }
  }).run(['node', 'ewokbot', 'ui', '--port', '4199', '--hostname', '127.0.0.1']);

  assert.equal(exitCode, 0);
  assert.deepEqual(launched, { workspaceRoot: rootPath, hostname: '127.0.0.1', port: 4199 });
  assert.match(captured.stdout, /Ewokbot UI: http:\/\/127\.0\.0\.1:4199/u);
  assert.match(captured.stdout, /Workspace API: http:\/\/127\.0\.0\.1:51234/u);
  assert.match(captured.stdout, /Local-only invocation control UI started/u);
  assert.equal(captured.stderr, '');
});

test('ewokbot ui wires injected Railway discovery into the local UI launcher without live provider calls', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-cli-discovery-'));
  const captured = createCapturedIO();
  const railwayDiscoveryPort = {
    discover: async () => ({ projects: [], services: [] })
  };
  let launched: StartInvocationControlUiOptions | undefined;

  const exitCode = await createCliProgram({
    cwd: rootPath,
    io: captured.io,
    uiRailwayDiscovery: railwayDiscoveryPort,
    uiLauncher: async (options) => {
      launched = options;
      return {
        url: 'http://127.0.0.1:4199',
        apiUrl: 'http://127.0.0.1:51234',
        process: new EventEmitter() as never,
        close: async () => {}
      };
    }
  }).run(['node', 'ewokbot', 'ui']);

  assert.equal(exitCode, 0);
  assert.equal(launched?.workspaceRoot, rootPath);
  assert.equal(launched?.railwayDiscoveryPort, railwayDiscoveryPort);
  assert.equal(captured.stderr, '');
});

test('ewokbot ui rejects unsafe launcher options before starting', async () => {
  const captured = createCapturedIO();
  let launched = false;

  await assert.rejects(
    () => createCliProgram({
      io: captured.io,
      uiLauncher: async () => {
        launched = true;
        throw new Error('should not launch');
      }
    }).run(['node', 'ewokbot', 'ui', '--port', '0']),
    /UI port must be an integer between 1 and 65535/u
  );

  assert.equal(launched, false);
});

test('local UI launcher keeps the workspace API off the public UI port', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-launcher-'));
  const uiDirectory = join(rootPath, 'ui');
  const fakeNext = join(rootPath, 'fake-next.mjs');
  mkdirSync(uiDirectory, { recursive: true });
  writeFileSync(fakeNext, fakeNextServerScript(), 'utf8');
  chmodSync(fakeNext, 0o755);

  const handle = await startInvocationControlUi({
    workspaceRoot: rootPath,
    hostname: '127.0.0.1',
    port: 31999,
    uiDirectory,
    nextCommand: fakeNext,
    readinessTimeoutMs: 1_000,
    readinessPollMs: 25
  });

  try {
    assert.equal(handle.url, 'http://127.0.0.1:31999');
    assert.match(handle.apiUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.notEqual(handle.apiUrl, handle.url);
  } finally {
    await handle.close();
  }
});

test('local UI launcher waits until the UI port is reachable before resolving', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-ready-'));
  const uiDirectory = join(rootPath, 'ui');
  const fakeNext = join(rootPath, 'fake-next.mjs');
  mkdirSync(uiDirectory, { recursive: true });
  writeFileSync(fakeNext, fakeNextServerScript({ delayMs: 150 }), 'utf8');
  chmodSync(fakeNext, 0o755);

  const startedAt = Date.now();
  const handle = await startInvocationControlUi({
    workspaceRoot: rootPath,
    hostname: '127.0.0.1',
    port: 32009,
    uiDirectory,
    nextCommand: fakeNext,
    readinessTimeoutMs: 2_000,
    readinessPollMs: 25
  });

  try {
    assert.equal(handle.url, 'http://127.0.0.1:32009');
    assert.ok(Date.now() - startedAt >= 125);
    assert.equal((await fetch(handle.url)).ok, true);
  } finally {
    await handle.close();
  }
});

test('local UI launcher waits for a healthy app route, not a shell response', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-shell-'));
  const uiDirectory = join(rootPath, 'ui');
  const fakeNext = join(rootPath, 'fake-next.mjs');
  mkdirSync(uiDirectory, { recursive: true });
  writeFileSync(fakeNext, fakeNextServerScript({ healthyDelayMs: 150 }), 'utf8');
  chmodSync(fakeNext, 0o755);

  const startedAt = Date.now();
  const handle = await startInvocationControlUi({
    workspaceRoot: rootPath,
    hostname: '127.0.0.1',
    port: 32014,
    uiDirectory,
    nextCommand: fakeNext,
    readinessTimeoutMs: 2_000,
    readinessPollMs: 25
  });

  try {
    assert.ok(Date.now() - startedAt >= 125);
    const response = await fetch(handle.url);
    assert.equal(response.ok, true);
    assert.match(await response.text(), /Ewokbot Invocation Control/u);
  } finally {
    await handle.close();
  }
});

test('local UI API remains alive when a wrapper exits after detaching the real UI server', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-detach-'));
  const uiDirectory = join(rootPath, 'ui');
  const fakeWrapper = join(rootPath, 'fake-wrapper.mjs');
  const detachedServer = join(rootPath, 'detached-server.mjs');
  const pidFile = join(rootPath, 'detached-server.pid');
  mkdirSync(uiDirectory, { recursive: true });
  writeFileSync(detachedServer, fakeNextDetachedServerScript(pidFile), 'utf8');
  writeFileSync(fakeWrapper, fakeNextDetachedWrapperScript(detachedServer), 'utf8');
  chmodSync(fakeWrapper, 0o755);

  const handle = await startInvocationControlUi({
    workspaceRoot: rootPath,
    hostname: '127.0.0.1',
    port: 32024,
    uiDirectory,
    nextCommand: fakeWrapper,
    readinessTimeoutMs: 2_000,
    readinessPollMs: 25
  });

  try {
    assert.notEqual(handle.process.exitCode, null);
    assert.equal((await fetch(`${handle.apiUrl}/api/summary`)).ok, true);
    assert.match(await (await fetch(handle.url)).text(), /Ewokbot Invocation Control/u);
    assert.match(await (await fetch(handle.url)).text(), /Ewokbot Invocation Control/u);
  } finally {
    await handle.close();
    const pid = Number(readFileSync(pidFile, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        assert.ok(error instanceof Error);
      }
    }
  }
});

test('local UI launcher fails clearly when no healthy app becomes reachable', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-exit-'));
  const uiDirectory = join(rootPath, 'ui');
  const fakeNext = join(rootPath, 'fake-next.mjs');
  mkdirSync(uiDirectory, { recursive: true });
  writeFileSync(fakeNext, fakeNextServerScript({ exitImmediately: true }), 'utf8');
  chmodSync(fakeNext, 0o755);

  await assert.rejects(
    () => startInvocationControlUi({
      workspaceRoot: rootPath,
      hostname: '127.0.0.1',
      port: 32019,
      uiDirectory,
      nextCommand: fakeNext,
      readinessTimeoutMs: 250,
      readinessPollMs: 25
    }),
    /Timed out after 250ms waiting for the local UI at http:\/\/127\.0\.0\.1:32019 to render with a reachable workspace API/u
  );
});

function createCapturedIO(): { readonly io: CliProgramIO; readonly stdout: string; readonly stderr: string } {
  const captured = { stdout: '', stderr: '' };
  return {
    get stdout() {
      return captured.stdout;
    },
    get stderr() {
      return captured.stderr;
    },
    io: {
      stdout: (text: string) => {
        captured.stdout += text;
      },
      stderr: (text: string) => {
        captured.stderr += text;
      }
    }
  };
}

function fakeNextServerScript(options: { readonly delayMs?: number; readonly healthyDelayMs?: number; readonly exitImmediately?: boolean } = {}): string {
  return `#!/usr/bin/env node
import { createServer } from 'node:http';

if (${options.exitImmediately === true ? 'true' : 'false'}) {
  process.exit(23);
}

const hostnameIndex = process.argv.indexOf('--hostname');
const portIndex = process.argv.indexOf('--port');
const hostname = hostnameIndex >= 0 ? process.argv[hostnameIndex + 1] : '127.0.0.1';
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 3000;
const healthyAfter = Date.now() + ${options.healthyDelayMs ?? 0};
const server = createServer(async (_request, response) => {
  if (Date.now() < healthyAfter) {
    response.statusCode = 200;
    response.end('shell without app');
    return;
  }

  try {
    const apiResponse = await fetch(process.env.EWOKBOT_UI_API_BASE + '/api/summary');
    if (!apiResponse.ok) {
      response.statusCode = 500;
      response.end('api unavailable');
      return;
    }

    response.statusCode = 200;
    response.end('<html><title>Ewokbot Invocation Control</title><body>Ewokbot Invocation Control</body></html>');
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});

setTimeout(() => {
  server.listen(port, hostname);
}, ${options.delayMs ?? 0});

process.once('SIGTERM', () => server.close(() => process.exit(0)));
process.once('SIGINT', () => server.close(() => process.exit(0)));
`;
}

function fakeNextDetachedWrapperScript(serverPath: string): string {
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, [${JSON.stringify(serverPath)}, ...process.argv.slice(2)], {
  detached: true,
  env: process.env,
  stdio: 'ignore'
});
child.unref();
process.exit(0);
`;
}

function fakeNextDetachedServerScript(pidFile: string): string {
  return `#!/usr/bin/env node
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const hostnameIndex = process.argv.indexOf('--hostname');
const portIndex = process.argv.indexOf('--port');
const hostname = hostnameIndex >= 0 ? process.argv[hostnameIndex + 1] : '127.0.0.1';
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 3000;
const server = createServer(async (_request, response) => {
  try {
    const summary = await fetch(process.env.EWOKBOT_UI_API_BASE + '/api/summary');
    const doctor = await fetch(process.env.EWOKBOT_UI_API_BASE + '/api/doctor');
    if (!summary.ok || !doctor.ok) {
      response.statusCode = 500;
      response.end('api unavailable');
      return;
    }

    response.statusCode = 200;
    response.end('<html><title>Ewokbot Invocation Control</title><body>Ewokbot Invocation Control</body></html>');
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
server.listen(port, hostname, () => {
  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid), 'utf8');
});
process.once('SIGTERM', () => server.close(() => process.exit(0)));
process.once('SIGINT', () => server.close(() => process.exit(0)));
`;
}
