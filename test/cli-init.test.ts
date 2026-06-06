import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { createCliProgram, parseWorkspaceConfig } from '../src/index.js';
import { promptForSelectionsWithPromptAdapter, type InitPromptAdapter, type InitPromptChoice } from '../src/cli/commands/init.js';

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

type FakePromptCall =
  | { readonly kind: 'select'; readonly message: string; readonly choices: readonly string[] }
  | { readonly kind: 'confirm'; readonly message: string }
  | { readonly kind: 'input'; readonly message: string }
  | { readonly kind: 'checkbox'; readonly message: string; readonly choices: readonly string[] };

function createFakePromptAdapter(answers: readonly (string | boolean | readonly string[])[]): InitPromptAdapter & { readonly calls: readonly FakePromptCall[] } {
  const queue = [...answers];
  const calls: FakePromptCall[] = [];

  return {
    calls,
    async select(input) {
      calls.push({ kind: 'select', message: input.message, choices: input.choices.map((choice) => choice.label) });
      const answer = queue.shift();
      assert.notEqual(answer, undefined, `missing fake select answer for prompt: ${input.message}`);
      return readFakeScalarAnswer(input.choices, answer, input.defaultValue);
    },
    async confirm(input) {
      calls.push({ kind: 'confirm', message: input.message });
      const answer = queue.shift();
      assert.notEqual(answer, undefined, `missing fake confirm answer for prompt: ${input.message}`);
      return typeof answer === 'boolean' ? answer : input.defaultValue;
    },
    async input(input) {
      calls.push({ kind: 'input', message: input.message });
      const answer = queue.shift();
      assert.notEqual(answer, undefined, `missing fake input answer for prompt: ${input.message}`);
      return typeof answer === 'string' ? answer : input.defaultValue ?? '';
    },
    async checkbox(input) {
      calls.push({ kind: 'checkbox', message: input.message, choices: input.choices.map((choice) => choice.label) });
      const answer = queue.shift();
      assert.notEqual(answer, undefined, `missing fake checkbox answer for prompt: ${input.message}`);
      return Array.isArray(answer) ? readFakeCheckboxAnswer(input.choices, answer) : input.defaultValues;
    }
  };
}

function readFakeCheckboxAnswer<T extends string>(choices: readonly InitPromptChoice<T>[], answer: readonly string[]): readonly T[] {
  return answer.map((value) => {
    const matched = choices.find((choice) => choice.value === value || choice.label === value);
    if (matched === undefined) {
      throw new Error(`fake checkbox answer ${value} is not one of ${choices.map((choice) => choice.label).join(', ')}`);
    }

    return matched.value;
  });
}

function readFakeScalarAnswer<T extends string | boolean>(choices: readonly InitPromptChoice<T>[], answer: string | boolean | readonly string[] | undefined, defaultValue: T): T {
  if (typeof answer === 'boolean') {
    return answer as T;
  }

  if (typeof answer !== 'string' || answer.trim().length === 0) {
    return defaultValue;
  }

  const matched = choices.find((choice) => String(choice.value) === answer || choice.label === answer);
  assert.notEqual(matched, undefined, `fake answer ${answer} is not one of ${choices.map((choice) => choice.label).join(', ')}`);
  return matched?.value ?? defaultValue;
}

function prepareReadyOpenCodeHome(workspaceDir: string): string {
  const homeDirectory = join(workspaceDir, 'opencode-home');
  mkdirSync(join(homeDirectory, '.local', 'share', 'opencode'), { recursive: true });
  mkdirSync(join(homeDirectory, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(homeDirectory, '.local', 'share', 'opencode', 'auth.json'), '{"authenticated":true}\n');
  writeFileSync(join(homeDirectory, '.config', 'opencode', 'opencode.json'), '{"model":"anthropic/claude-sonnet-4"}\n');
  return homeDirectory;
}

test('agentic init creates non-interactive onboarding files in the current directory', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-test-'));
  const cliPath = resolve('dist/src/cli/index.js');
  const result = spawnSync(process.execPath, [cliPath, 'init', '--non-interactive'], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(workspaceDir, 'xdg-config'),
      XDG_DATA_HOME: join(workspaceDir, 'xdg-data'),
      XDG_CACHE_HOME: join(workspaceDir, 'xdg-cache')
    },
    encoding: 'utf8'
  });

  const targetPath = join(workspaceDir, '.ewokbot', 'workspace.yml');
  const envPath = join(workspaceDir, '.ewokbot', '.env');
  const envExamplePath = join(workspaceDir, '.ewokbot', '.env.example');

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Created .+.ewokbot\/workspace\.yml/u);
  assert.match(result.stdout, /Created .+\.ewokbot\/\.env\n/u);
  assert.match(result.stdout, /Created .+\.env\.example/u);
  const workspaceYaml = readFileSync(targetPath, 'utf8');
  const config = parseWorkspaceConfig(workspaceYaml);
  assert.match(workspaceYaml, /deployment_monitors:\n    - railway/u);
  assert.match(workspaceYaml, /repos:\n  discovery: sibling-git-directories\n  exclude: \[\]/u);
  assert.doesNotMatch(workspaceYaml, /name: frontend/u);
  assert.doesNotMatch(workspaceYaml, /local_path: \.\/frontend/u);
  assert.doesNotMatch(workspaceYaml, /https:\/\/github\.com\/agentic\/frontend/u);
  assert.doesNotMatch(workspaceYaml, /\.\/worktrees\/frontend/u);
  assert.deepEqual(config.repos, []);
  assert.equal(config.repositoryDiscovery?.discovery, 'sibling-git-directories');
  assert.match(readFileSync(envPath, 'utf8'), /OPENCODE_COMMAND=opencode\n/u);
  assert.match(readFileSync(envExamplePath, 'utf8'), /RAILWAY_TOKEN=\n/u);
  assert.equal(existsSync(join(workspaceDir, 'xdg-config', 'ewokbot')), true);
  assert.equal(existsSync(join(workspaceDir, 'xdg-data', 'ewokbot', 'auth.json')), true);
  assert.equal(existsSync(join(workspaceDir, 'xdg-data', 'ewokbot', 'state')), true);
  assert.equal(existsSync(join(workspaceDir, 'xdg-cache', 'ewokbot')), true);
});

test('agentic init creates .ewokbot directory and owned subdirectories when needed', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-dir-test-'));
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run(['node', 'agentic', 'init', '--non-interactive']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', '.env')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', '.env.example')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'runs')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'logs')), true);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'cache')), true);
  assert.equal(existsSync(join(workspaceDir, 'config', 'workspace.yml')), false);
  assert.equal(existsSync(join(workspaceDir, '.env.example')), false);
  assert.equal(existsSync(join(workspaceDir, '.env')), false);
  assert.equal(existsSync(join(workspaceDir, 'runs')), false);
  assert.equal(existsSync(join(workspaceDir, 'xdg-config', 'ewokbot')), true);
  assert.equal(existsSync(join(workspaceDir, 'xdg-data', 'ewokbot', 'auth.json')), true);
  assert.equal(existsSync(join(workspaceDir, 'xdg-data', 'ewokbot', 'state')), true);
  assert.equal(existsSync(join(workspaceDir, 'xdg-cache', 'ewokbot')), true);
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(workspaceDir, 'xdg-data', 'ewokbot', 'auth.json')).mode & 0o777, 0o600);
  }
});

test('agentic init refuses to overwrite an existing workspace config', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-overwrite-test-'));
  const configDir = join(workspaceDir, '.ewokbot');
  const targetPath = join(configDir, 'workspace.yml');
  const captured = createCapturedIO();
  let prompted = false;

  mkdirSync(configDir);
  writeFileSync(targetPath, 'workspace: existing\n');

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initPrompter: async () => {
      prompted = true;
      return { deploymentMonitor: 'both', includeOhMyOpenAgent: true };
    }
  }).run(['node', 'agentic', 'init']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Refusing to overwrite existing .+.ewokbot\/workspace\.yml/u);
  assert.equal(readFileSync(targetPath, 'utf8'), 'workspace: existing\n');
  assert.equal(prompted, false);
});

for (const existingFileName of ['.env', '.env.example']) {
  test(`agentic init refuses to overwrite an existing ${existingFileName}`, async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'agentic-init-overwrite-env-test-'));
    const configDir = join(workspaceDir, '.ewokbot');
    const existingPath = join(configDir, existingFileName);
    const captured = createCapturedIO();

    mkdirSync(configDir);
    writeFileSync(existingPath, 'KEEP_EXISTING=1\n');

    const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run(['node', 'agentic', 'init', '--non-interactive']);

    assert.equal(exitCode, 1);
    assert.equal(captured.stdout, '');
    assert.match(captured.stderr, new RegExp(`Refusing to overwrite existing Ewokbot onboarding file\\(s\\): .+\\.ewokbot/${existingFileName.replace('.', '\\.')}\\n$`, 'u'));
    assert.equal(readFileSync(existingPath, 'utf8'), 'KEEP_EXISTING=1\n');
    assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), false);
  });
}

test('ewokbot init generates Railway-only onboarding config and placeholders', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-railway-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8'), /deployment_monitors:\n    - railway/u);
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(envExample, /^RAILWAY_TOKEN=$/mu);
  assert.doesNotMatch(envExample, /^VERCEL_TOKEN=/mu);
  assert.doesNotMatch(envExample, /secret|example-token|changeme/iu);
});

test('ewokbot init generated config uses dev runner env_var_names allowlist', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-env-vars-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'railway'
  ]);

  assert.equal(exitCode, 0);
  const configYaml = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  const config = parseWorkspaceConfig(configYaml);
  assert.match(configYaml, /env_var_names:\n    - PATH\n    - HOME\n    - TMPDIR\n    - TEMP\n    - TMP/u);
  assert.doesNotMatch(configYaml, /\n  env:\n/u);
  assert.deepEqual(config.devRunner.envVarNames, ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']);
});

test('ewokbot init generates Vercel-only onboarding config and placeholders', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-vercel-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'vercel'
  ]);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8'), /deployment_monitors:\n    - vercel/u);
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(envExample, /^VERCEL_TOKEN=$/mu);
  assert.doesNotMatch(envExample, /^RAILWAY_TOKEN=/mu);
  assert.doesNotMatch(envExample, /secret|example-token|changeme/iu);
});

test('ewokbot init generates both Railway and Vercel onboarding config', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-both-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initPrompter: async () => ({ deploymentMonitor: 'both', includeOhMyOpenAgent: true })
  }).run(['node', 'ewokbot', 'init']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  const config = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  assert.match(config, /deployment_monitors:\n    - railway\n    - vercel/u);
  assert.match(config, /optional_tools:\n    - oh-my-openagent/u);
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(envExample, /^RAILWAY_TOKEN=$/mu);
  assert.match(envExample, /^VERCEL_TOKEN=$/mu);
});

test('ewokbot init injected wizard answers generate MCP workspace and secret-safe env files', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-mcp-wizard-'));
  const captured = createCapturedIO();
  const secretValue = 'super-secret-jira-token';

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initCommandExists: (command) => command === 'opencode',
    initPrompter: async () => ({
      deploymentMonitor: 'both',
      includeOhMyOpenAgent: true,
      devRunnerMode: 'opencode',
      opencodeCommand: 'opencode',
      opencodeEnvVarNames: ['OPENCODE_API_KEY'],
      modelProviderEnvVarNames: ['ANTHROPIC_API_KEY'],
      ticketProvider: 'jira-mcp',
      jiraBaseUrl: 'https://jira.example.test',
      jiraProjectKeys: ['AJ', 'OPS'],
      jiraMcpServer: { id: 'atlassian', command: 'jira-mcp', args: ['--stdio'], envVarNames: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] },
      codeHostProvider: 'github-mcp',
      githubOrganization: 'ewokbot',
      githubMcpServer: { id: 'github', command: 'github-mcp', args: [], envVarNames: ['GITHUB_TOKEN'] },
      railwayProvider: 'railway-mcp',
      railwayMcpServer: { id: 'railway', command: 'railway-mcp', args: [], envVarNames: ['RAILWAY_TOKEN'] },
      envValues: { JIRA_API_TOKEN: secretValue }
    })
  }).run(['node', 'ewokbot', 'init']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.doesNotMatch(captured.stdout, new RegExp(secretValue, 'u'));

  const configYaml = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  const config = parseWorkspaceConfig(configYaml);
  assert.equal(config.devRunner.mode, 'real');
  assert.equal(config.jira.mode, 'mcp');
  assert.equal(config.github.mode, 'mcp');
  assert.equal(config.railway.mode, 'mcp');
  assert.deepEqual(config.devRunner.envVarNames, ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']);
  assert.deepEqual(config.mcpServers.map((server) => server.id), ['atlassian', 'github', 'railway']);
  assert.match(configYaml, /project_keys:\n    - AJ\n    - OPS/u);
  assert.match(configYaml, /optional_tools:\n    - oh-my-openagent/u);

  const env = readFileSync(join(workspaceDir, '.ewokbot', '.env'), 'utf8');
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.match(env, new RegExp(`^JIRA_API_TOKEN=${secretValue}$`, 'mu'));
  assert.match(env, /^OPENCODE_COMMAND=opencode$/mu);
  assert.doesNotMatch(env, /^OPENCODE_API_KEY=/mu);
  assert.doesNotMatch(env, /^ANTHROPIC_API_KEY=/mu);
  assert.match(envExample, /^JIRA_API_TOKEN=$/mu);
  assert.doesNotMatch(envExample, /^OPENCODE_API_KEY=/mu);
  assert.doesNotMatch(envExample, /^ANTHROPIC_API_KEY=/mu);
  assert.doesNotMatch(envExample, new RegExp(secretValue, 'u'));
  assert.doesNotMatch(envExample, /secret|example-token|changeme/iu);
});

test('ewokbot init interactive-style wizard asks credentials and MCP settings without leaking secrets', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-interactive-secrets-'));
  const captured = createCapturedIO();
  const opencodeHomeDirectory = prepareReadyOpenCodeHome(workspaceDir);
  const secrets = {
    jiraEmail: 'agent@example.test',
    jiraToken: 'jira-secret-value',
    github: 'github-secret-value',
    railway: 'railway-secret-value',
    vercel: 'vercel-secret-value'
  };
  const prompts = createFakePromptAdapter([
    'opencode',
    true,
    'jira-mcp',
    'https://jira.company.test',
    'AJ,OPS',
    secrets.jiraEmail,
    secrets.jiraToken,
    'company-jira',
    'company-jira-mcp',
    '--stdio,--tenant company',
    'JIRA_BASE_URL,JIRA_EMAIL,JIRA_API_TOKEN',
    'github-mcp',
    'ewokbot-org',
    secrets.github,
    'company-github',
    'github-mcp',
    '--stdio',
    'GITHUB_TOKEN',
    ['railway', 'vercel'],
    'railway-mcp',
    secrets.railway,
    'company-railway',
    'railway-mcp',
    '--stdio',
    'RAILWAY_TOKEN',
    secrets.vercel
  ]);

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initOpenCodeHomeDirectory: opencodeHomeDirectory,
    initCommandExists: (command) => command === 'opencode',
    initRunCommand: (_command, args) => args[0] === '--version' ? { exitCode: 0, stdout: 'opencode 1.0.0', stderr: '' } : { exitCode: 0, stdout: 'authenticated', stderr: '' },
    initPrompter: async (defaults, context) => promptForSelectionsWithPromptAdapter(defaults, prompts, context)
  }).run(['node', 'ewokbot', 'init']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  for (const secret of Object.values(secrets)) {
    assert.doesNotMatch(captured.stdout, new RegExp(secret, 'u'));
    assert.doesNotMatch(captured.stderr, new RegExp(secret, 'u'));
  }
  assert.equal(prompts.calls.some((call) => call.kind === 'select' && call.message === 'Development runner' && call.choices.some((choice) => choice.includes('OpenCode'))), true);
  assert.equal(prompts.calls.some((call) => call.message.includes('OpenCode-specific env vars')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('Model/provider API key env vars')), false);
  assert.equal(prompts.calls.some((call) => call.kind === 'select' && call.message === 'Ticket provider'), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'checkbox' && call.message === 'Deployment/CI monitors'), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'confirm' && call.message.includes('oh-my-openagent')), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'input' && call.message.includes('JIRA_EMAIL value')), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'input' && call.message.includes('Jira MCP server id')), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'input' && call.message.includes('GitHub MCP command')), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'input' && call.message.includes('Railway MCP env_var_names')), true);
  assert.equal(prompts.calls.some((call) => call.kind === 'input' && call.message.includes('VERCEL_TOKEN value')), true);

  const configYaml = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  const config = parseWorkspaceConfig(configYaml);
  assert.equal(config.devRunner.mode, 'real');
  assert.equal(config.jira.mcpServerId, 'company-jira');
  assert.equal(config.github.mcpServerId, 'company-github');
  assert.equal(config.railway.mcpServerId, 'company-railway');
  assert.deepEqual(config.mcpServers.map((server) => ({ id: server.id, command: server.command, args: server.args, envVarNames: server.envVarNames })), [
    { id: 'company-jira', command: 'company-jira-mcp', args: ['--stdio', '--tenant company'], envVarNames: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] },
    { id: 'company-github', command: 'github-mcp', args: ['--stdio'], envVarNames: ['GITHUB_TOKEN'] },
    { id: 'company-railway', command: 'railway-mcp', args: ['--stdio'], envVarNames: ['RAILWAY_TOKEN'] }
  ]);
  assert.deepEqual(config.devRunner.envVarNames, ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']);

  const env = readFileSync(join(workspaceDir, '.ewokbot', '.env'), 'utf8');
  const envExample = readFileSync(join(workspaceDir, '.ewokbot', '.env.example'), 'utf8');
  assert.doesNotMatch(env, /^OPENCODE_API_KEY=/mu);
  assert.doesNotMatch(env, /^ANTHROPIC_API_KEY=/mu);
  assert.match(env, /^JIRA_EMAIL=agent@example\.test$/mu);
  assert.match(env, /^JIRA_API_TOKEN=jira-secret-value$/mu);
  assert.match(env, /^GITHUB_TOKEN=github-secret-value$/mu);
  assert.match(env, /^RAILWAY_TOKEN=railway-secret-value$/mu);
  assert.match(env, /^VERCEL_TOKEN=vercel-secret-value$/mu);
  for (const secret of Object.values(secrets)) {
    assert.doesNotMatch(envExample, new RegExp(secret, 'u'));
  }
  assert.doesNotMatch(envExample, /^OPENCODE_API_KEY=/mu);
  assert.doesNotMatch(envExample, /^ANTHROPIC_API_KEY=/mu);
  assert.match(envExample, /^JIRA_EMAIL=$/mu);
  assert.match(envExample, /^JIRA_API_TOKEN=$/mu);
  assert.match(envExample, /^GITHUB_TOKEN=$/mu);
  assert.match(envExample, /^RAILWAY_TOKEN=$/mu);
  assert.match(envExample, /^VERCEL_TOKEN=$/mu);
});

test('ewokbot init interactive-style mock wizard skips provider credential and MCP prompts', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-mock-wizard-'));
  const captured = createCapturedIO();
  const prompts = createFakePromptAdapter(['mock', false, 'mock', 'mock', []]);

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initPrompter: async (defaults, context) => promptForSelectionsWithPromptAdapter({ ...defaults, deploymentMonitor: 'none' }, prompts, context)
  }).run(['node', 'ewokbot', 'init']);

  const env = readFileSync(join(workspaceDir, '.ewokbot', '.env'), 'utf8');

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(env, /^OPENCODE_COMMAND=opencode$/mu);
  assert.equal(prompts.calls.some((call) => call.message.includes('JIRA_EMAIL')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('Jira MCP server')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('GITHUB_TOKEN')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('GitHub MCP command')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('RAILWAY_TOKEN')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('Railway MCP env_var_names')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('VERCEL_TOKEN')), false);
});

test('ewokbot init interactive wizard offers missing OpenCode instructions without running setup', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-missing-opencode-tui-'));
  const captured = createCapturedIO();
  const prompts = createFakePromptAdapter(['instructions', false, 'mock', 'mock', []]);
  const runCommands: string[] = [];

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initCommandExists: () => false,
    initRunCommand: (command, args) => {
      runCommands.push([command, ...args].join(' '));
      return { exitCode: 1, stdout: '', stderr: '' };
    },
    initPrompter: async (defaults, context) => promptForSelectionsWithPromptAdapter({ ...defaults, deploymentMonitor: 'none' }, prompts, context)
  }).run(['node', 'ewokbot', 'init']);

  const config = parseWorkspaceConfig(readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8'));

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(captured.stdout, /OpenCode readiness: opencode is not installed/u);
  assert.match(captured.stdout, /OpenCode setup instructions for opencode/u);
  assert.match(captured.stdout, /Ewokbot did not run installers, auth flows, or OpenCode commands for setup/u);
  assert.deepEqual(runCommands, []);
  assert.equal(config.devRunner.mode, 'mock');
  assert.equal(prompts.calls.some((call) => call.kind === 'select' && call.message === 'Development runner' && call.choices.includes('Enter custom OpenCode command path')), true);
});

test('ewokbot init interactive wizard requires acknowledgement for not-authenticated OpenCode', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-opencode-not-auth-'));
  const captured = createCapturedIO();
  const opencodeHomeDirectory = join(workspaceDir, 'opencode-home');
  const prompts = createFakePromptAdapter(['opencode', true, false, 'mock', 'mock', []]);
  const runCommands: string[] = [];

  mkdirSync(join(opencodeHomeDirectory, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(opencodeHomeDirectory, '.config', 'opencode', 'opencode.json'), '{"model":"anthropic/claude-sonnet-4"}\n');

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initOpenCodeHomeDirectory: opencodeHomeDirectory,
    initCommandExists: (command) => command === 'opencode',
    initRunCommand: (command, args) => {
      runCommands.push([command, ...args].join(' '));
      return args[0] === '--version'
        ? { exitCode: 0, stdout: 'opencode 1.0.0', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'not authenticated' };
    },
    initPrompter: async (defaults, context) => promptForSelectionsWithPromptAdapter({ ...defaults, deploymentMonitor: 'none' }, prompts, context)
  }).run(['node', 'ewokbot', 'init']);

  const configYaml = readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8');
  const config = parseWorkspaceConfig(configYaml);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(captured.stdout, /OpenCode readiness: opencode is installed but not authenticated/u);
  assert.match(captured.stdout, /OpenCode readiness warning: installed_not_authenticated/u);
  assert.equal(config.devRunner.mode, 'real');
  assert.equal(prompts.calls.some((call) => call.kind === 'confirm' && call.message.includes('Continue with OpenCode state installed_not_authenticated')), true);
  assert.equal(prompts.calls.some((call) => call.message.includes('OpenCode-specific env vars')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('Model/provider API key env vars')), false);
  assert.equal(runCommands.some((command) => command.includes('auth login') || command.includes('auth signup')), false);
  assert.doesNotMatch(configYaml, /OPENCODE_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY/u);
});

test('ewokbot init interactive wizard accepts a ready custom OpenCode command path', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-custom-opencode-'));
  const captured = createCapturedIO();
  const opencodeHomeDirectory = prepareReadyOpenCodeHome(workspaceDir);
  const customCommand = '/opt/local/bin/opencode';
  const prompts = createFakePromptAdapter(['custom', customCommand, false, 'mock', 'mock', []]);

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initOpenCodeHomeDirectory: opencodeHomeDirectory,
    initCommandExists: (command) => command === customCommand,
    initRunCommand: (_command, args) => args[0] === '--version' ? { exitCode: 0, stdout: 'opencode 1.0.0', stderr: '' } : { exitCode: 0, stdout: 'authenticated', stderr: '' },
    initPrompter: async (defaults, context) => promptForSelectionsWithPromptAdapter({ ...defaults, deploymentMonitor: 'none' }, prompts, context)
  }).run(['node', 'ewokbot', 'init']);

  const config = parseWorkspaceConfig(readFileSync(join(workspaceDir, '.ewokbot', 'workspace.yml'), 'utf8'));
  const env = readFileSync(join(workspaceDir, '.ewokbot', '.env'), 'utf8');

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.match(captured.stdout, /OpenCode readiness: opencode is not installed/u);
  assert.match(captured.stdout, /OpenCode readiness: \/opt\/local\/bin\/opencode is ready/u);
  assert.equal(config.devRunner.mode, 'real');
  assert.match(env, /^OPENCODE_COMMAND=\/opt\/local\/bin\/opencode$/mu);
  assert.equal(prompts.calls.some((call) => call.kind === 'input' && call.message === 'OpenCode command path'), true);
  assert.equal(prompts.calls.some((call) => call.message.includes('OpenCode-specific env vars')), false);
  assert.equal(prompts.calls.some((call) => call.message.includes('Model/provider API key env vars')), false);
});

test('ewokbot init stops real OpenCode setup when the command is missing', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-missing-opencode-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({
    cwd: workspaceDir,
    io: captured.io,
    initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir),
    initCommandExists: () => false
  }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--dev-runner',
    'opencode'
  ]);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /OpenCode command "opencode" is not ready \(not_installed\)/u);
  assert.doesNotMatch(captured.stderr, /curl -fsSL/u);
  assert.match(captured.stderr, /Choose the mock dev runner to continue without OpenCode/u);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), false);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', '.env')), false);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', '.env.example')), false);
});

test('ewokbot init rejects invalid deployment monitor values', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-invalid-monitor-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor',
    'vercl'
  ]);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Invalid --deployment-monitor value "vercl"/u);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), false);
});

test('ewokbot init rejects missing deployment monitor values', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'ewokbot-init-missing-monitor-'));
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({ cwd: workspaceDir, io: captured.io, initUserLayoutOptions: createTestUserLayoutOptions(workspaceDir) }).run([
    'node',
    'ewokbot',
    'init',
    '--non-interactive',
    '--deployment-monitor'
  ]);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /Missing value for --deployment-monitor/u);
  assert.equal(existsSync(join(workspaceDir, '.ewokbot', 'workspace.yml')), false);
});
