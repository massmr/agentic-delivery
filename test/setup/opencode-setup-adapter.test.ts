import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { OpenCodeSetupAdapter, type DevToolCommandResult } from '../../src/index.js';

interface FakeAdapterInput {
  readonly commandExists?: boolean | undefined;
  readonly files?: Readonly<Record<string, string>> | undefined;
  readonly directories?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly includeRunCommand?: boolean | undefined;
  readonly version?: DevToolCommandResult | undefined;
  readonly authList?: DevToolCommandResult | undefined;
  readonly command?: string | undefined;
  readonly envCommand?: string | undefined;
  readonly configCommand?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

const workspaceRoot = '/workspace';
const homeDirectory = '/home/agent';
const globalConfigPath = join(homeDirectory, '.config', 'opencode', 'opencode.json');
const globalConfigJsoncPath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc');
const ohMyOpenAgentConfigPath = join(homeDirectory, '.config', 'opencode', 'oh-my-openagent.json');
const authPath = join(homeDirectory, '.local', 'share', 'opencode', 'auth.json');
const projectConfigPath = join(workspaceRoot, 'opencode.json');
const projectConfigJsoncPath = join(workspaceRoot, 'opencode.jsonc');
const childRepoPath = join(workspaceRoot, 'frontend');
const childRepoConfigPath = join(childRepoPath, 'opencode.json');

test('OpenCode adapter reports not_installed without running OpenCode', () => {
  const calls: string[] = [];
  const adapter = createAdapter({ commandExists: false }, calls);

  const detection = adapter.detect();

  assert.equal(detection.state, 'not_installed');
  assert.equal(detection.command, 'opencode');
  assert.deepEqual(calls, []);
  assert.equal(adapter.doctor()[0]?.status, 'fail');
});

test('OpenCode adapter reports command_failed when version detection fails', () => {
  const calls: string[] = [];
  const adapter = createAdapter({ version: { exitCode: 1, stdout: '', stderr: 'broken' } }, calls);

  const detection = adapter.detect();

  assert.equal(detection.state, 'command_failed');
  assert.deepEqual(calls, ['opencode --version']);
  assert.equal(adapter.doctor()[0]?.status, 'fail');
});

test('OpenCode adapter reports installed_unsupported for unsupported versions', () => {
  const adapter = createAdapter({ version: { exitCode: 0, stdout: 'opencode 0.9.0', stderr: '' } });

  const detection = adapter.detect();

  assert.equal(detection.state, 'installed_unsupported');
  assert.equal(detection.version, '0.9.0');
});

test('OpenCode adapter reports installed_not_authenticated without auth file or auth list', () => {
  const adapter = createAdapter({ authList: { exitCode: 1, stdout: '', stderr: 'not logged in' } });

  const detection = adapter.detect();

  assert.equal(detection.state, 'installed_not_authenticated');
  assert.equal(detection.authListChecked, true);
  assert.equal(detection.authListAuthenticated, false);
  assert.equal(adapter.doctor()[0]?.status, 'warn');
});

test('OpenCode adapter reports installed_authenticated_no_model without exposing auth contents', () => {
  const secret = 'secret-opencode-token';
  const adapter = createAdapter({ files: { [authPath]: `{"token":"${secret}"}\n` } });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_authenticated_no_model');
  assert.equal(detection.authPresent, true);
  assert.equal(detection.modelConfigured, false);
  assert.doesNotMatch(rendered, new RegExp(secret, 'u'));
});

test('OpenCode adapter reports installed_ready without runCommand when auth file and model config are present', () => {
  const authSecret = 'secret-opencode-token';
  const modelName = 'private-model-name';
  const adapter = createAdapter({
    includeRunCommand: false,
    files: {
      [authPath]: `{"token":"${authSecret}"}\n`,
      [globalConfigPath]: JSON.stringify({ provider: 'anthropic', model: modelName })
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.authPresent, true);
  assert.equal(detection.authListChecked, false);
  assert.equal(detection.authListAuthenticated, false);
  assert.equal(detection.modelConfigured, true);
  assert.match(detection.details.join('\n'), /model configuration was detected/u);
  assert.doesNotMatch(rendered, new RegExp(authSecret, 'u'));
  assert.doesNotMatch(rendered, new RegExp(modelName, 'u'));
});

test('OpenCode adapter detects model config from JSONC global config', () => {
  const adapter = createAdapter({
    includeRunCommand: false,
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n',
      [globalConfigJsoncPath]: '{\n  // private model name is not rendered\n  "model": "anthropic/claude-sonnet-4"\n}\n'
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(adapter.getConfigSummary().configFilesPresent, [globalConfigJsoncPath]);
  assert.doesNotMatch(rendered, /claude-sonnet/u);
});

test('OpenCode adapter treats small_model as model readiness for working OpenCode configs', () => {
  const adapter = createAdapter({
    includeRunCommand: false,
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n',
      [globalConfigPath]: [
        '{',
        '  "small_model": "private-small-model",',
        '  "plugin": [',
        '    "oh-my-openagent",',
        '  ]',
        '}'
      ].join('\n')
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(adapter.getConfigSummary().configFilesPresent, [globalConfigPath]);
  assert.doesNotMatch(rendered, /private-small-model/u);
});

test('OpenCode adapter detects model readiness from oh-my-openagent companion config', () => {
  const adapter = createAdapter({
    includeRunCommand: false,
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n',
      [ohMyOpenAgentConfigPath]: JSON.stringify({
        default: {
          model: 'private-oh-my-openagent-model'
        }
      })
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(adapter.getConfigSummary().configFilesPresent, [ohMyOpenAgentConfigPath]);
  assert.doesNotMatch(rendered, /private-oh-my-openagent-model/u);
});

test('OpenCode adapter detects custom OPENCODE_CONFIG model config', () => {
  const customConfigPath = '/custom/opencode-config.json';
  const adapter = createAdapter({
    includeRunCommand: false,
    env: { OPENCODE_CONFIG: customConfigPath },
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n',
      [customConfigPath]: JSON.stringify({ provider: 'anthropic', model: 'private-custom-model' })
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(adapter.getConfigSummary().configFilesPresent, [customConfigPath]);
  assert.doesNotMatch(rendered, /private-custom-model/u);
});

test('OpenCode adapter detects inline OPENCODE_CONFIG_CONTENT model config without printing values', () => {
  const adapter = createAdapter({
    includeRunCommand: false,
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'private-inline-model' }) },
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n'
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(adapter.getConfigSummary().configFilesPresent, ['OPENCODE_CONFIG_CONTENT']);
  assert.doesNotMatch(rendered, /private-inline-model/u);
});

test('OpenCode adapter detects project config inside direct sibling git repositories', () => {
  const adapter = createAdapter({
    includeRunCommand: false,
    directories: { [workspaceRoot]: ['frontend', 'notes'] },
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n',
      [join(childRepoPath, '.git')]: '',
      [childRepoConfigPath]: JSON.stringify({ model: 'private-child-model' })
    }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.projectConfigPresent, true);
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(adapter.getConfigSummary().configFilesPresent, [childRepoConfigPath]);
  assert.doesNotMatch(rendered, /private-child-model/u);
});

test('OpenCode adapter reports installed_authenticated_no_model without runCommand when auth file is present and model config is absent', () => {
  const authSecret = 'secret-opencode-token';
  const adapter = createAdapter({
    includeRunCommand: false,
    files: { [authPath]: `{"token":"${authSecret}"}\n` }
  });

  const detection = adapter.detect();
  const rendered = JSON.stringify([detection, adapter.doctor(), adapter.getConfigSummary()]);

  assert.equal(detection.state, 'installed_authenticated_no_model');
  assert.equal(detection.authPresent, true);
  assert.equal(detection.authListChecked, false);
  assert.equal(detection.authListAuthenticated, false);
  assert.equal(detection.modelConfigured, false);
  assert.match(detection.details.join('\n'), /model configuration was not detected/u);
  assert.doesNotMatch(rendered, new RegExp(authSecret, 'u'));
});

test('OpenCode adapter reports installed_ready with auth and model config without exposing values', () => {
  const secret = 'secret-provider-key';
  const adapter = createAdapter({
    files: {
      [authPath]: '{"token":"secret-opencode-token"}\n',
      [globalConfigPath]: JSON.stringify({ provider: 'anthropic', apiKey: secret }),
      [projectConfigPath]: JSON.stringify({ model: 'claude-sonnet' })
    }
  });

  const detection = adapter.detect();
  const summary = adapter.getConfigSummary();
  const rendered = JSON.stringify([detection, adapter.doctor(), summary]);

  assert.equal(detection.state, 'installed_ready');
  assert.equal(detection.globalConfigPresent, true);
  assert.equal(detection.projectConfigPresent, true);
  assert.equal(detection.modelConfigured, true);
  assert.deepEqual(summary.configFilesPresent, [globalConfigPath, projectConfigPath]);
  assert.doesNotMatch(rendered, /secret-opencode-token/u);
  assert.doesNotMatch(rendered, new RegExp(secret, 'u'));
  assert.doesNotMatch(rendered, /claude-sonnet/u);
});

test('OpenCode adapter uses custom command path and auth list success', () => {
  const calls: string[] = [];
  const adapter = createAdapter({
    command: '/opt/bin/opencode-custom',
    authList: { exitCode: 0, stdout: 'authenticated account', stderr: '' },
    files: { [projectConfigPath]: JSON.stringify({ model: 'local-model' }) }
  }, calls);

  const detection = adapter.detect();

  assert.equal(detection.command, '/opt/bin/opencode-custom');
  assert.equal(detection.authListChecked, true);
  assert.equal(detection.authListAuthenticated, true);
  assert.equal(detection.state, 'installed_ready');
  assert.deepEqual(calls, ['/opt/bin/opencode-custom --version', '/opt/bin/opencode-custom auth list']);
});

test('OpenCode adapter resolves command from OPENCODE_COMMAND before workspace config command', () => {
  const adapter = createAdapter({ envCommand: 'opencode-env', configCommand: 'opencode-config' });

  assert.equal(adapter.detect().command, 'opencode-env');
});

test('OpenCode adapter launchSetup returns confirmed operator actions without invoking them', () => {
  const adapter = createAdapter({ commandExists: false });

  const unconfirmed = adapter.launchSetup();
  const confirmed = adapter.launchSetup({ confirmed: true });

  assert.equal(unconfirmed.invoked, false);
  assert.equal(unconfirmed.actions[0]?.requiresExplicitConfirmation, true);
  assert.equal(confirmed.invoked, false);
  assert.match(confirmed.message, /does not run installers or auth flows/u);
});

function createAdapter(input: FakeAdapterInput, calls: string[] = []): OpenCodeSetupAdapter {
  const files = input.files ?? {};
  const directories = input.directories ?? {};
  return new OpenCodeSetupAdapter({
    workspaceRoot,
    homeDirectory,
    env: input.env ?? (input.envCommand === undefined ? {} : { OPENCODE_COMMAND: input.envCommand }),
    command: input.command,
    configCommand: input.configCommand,
    fileExists: (path) => Object.hasOwn(files, path),
    readFile: (path) => files[path],
    readDirectory: (path) => directories[path] ?? [],
    commandExists: () => input.commandExists ?? true,
    runCommand: input.includeRunCommand === false ? undefined : (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args.length === 1 && args[0] === '--version') {
        return input.version ?? { exitCode: 0, stdout: 'opencode 1.2.3', stderr: '' };
      }
      if (args.length === 2 && args[0] === 'auth' && args[1] === 'list') {
        return input.authList ?? { exitCode: 1, stdout: '', stderr: 'not authenticated' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    }
  });
}
