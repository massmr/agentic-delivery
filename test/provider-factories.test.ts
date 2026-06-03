import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  MockGitHubConnector,
  MockJiraConnector,
  MockOpenCodeRunner,
  MockRailwayConnector,
  OpenCodeSubprocessRunner,
  ProviderCredentialError,
  RealProviderAdapterUnavailableError,
  createDevRunner,
  createGitHubConnector,
  createJiraConnector,
  createRailwayConnector,
  createWorkspaceAdapters,
  parseWorkspaceConfig
} from '../src/index.js';

const exampleConfigPath = resolve('config/workspace.example.yml');

test('provider factories keep mock mode as the default connector surface', async () => {
  const config = parseWorkspaceConfig(await readFile(exampleConfigPath, 'utf8'));
  const adapters = createWorkspaceAdapters({ config });

  assert.ok(adapters.jira instanceof MockJiraConnector);
  assert.ok(adapters.github instanceof MockGitHubConnector);
  assert.ok(adapters.railway instanceof MockRailwayConnector);
  assert.ok(adapters.devRunner instanceof MockOpenCodeRunner);
});

test('real Jira factory fails fast on missing credentials before live adapter creation', async () => {
  const config = parseWorkspaceConfig((await readFile(exampleConfigPath, 'utf8')).replace('jira:\n  mode: mock', 'jira:\n  mode: real'));

  assert.throws(() => createJiraConnector({ config, environment: {} }), (error: unknown) => {
    assert.ok(error instanceof ProviderCredentialError);
    assert.equal(error.provider, 'Jira');
    assert.equal(error.variableName, 'JIRA_EMAIL');
    return true;
  });
  assert.throws(
    () => createJiraConnector({ config, environment: { JIRA_EMAIL: 'founder@example.test', JIRA_API_TOKEN: 'placeholder' } }),
    RealProviderAdapterUnavailableError
  );
});

test('real GitHub and Railway factories fail fast on missing credentials before live adapter creation', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const githubConfig = parseWorkspaceConfig(source.replace('github:\n  mode: mock', 'github:\n  mode: real'));
  const railwayConfig = parseWorkspaceConfig(source.replace('railway:\n  mode: mock', 'railway:\n  mode: real'));

  assert.throws(() => createGitHubConnector({ config: githubConfig, environment: {} }), (error: unknown) => {
    assert.ok(error instanceof ProviderCredentialError);
    assert.equal(error.provider, 'GitHub');
    assert.equal(error.variableName, 'GITHUB_TOKEN');
    return true;
  });
  assert.throws(() => createGitHubConnector({ config: githubConfig, environment: { GITHUB_TOKEN: 'placeholder' } }), RealProviderAdapterUnavailableError);
  assert.throws(() => createRailwayConnector({ config: railwayConfig, environment: {} }), (error: unknown) => {
    assert.ok(error instanceof ProviderCredentialError);
    assert.equal(error.provider, 'Railway');
    assert.equal(error.variableName, 'RAILWAY_TOKEN');
    return true;
  });
  assert.throws(() => createRailwayConnector({ config: railwayConfig, environment: { RAILWAY_TOKEN: 'placeholder' } }), RealProviderAdapterUnavailableError);
});

test('real OpenCode factory returns subprocess runner without executing a command', async () => {
  const config = parseWorkspaceConfig(
    (await readFile(exampleConfigPath, 'utf8')).replace('dev_runner:\n  provider: opencode', 'dev_runner:\n  mode: real\n  provider: opencode')
  );

  assert.ok(createDevRunner({ config }) instanceof OpenCodeSubprocessRunner);
});
