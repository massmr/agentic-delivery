import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEwokbotUserLayout, resolveEwokbotUserLayout } from '../src/index.js';

test('resolveEwokbotUserLayout uses the injected home directory by default', () => {
  const homeDirectory = join(tmpdir(), 'ewokbot-user-layout-home');
  const layout = resolveEwokbotUserLayout({ homeDirectory });

  assert.deepEqual(layout, {
    config: {
      directory: join(homeDirectory, '.config', 'ewokbot'),
      file: join(homeDirectory, '.config', 'ewokbot', 'config.json')
    },
    data: {
      directory: join(homeDirectory, '.local', 'share', 'ewokbot')
    },
    auth: {
      directory: join(homeDirectory, '.local', 'share', 'ewokbot'),
      file: join(homeDirectory, '.local', 'share', 'ewokbot', 'auth.json')
    },
    state: {
      directory: join(homeDirectory, '.local', 'share', 'ewokbot', 'state')
    },
    cache: {
      directory: join(homeDirectory, '.cache', 'ewokbot')
    }
  });
});

test('resolveEwokbotUserLayout honors XDG overrides without touching the filesystem', () => {
  const homeDirectory = join(tmpdir(), 'ewokbot-user-layout-xdg-home');
  const env = {
    XDG_CONFIG_HOME: join(homeDirectory, 'xdg-config'),
    XDG_DATA_HOME: join(homeDirectory, 'xdg-data'),
    XDG_CACHE_HOME: join(homeDirectory, 'xdg-cache')
  };

  const layout = resolveEwokbotUserLayout({ homeDirectory, env });

  assert.equal(existsSync(layout.config.directory), false);
  assert.equal(existsSync(layout.auth.file), false);
  assert.equal(existsSync(layout.state.directory), false);
  assert.equal(existsSync(layout.cache.directory), false);
  assert.deepEqual(layout, {
    config: {
      directory: join(env.XDG_CONFIG_HOME, 'ewokbot'),
      file: join(env.XDG_CONFIG_HOME, 'ewokbot', 'config.json')
    },
    data: {
      directory: join(env.XDG_DATA_HOME, 'ewokbot')
    },
    auth: {
      directory: join(env.XDG_DATA_HOME, 'ewokbot'),
      file: join(env.XDG_DATA_HOME, 'ewokbot', 'auth.json')
    },
    state: {
      directory: join(env.XDG_DATA_HOME, 'ewokbot', 'state')
    },
    cache: {
      directory: join(env.XDG_CACHE_HOME, 'ewokbot')
    }
  });
});

test('createEwokbotUserLayout creates directories and a sentinel auth file with owner-only permissions', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ewokbot-user-layout-create-'));

  try {
    const layout = await createEwokbotUserLayout({ homeDirectory });

    assert.equal(existsSync(layout.config.directory), true);
    assert.equal(existsSync(layout.data.directory), true);
    assert.equal(existsSync(layout.state.directory), true);
    assert.equal(existsSync(layout.cache.directory), true);
    assert.equal(existsSync(layout.auth.file), true);
    assert.equal(readFileSync(layout.auth.file, 'utf8'), '{}\n');

    if (process.platform !== 'win32') {
      const mode = statSync(layout.auth.file).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('createEwokbotUserLayout preserves an existing auth file', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ewokbot-user-layout-preserve-'));

  try {
    const existingLayout = resolveEwokbotUserLayout({ homeDirectory });
    mkdirSync(existingLayout.auth.directory, { recursive: true });
    writeFileSync(existingLayout.auth.file, '{"token":"keep"}\n', 'utf8');

    const layout = await createEwokbotUserLayout({ homeDirectory });

    assert.equal(readFileSync(layout.auth.file, 'utf8'), '{"token":"keep"}\n');
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});
