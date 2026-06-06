import * as assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEwokbotAuthStore } from '../src/auth/index.js';

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

test('Ewokbot auth store reads missing auth metadata as empty without workspace writes', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'ewokbot-auth-empty-'));
  const store = createEwokbotAuthStore({ userLayoutOptions: createTestUserLayoutOptions(workspaceDir) });

  const state = await store.read();

  assert.equal(state.version, 1);
  assert.deepEqual(Object.keys(state.providers), []);
  assert.equal(existsSync(store.authFilePath), false);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot')), false);
});

test('Ewokbot auth store records provider metadata only in the user auth file', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'ewokbot-auth-login-'));
  const store = createEwokbotAuthStore({
    userLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    now: () => new Date('2026-06-06T12:00:00.000Z')
  });

  await store.login('jira');
  const state = await store.read();

  assert.deepEqual(state.providers.jira, {
    provider: 'jira',
    status: 'configured',
    credentialKind: 'metadata-only',
    updatedAt: '2026-06-06T12:00:00.000Z'
  });
  assert.equal(existsSync(join(workspaceDir, '.ewokbot')), false);
  assert.equal(statSync(store.authFilePath).mode & 0o077, 0);
});

test('Ewokbot auth store logout removes only the selected provider entry', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'ewokbot-auth-logout-'));
  const store = createEwokbotAuthStore({ userLayoutOptions: createTestUserLayoutOptions(workspaceDir) });

  await store.login('jira');
  await store.login('github');
  const removed = await store.logout('jira');
  const state = await store.read();

  assert.equal(removed, true);
  assert.equal(state.providers.jira, undefined);
  assert.equal(state.providers.github?.provider, 'github');
});

test('Ewokbot auth store reports malformed auth metadata without printing contents', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'ewokbot-auth-invalid-'));
  const store = createEwokbotAuthStore({ userLayoutOptions: createTestUserLayoutOptions(workspaceDir) });

  await store.writeRawForTest('{"github":"access_token=fake-token"');

  await assert.rejects(
    store.read(),
    (error) => error instanceof Error
      && /Unable to parse Ewokbot auth metadata/u.test(error.message)
      && !/fake-token/u.test(error.message)
  );
});
