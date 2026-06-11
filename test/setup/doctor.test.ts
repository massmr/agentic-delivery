import * as assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEwokbotUserLayout, createOnboardingFiles, runLocalDoctor } from '../../src/index.js';

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function writeGeneratedSetup(cwd: string, monitor: 'railway' | 'vercel' | 'both' = 'both'): void {
  const files = createOnboardingFiles({ deploymentMonitor: monitor, includeOhMyOpenAgent: false });
  mkdirSync(join(cwd, '.ewokbot'), { recursive: true });
  writeFileSync(join(cwd, '.ewokbot', 'workspace.yml'), files.workspaceYaml, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env'), files.env, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env.example'), files.envExample, 'utf8');
}

function createTestUserLayoutOptions(cwd: string) {
  return {
    homeDirectory: join(cwd, 'home'),
    env: {
      XDG_CONFIG_HOME: join(cwd, 'xdg-config'),
      XDG_DATA_HOME: join(cwd, 'xdg-data'),
      XDG_CACHE_HOME: join(cwd, 'xdg-cache')
    }
  };
}

test('doctor reports generated setup with injected local probes and warn-only mock readiness', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-generated-');
  writeGeneratedSetup(cwd, 'both');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Node.js'), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'pnpm'), true);
  assert.equal(report.checks.some((check) => check.status === 'warn' && check.label === 'OpenCode' && /authentication was not detected/u.test(check.message)), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === '.ewokbot/.env'), true);
  assert.equal(report.checks.some((check) => check.status === 'warn' && check.label === 'Repository discovery'), true);
  assert.equal(report.checks.some((check) => check.status === 'fail'), false);
});

test('doctor redacts env values while reporting provider readiness', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-redaction-');
  writeGeneratedSetup(cwd, 'railway');
  writeFileSync(
    join(cwd, '.ewokbot', '.env'),
    [
      'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_secret_value',
      'JIRA_BASE_URL=https://secret-jira.example.test',
      'JIRA_EMAIL=secret@example.test',
      'JIRA_API_TOKEN=jira_secret_value',
      'RAILWAY_TOKEN=railway_secret_value'
    ].join('\n'),
    'utf8'
  );

  const report = runLocalDoctor(cwd, {
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });
  const rendered = JSON.stringify(report);

  assert.equal(report.checks.some((check) => check.label === 'GitHub' && check.status === 'pass'), true);
  assert.equal(report.checks.some((check) => check.label === 'Jira' && check.status === 'pass'), true);
  assert.equal(report.checks.some((check) => check.label === 'Railway' && check.status === 'pass'), true);
  assert.doesNotMatch(rendered, /ghp_secret_value|jira_secret_value|railway_secret_value|secret@example/u);
  assert.match(rendered, /\[redacted\]/u);
});

test('doctor fails missing provider secrets when provider mode is non-mock', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-real-mode-');
  writeGeneratedSetup(cwd, 'railway');
  const configPath = join(cwd, '.ewokbot', 'workspace.yml');
  const source = createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).workspaceYaml
    .replace('github:\n  mode: mock', 'github:\n  mode: real');
  writeFileSync(configPath, source, 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.status === 'fail' && check.label === 'GitHub' && /GITHUB_TOKEN/u.test(check.message)), true);
});

test('doctor validates Railway MCP through the Railway CLI preset instead of env tokens', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-railway-mcp-cli-');
  const files = createOnboardingFiles({
    deploymentMonitor: 'railway',
    includeOhMyOpenAgent: false,
    railwayProvider: 'railway-mcp'
  });
  mkdirSync(join(cwd, '.ewokbot'), { recursive: true });
  writeFileSync(join(cwd, '.ewokbot', 'workspace.yml'), files.workspaceYaml, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env'), files.env, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env.example'), files.envExample, 'utf8');

  const missingCliReport = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });
  assert.equal(missingCliReport.ok, false);
  assert.equal(missingCliReport.checks.some((check) => check.label === 'Railway' && check.status === 'fail' && /railway command was not found/u.test(check.message)), true);

  const readyCliReport = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode' || command === 'railway',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });
  assert.equal(readyCliReport.checks.some((check) => check.label === 'Railway' && check.status === 'pass' && /railway command is available/u.test(check.message)), true);
});

test('doctor validates per-repository Railway deployment mappings locally', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-bd-deployment-mapping-');
  const apiPath = join(cwd, 'api');
  const frontendPath = join(cwd, 'frontend');
  const workerPath = join(cwd, 'worker');
  mkdirSync(join(apiPath, '.git'), { recursive: true });
  mkdirSync(join(frontendPath, '.git'), { recursive: true });
  mkdirSync(join(workerPath, '.git'), { recursive: true });
  for (const repoPath of [apiPath, frontendPath, workerPath]) {
    writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }), 'utf8');
  }
  const source = createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false, railwayProvider: 'railway-mcp' }).workspaceYaml.replace(`repos:
  discovery: sibling-git-directories
  exclude: []
`, `repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ./api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
    deployments:
      staging:
        provider: railway
        project_id: project-api
        environment_id: env-staging
        service_id: service-api
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls:
            - /health
  - name: frontend
    url: git@github.com:agentic/frontend.git
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls: []
    deployments:
      staging:
        provider: railway
        branch: develop
        verification:
          mode: http_smoke
          smoke_urls:
            - https://frontend.example.test/health
  - name: worker
    url: git@github.com:agentic/worker.git
    local_path: ./worker
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - worker
    staging_smoke_urls: []
    deployments:
      staging:
        provider: railway
        branch: develop
        verification:
          mode: none
          smoke_urls: []
`);
  mkdirSync(join(cwd, '.ewokbot'), { recursive: true });
  writeFileSync(join(cwd, '.ewokbot', 'workspace.yml'), source, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env.example'), createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).envExample, 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode' || command === 'railway',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some((check) => check.label === 'Deployment api' && check.status === 'pass' && /project project-api/u.test(check.message)), true);
  assert.equal(report.checks.some((check) => check.label === 'Deployment frontend' && check.status === 'pass' && /HTTP smoke verification/u.test(check.message)), true);
  assert.equal(report.checks.some((check) => check.label === 'Deployment worker' && check.status === 'pass' && /does not require Railway project/u.test(check.message)), true);
});

test('doctor reports actionable per-repository deployment mapping gaps', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-bd-deployment-gaps-');
  const apiPath = join(cwd, 'api');
  const frontendPath = join(cwd, 'frontend');
  mkdirSync(join(apiPath, '.git'), { recursive: true });
  mkdirSync(join(frontendPath, '.git'), { recursive: true });
  const source = createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false, railwayProvider: 'railway-mcp' }).workspaceYaml.replace(`repos:
  discovery: sibling-git-directories
  exclude: []
`, `repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ./api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
    deployments:
      staging:
        provider: railway
        project_id: project-api
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls: []
  - name: frontend
    url: git@github.com:agentic/frontend.git
    local_path: ./frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls: []
    deployments:
      staging:
        provider: railway
        branch: develop
        verification:
          mode: http_smoke
          smoke_urls:
            - /health
`);
  mkdirSync(join(cwd, '.ewokbot'), { recursive: true });
  writeFileSync(join(cwd, '.ewokbot', 'workspace.yml'), source, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env.example'), createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).envExample, 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode' || command === 'railway',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.label === 'Deployment api' && check.status === 'fail' && /environment_id, service_id/u.test(check.message)), true);
  assert.equal(report.checks.some((check) => check.label === 'Deployment frontend' && check.status === 'fail' && /absolute HTTP\(S\)/u.test(check.message)), true);
});

test('doctor describes the Atlassian MCP preset when Jira work-item setup is missing the local command', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ax0-atlassian-mcp-');
  const files = createOnboardingFiles({
    deploymentMonitor: 'vercel',
    includeOhMyOpenAgent: false,
    ticketProvider: 'jira-mcp'
  });
  mkdirSync(join(cwd, '.ewokbot'), { recursive: true });
  writeFileSync(join(cwd, '.ewokbot', 'workspace.yml'), files.workspaceYaml, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env'), files.env, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env.example'), files.envExample, 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  const atlassianCheck = report.checks.find((check) => check.label === 'MCP atlassian');
  assert.equal(atlassianCheck?.status, 'fail');
  assert.match(atlassianCheck?.nextStep ?? '', /Atlassian MCP for Jira work items/u);
  assert.doesNotMatch(atlassianCheck?.nextStep ?? '', /Jira MCP/u);
});

test('doctor validates repository branch and quality readiness statically', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-repo-');
  const repoPath = join(cwd, 'frontend');
  mkdirSync(join(repoPath, '.git'), { recursive: true });
  writeGeneratedSetup(cwd, 'vercel');
  writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }), 'utf8');

  const report = runLocalDoctor(cwd, {
    env: {
      GITHUB_ORG: 'agentic',
      GITHUB_TOKEN: 'present',
      JIRA_BASE_URL: 'https://jira.example.test',
      JIRA_EMAIL: 'bot@example.test',
      JIRA_API_TOKEN: 'present',
      VERCEL_TOKEN: 'present'
    },
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  assert.equal(report.ok, true);
  assert.equal(
    report.checks.some(
      (check) => check.status === 'pass' && check.label === 'Repository discovery' && /Found 1 direct sibling Git repository: frontend/u.test(check.message)
    ),
    true
  );
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Repository frontend'), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Quality frontend'), true);
  assert.equal(report.checks.some((check) => check.label === 'Branch policy' && check.status === 'fail'), false);
});

test('doctor reports discovered sibling repository count and names', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ah-discovery-');
  mkdirSync(join(cwd, 'api', '.git'), { recursive: true });
  mkdirSync(join(cwd, 'frontend', '.git'), { recursive: true });
  writeGeneratedSetup(cwd, 'both');

  const report = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  const discoveryCheck = report.checks.find((check) => check.label === 'Repository discovery');
  assert.equal(discoveryCheck?.status, 'pass');
  assert.match(discoveryCheck?.message ?? '', /Found 2 direct sibling Git repositories: api, frontend/u);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Repository api'), true);
  assert.equal(report.checks.some((check) => check.status === 'pass' && check.label === 'Repository frontend'), true);
});

test('doctor fails unsafe branch settings and invalid quality config', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ab-unsafe-');
  const repoPath = join(cwd, 'frontend');
  mkdirSync(join(repoPath, '.git'), { recursive: true });
  const source = createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).workspaceYaml
    .replace('staging_branch: develop', 'staging_branch: main')
    .replace(`repos:
  discovery: sibling-git-directories
  exclude: []
`, `repos:
  - name: frontend
    url: git@github.com:agentic/frontend.git
    local_path: ./frontend
    default_branch: main
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls: []
`);
  mkdirSync(join(cwd, '.ewokbot'), { recursive: true });
  writeFileSync(join(cwd, '.ewokbot', 'workspace.yml'), source, 'utf8');
  writeFileSync(join(cwd, '.ewokbot', '.env.example'), createOnboardingFiles({ deploymentMonitor: 'railway', includeOhMyOpenAgent: false }).envExample, 'utf8');
  writeFileSync(join(repoPath, '.agent-quality.yml'), 'commands: []\nrequired: test\n', 'utf8');

  const report = runLocalDoctor(cwd, {
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions: createTestUserLayoutOptions(cwd)
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((check) => check.label === 'Branch policy' && check.status === 'fail'), true);
  assert.equal(report.checks.some((check) => check.label === 'Quality frontend' && check.status === 'fail'), true);
});

test('doctor reports user-level paths missing and present without reading auth contents', async () => {
  const cwd = await createWorkspace('ewokbot-doctor-ak-user-layout-');
  writeGeneratedSetup(cwd, 'railway');
  const userLayoutOptions = createTestUserLayoutOptions(cwd);

  const missingReport = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions
  });

  assert.equal(missingReport.checks.some((check) => check.status === 'warn' && check.label === 'User config'), true);
  assert.equal(missingReport.checks.some((check) => check.status === 'warn' && check.label === 'Ewokbot auth'), true);
  assert.equal(missingReport.checks.some((check) => check.status === 'warn' && check.label === 'User state'), true);
  assert.equal(missingReport.checks.some((check) => check.status === 'warn' && check.label === 'User cache'), true);

  const layout = await createEwokbotUserLayout(userLayoutOptions);
  writeFileSync(layout.auth.file, '{"token":"secret-user-auth-value"}\n', 'utf8');
  if (process.platform !== 'win32') {
    chmodSync(layout.auth.file, 0o600);
  }

  const presentReport = runLocalDoctor(cwd, {
    env: {},
    nodeVersion: 'v20.11.1',
    commandExists: (command) => command === 'pnpm' || command === 'opencode',
    opencodeHomeDirectory: join(cwd, 'opencode-home'),
    userLayoutOptions
  });
  const rendered = JSON.stringify(presentReport);

  assert.equal(presentReport.checks.some((check) => check.status === 'pass' && check.label === 'User config'), true);
  assert.equal(presentReport.checks.some((check) => check.status === 'pass' && check.label === 'Ewokbot auth'), true);
  assert.equal(presentReport.checks.some((check) => check.status === 'pass' && check.label === 'User state'), true);
  assert.equal(presentReport.checks.some((check) => check.status === 'pass' && check.label === 'User cache'), true);
  assert.doesNotMatch(rendered, /secret-user-auth-value/u);
});
