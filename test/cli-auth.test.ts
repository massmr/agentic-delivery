import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createCliProgram } from '../src/index.js';

function createTestUserLayoutOptions(workspaceDir: string) {
  return {
    homeDirectory: join(workspaceDir, 'home'),
    env: {
      XDG_CONFIG_HOME: join(workspaceDir, 'xdg-config'),
      XDG_DATA_HOME: join(workspaceDir, 'xdg-data'),
      XDG_CACHE_HOME: join(workspaceDir, 'xdg-cache')
    }
  };
}

function createCapturedIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout(text: string) {
        stdout += text;
      },
      stderr(text: string) {
        stderr += text;
      }
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}

test('ewokbot auth status and list report empty Ewokbot auth without workspace writes', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-cli-auth-empty-'));
  const userLayoutOptions = createTestUserLayoutOptions(workspaceDir);
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: workspaceDir, io: captured.io, authUserLayoutOptions: userLayoutOptions });

  const statusExitCode = await program.run(['node', 'ewokbot', 'auth', 'status']);
  const listExitCode = await program.run(['node', 'ewokbot', 'auth', 'list']);

  assert.equal(statusExitCode, 0);
  assert.equal(listExitCode, 0);
  assert.match(captured.stdout, /Ewokbot auth file:/u);
  assert.match(captured.stdout, /jira: not configured/u);
  assert.match(captured.stdout, /No Ewokbot providers are configured/u);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(join(workspaceDir, '.ewokbot')), false);
});

test('ewokbot auth login and logout update only the Ewokbot user auth store', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-cli-auth-login-'));
  const userLayoutOptions = createTestUserLayoutOptions(workspaceDir);
  const authFile = join(userLayoutOptions.env.XDG_DATA_HOME, 'ewokbot', 'auth.json');
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: workspaceDir, io: captured.io, authUserLayoutOptions: userLayoutOptions });

  const loginExitCode = await program.run(['node', 'ewokbot', 'auth', 'login', 'github']);
  const listExitCode = await program.run(['node', 'ewokbot', 'auth', 'list']);
  const logoutExitCode = await program.run(['node', 'ewokbot', 'auth', 'logout', 'github']);

  assert.equal(loginExitCode, 0);
  assert.equal(listExitCode, 0);
  assert.equal(logoutExitCode, 0);
  assert.match(captured.stdout, /Recorded Ewokbot-owned github auth metadata/u);
  assert.match(captured.stdout, /github: configured \(metadata-only/u);
  assert.match(captured.stdout, /Removed Ewokbot-owned github auth metadata/u);
  assert.equal(existsSync(authFile), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot')), false);
  assert.doesNotMatch(readFileSync(authFile, 'utf8'), /opencode|OPENAI|ANTHROPIC|API_KEY/u);
  assert.equal(captured.stderr, '');
});

test('ewokbot auth login opencode delegates to OpenCode without writing Ewokbot auth state', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-cli-auth-opencode-'));
  const userLayoutOptions = createTestUserLayoutOptions(workspaceDir);
  const authFile = join(userLayoutOptions.env.XDG_DATA_HOME, 'ewokbot', 'auth.json');
  const captured = createCapturedIO();
  const program = createCliProgram({ cwd: workspaceDir, io: captured.io, authUserLayoutOptions: userLayoutOptions });

  const exitCode = await program.run(['node', 'ewokbot', 'auth', 'login', 'opencode']);

  assert.equal(exitCode, 1);
  assert.match(captured.stdout, /OpenCode auth is owned by OpenCode/u);
  assert.match(captured.stdout, /opencode auth login/u);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(authFile), false);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot')), false);
});

test('ewokbot auth output redacts secret-like metadata fields from existing auth files', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-cli-auth-redact-'));
  const userLayoutOptions = createTestUserLayoutOptions(workspaceDir);
  const authDirectory = join(userLayoutOptions.env.XDG_DATA_HOME, 'ewokbot');
  const authFile = join(authDirectory, 'auth.json');
  const captured = createCapturedIO();

  mkdirSync(authDirectory, { recursive: true });
  writeFileSync(authFile, JSON.stringify({
    version: 1,
    providers: {
      railway: {
        provider: 'railway',
        status: 'configured',
        credentialKind: 'access_token=fake-token-value',
        updatedAt: '2026-06-06T12:00:00.000Z'
      }
    }
  }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, authUserLayoutOptions: userLayoutOptions }).run(['node', 'ewokbot', 'auth', 'list']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /railway: configured \(access_token=\[redacted\]/u);
  assert.doesNotMatch(captured.stdout, /fake-token-value/u);
  assert.equal(captured.stderr, '');
});

test('ewokbot auth rejects unknown providers without creating auth state', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-cli-auth-unknown-'));
  const userLayoutOptions = createTestUserLayoutOptions(workspaceDir);
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, authUserLayoutOptions: userLayoutOptions }).run(['node', 'ewokbot', 'auth', 'login', 'slack']);

  assert.equal(exitCode, 1);
  assert.match(captured.stderr, /Unsupported Ewokbot auth provider: slack/u);
  assert.doesNotMatch(captured.stderr, /token|secret|password/u);
  assert.equal(existsSync(join(userLayoutOptions.env.XDG_DATA_HOME, 'ewokbot', 'auth.json')), false);
});
