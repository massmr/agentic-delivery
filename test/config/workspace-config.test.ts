import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { defaultGitHubMcpToolNames, defaultRailwayMcpToolNames, loadWorkspaceConfig, parseWorkspaceConfig, WorkspaceConfigError } from '../../src/index.js';

const exampleConfigPath = resolve('config/workspace.example.yml');

function captureWorkspaceConfigError(run: () => void): WorkspaceConfigError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof WorkspaceConfigError) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected WorkspaceConfigError to be thrown.');
}

test('loads and validates config/workspace.example.yml', async () => {
  const config = await loadWorkspaceConfig(exampleConfigPath);

  assert.equal(config.workspace.name, 'la-kreme');
  assert.equal(config.workspace.maxConcurrentTickets, 1);
  assert.equal(config.jira.mode, 'mock');
  assert.deepEqual(config.jira.projectKeys, ['LK']);
  assert.equal(config.github.mode, 'mock');
  assert.equal(config.railway.mode, 'mock');
  assert.equal(config.devRunner.mode, 'mock');
  assert.equal(config.devRunner.provider, 'opencode');
  assert.deepEqual(config.devRunner.args, []);
  assert.equal(config.devRunner.timeoutMs, 1800000);
  assert.deepEqual(config.devRunner.envVarNames, ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']);
  assert.equal(config.devRunner.maxAttempts, 2);
  assert.equal(config.quality.defaultProfile, 'node');
  assert.deepEqual(config.mcpPolicy, { mode: 'read_only', providers: {}, servers: {}, tools: {} });
  assert.equal(config.repos.length, 2);
  assert.deepEqual(config.repos[0], {
    name: 'frontend',
    url: 'git@github.com:your-org/frontend.git',
    localPath: '../frontend',
    defaultBranch: 'develop',
    productionBranch: 'main',
    qualityProfile: 'node',
    hints: ['frontend', 'ui', 'web', 'next'],
    stagingSmokeUrls: ['/', '/health'],
    deployments: {
      staging: {
        provider: 'railway',
        projectId: 'prj_frontend',
        environmentId: 'env_staging',
        serviceId: 'svc_frontend',
        branch: 'develop',
        verification: {
          mode: 'railway_mcp',
          smokeUrls: ['/', '/health']
        }
      }
    }
  });
});

test('workspace repository config parses explicit Railway deployment mappings', () => {
  const config = parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  railway:
    display_name: Railway MCP
    command: railway
    args:
      - mcp
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls:
      - /health
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
            - /ready
`);

  assert.deepEqual(config.repos[0]?.deployments?.staging, {
    provider: 'railway',
    projectId: 'project-api',
    environmentId: 'env-staging',
    serviceId: 'service-api',
    branch: 'develop',
    verification: {
      mode: 'railway_mcp',
      smokeUrls: ['/ready']
    }
  });
});

test('workspace repository deployment mapping accepts missing Railway IDs for doctor guidance', () => {
  const config = parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  railway:
    display_name: Railway MCP
    command: railway
    args:
      - mcp
repos:
  - name: worker
    url: git@github.com:agentic/worker.git
    local_path: ../worker
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
          mode: railway_mcp
`);

  assert.equal(config.repos[0]?.deployments?.staging?.projectId, undefined);
  assert.equal(config.repos[0]?.deployments?.staging?.verification.mode, 'railway_mcp');
});

test('workspace repository deployment mapping defaults verification smoke URLs from repository smoke URLs', () => {
  const config = parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
repos:
  - name: frontend
    url: git@github.com:agentic/frontend.git
    local_path: ../frontend
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - frontend
    staging_smoke_urls:
      - /health
    deployments:
      staging:
        provider: railway
        verification:
          mode: http_smoke
`);

  assert.deepEqual(config.repos[0]?.deployments?.staging?.verification, {
    mode: 'http_smoke',
    smokeUrls: ['/health']
  });
});

test('workspace repository config parses staging_smoke_urls and permits an empty array', () => {
  const config = parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`);

  assert.deepEqual(config.repos[0]?.stagingSmokeUrls, []);
});

test('workspace config discovery mode normalizes sibling Git repositories', () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'ewokbot-config-discovery-'));

  try {
    mkdirSync(join(rootPath, 'service-b', '.git'), { recursive: true });
    mkdirSync(join(rootPath, 'service-a', '.git'), { recursive: true });

    const config = parseWorkspaceConfig(minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude: []
`), { workspaceRoot: rootPath });

    assert.equal(config.repositoryDiscovery?.discovery, 'sibling-git-directories');
    assert.deepEqual(config.repositoryDiscovery?.exclude, []);
    assert.deepEqual(config.repos.map((repo) => repo.name), ['service-a', 'service-b']);
    assert.equal(config.repos[0]?.localPath, './service-a');
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test('workspace config discovery mode applies per-repository deployment overrides without losing other repos', () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'ewokbot-config-discovery-deployments-'));

  try {
    mkdirSync(join(rootPath, 'frontend', '.git'), { recursive: true });
    mkdirSync(join(rootPath, 'api', '.git'), { recursive: true });

    const config = parseWorkspaceConfig(minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude: []
  deployments:
    frontend:
      staging:
        provider: railway
        project_id: project-frontend
        environment_id: env-staging
        service_id: service-frontend
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls:
            - /health
`), { workspaceRoot: rootPath });

    assert.deepEqual(config.repos.map((repo) => repo.name), ['api', 'frontend']);
    assert.equal(config.repos.find((repo) => repo.name === 'api')?.deployments?.staging, undefined);
    assert.equal(config.repos.find((repo) => repo.name === 'frontend')?.deployments?.staging?.projectId, 'project-frontend');
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test('workspace config discovery mode honors excludes', () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'ewokbot-config-discovery-exclude-'));

  try {
    mkdirSync(join(rootPath, 'service-a', '.git'), { recursive: true });
    mkdirSync(join(rootPath, 'service-b', '.git'), { recursive: true });

    const config = parseWorkspaceConfig(minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude:
    - service-b
`), { workspaceRoot: rootPath });

    assert.deepEqual(config.repos.map((repo) => repo.name), ['service-a']);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test('workspace config rejects unknown repository discovery mode', () => {
  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(minimalWorkspaceConfig(`repos:
  discovery: recursive
  exclude: []
`)));

  assert.ok(error.issues.some((issue) => issue.path === 'repos.discovery'));
  assert.match(error.message, /repos\.discovery must be sibling-git-directories/u);
});

test('workspace config still rejects an explicit empty repository array', () => {
  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(minimalWorkspaceConfig('repos: []\n')));

  assert.ok(error.issues.some((issue) => issue.path === 'repos'));
  assert.match(error.message, /repos must include at least one repository/u);
});

test('invalid YAML reports a clear syntax issue', () => {
  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig('workspace:\n  name: [unterminated'));

  assert.equal(error.issues[0]?.path, 'yaml');
  assert.match(error.message, /YAML syntax error/u);
  assert.match(error.message, /Fix the YAML syntax/u);
});

test('missing required field reports path and action', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const missingFieldSource = source.replace('  max_concurrent_tickets: 1\n', '');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(missingFieldSource));

  assert.ok(error.issues.some((issue) => issue.path === 'workspace.max_concurrent_tickets'));
  assert.match(error.message, /workspace\.max_concurrent_tickets must be a positive integer/u);
  assert.match(error.message, /Set workspace\.max_concurrent_tickets to a whole number greater than 0/u);
});

test('workspace config accepts real provider modes without creating live adapters', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const realProviderSource = source
    .replace('jira:\n  mode: mock', 'jira:\n  mode: real')
    .replace('github:\n  mode: mock', 'github:\n  mode: real')
    .replace('railway:\n  mode: mock', 'railway:\n  mode: real')
    .replace('dev_runner:\n  provider: opencode', 'dev_runner:\n  mode: real\n  provider: opencode');

  const config = parseWorkspaceConfig(realProviderSource);

  assert.equal(config.jira.mode, 'real');
  assert.equal(config.github.mode, 'real');
  assert.equal(config.railway.mode, 'real');
  assert.equal(config.devRunner.mode, 'real');
});

test('workspace config accepts valid Jira MCP project keys', () => {
  const config = parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - LK
    - LK2
    - LK_API
  mcp_server: atlassian
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  atlassian:
    display_name: Atlassian MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.atlassian.com/v1/mcp/authv2
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`);

  assert.deepEqual(config.jira.projectKeys, ['LK', 'LK2', 'LK_API']);
});

test('workspace config accepts GitHub MCP settings', () => {
  const config = parseWorkspaceConfig(workspaceWithGitHubMcp());

  assert.equal(config.github.mode, 'mcp');
  assert.equal(config.github.mcpServerId, 'github');
  assert.deepEqual(config.github.mcpToolNames, {
    listBranches: 'github.listBranches',
    createBranch: 'github.createBranch',
    listPullRequests: 'github.listPullRequests',
    openPullRequest: 'github.createPullRequest',
    getChecks: 'github.pullRequestRead',
    commentOnPullRequest: 'github.addIssueComment',
    mergePullRequest: 'github.mergePullRequest'
  });
  assert.equal(config.mcpServers[0]?.id, 'github');
});

test('workspace config defaults no remote checks policy to wait', () => {
  const config = parseWorkspaceConfig(minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude: []
`));

  assert.equal(config.delivery.checks.noRemoteChecks, 'wait');
  assert.equal(config.delivery.pullRequests.develop.autoMerge, false);
  assert.equal(config.delivery.pullRequests.develop.draftMode, 'always');
  assert.equal(config.delivery.pullRequests.main.autoMerge, false);
  assert.equal(config.delivery.pullRequests.main.requireHumanApproval, true);
});

test('workspace config parses explicit delivery PR follow-up policy', () => {
  const config = parseWorkspaceConfig(`${minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude: []
`)}delivery:
  checks:
    no_remote_checks: pass
  pull_requests:
    develop:
      auto_merge: true
      merge_method: rebase
      require_checks: pass_or_absent
      draft_mode: auto
      after_merge:
        verify_deployment: true
    main:
      auto_merge: false
      require_human_approval: true
`);

  assert.equal(config.delivery.checks.noRemoteChecks, 'pass');
  assert.equal(config.delivery.pullRequests.develop.autoMerge, true);
  assert.equal(config.delivery.pullRequests.develop.mergeMethod, 'rebase');
  assert.equal(config.delivery.pullRequests.develop.requireChecks, 'pass_or_absent');
  assert.equal(config.delivery.pullRequests.develop.draftMode, 'auto');
  assert.equal(config.delivery.pullRequests.main.autoMerge, false);
  assert.equal(config.delivery.pullRequests.main.requireHumanApproval, true);
});

test('workspace config rejects unsafe or invalid delivery policy values', () => {
  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(`${minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude: []
`)}delivery:
  checks:
    no_remote_checks: maybe
  pull_requests:
    develop:
      merge_method: fast_forward
      draft_mode: maybe
    main:
      auto_merge: true
`));

  assert.ok(error.issues.some((issue) => issue.path === 'delivery.checks.no_remote_checks'));
  assert.ok(error.issues.some((issue) => issue.path === 'delivery.pull_requests.develop.merge_method'));
  assert.ok(error.issues.some((issue) => issue.path === 'delivery.pull_requests.develop.draft_mode'));
  assert.ok(error.issues.some((issue) => issue.path === 'delivery.pull_requests.main.auto_merge'));
  assert.match(error.message, /delivery\.checks\.no_remote_checks must be one of: pass, wait, needs_human, fail/u);
  assert.match(error.message, /delivery\.pull_requests\.develop\.draft_mode must be one of: always, never, auto/u);
  assert.match(error.message, /Main\/production pull requests cannot be auto-merged by Ewokbot/u);
});

test('workspace config accepts Railway MCP settings', () => {
  const config = parseWorkspaceConfig(workspaceWithRailwayMcp());

  assert.equal(config.railway.mode, 'mcp');
  assert.equal(config.railway.mcpServerId, 'railway');
  assert.deepEqual(config.railway.mcpToolNames, defaultRailwayMcpToolNames);
  assert.equal(config.mcpServers[0]?.id, 'railway');
});

test('workspace config preserves partial Railway MCP tool overrides for inspected tools', () => {
  const config = parseWorkspaceConfig(workspaceWithRailwayMcp().replace('  mcp_server: railway\n', `  mcp_server: railway
  mcp_tools:
    wait_for_deployment: custom_list_deployments
    environment_status: custom_environment_status
    get_service_config: custom_get_service_config
    get_logs: custom_get_logs
`));

  assert.deepEqual(config.railway.mcpToolNames, {
    ...defaultRailwayMcpToolNames,
    waitForDeployment: 'custom_list_deployments',
    environmentStatus: 'custom_environment_status',
    getServiceConfig: 'custom_get_service_config',
    getLogs: 'custom_get_logs'
  });
});

test('workspace config uses default Railway MCP tool names when mcp_tools is omitted', () => {
  const config = parseWorkspaceConfig(workspaceWithRailwayMcpDefaults());

  assert.deepEqual(config.railway.mcpToolNames, defaultRailwayMcpToolNames);
});

test('workspace config uses default GitHub MCP tool names when mcp_tools is omitted', () => {
  const config = parseWorkspaceConfig(workspaceWithGitHubMcpDefaults());

  assert.deepEqual(config.github.mcpToolNames, defaultGitHubMcpToolNames);
});

test('workspace config parses MCP policy modes and override maps', () => {
  const config = parseWorkspaceConfig(`${minimalWorkspaceConfig('repos:\n  discovery: sibling-git-directories\n  exclude: []\n')}
mcp_policy:
  mode: custom
  providers:
    atlassian: require_human
  servers:
    railway:
      decision: deny
      reason: Railway writes are paused.
  tools:
    create_pull_request:
      decision: allow
      reason: Staging PRs are allowed.
`);

  assert.equal(config.mcpPolicy.mode, 'custom');
  assert.deepEqual(config.mcpPolicy.providers?.atlassian, { decision: 'require_human' });
  assert.deepEqual(config.mcpPolicy.servers?.railway, { decision: 'deny', reason: 'Railway writes are paused.' });
  assert.deepEqual(config.mcpPolicy.tools?.create_pull_request, { decision: 'allow', reason: 'Staging PRs are allowed.' });
});

test('workspace config defaults omitted MCP policy to read_only', () => {
  const config = parseWorkspaceConfig(minimalWorkspaceConfig(`repos:
  discovery: sibling-git-directories
  exclude: []
`));

  assert.deepEqual(config.mcpPolicy, { mode: 'read_only', providers: {}, servers: {}, tools: {} });
});

test('workspace config rejects invalid MCP policy modes and decisions', () => {
  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(`${minimalWorkspaceConfig('repos:\n  discovery: sibling-git-directories\n  exclude: []\n')}
mcp_policy:
  mode: reckless
  tools:
    github.merge:
      decision: execute
`));

  assert.ok(error.issues.some((issue) => issue.path === 'mcp_policy.mode'));
  assert.ok(error.issues.some((issue) => issue.path === 'mcp_policy.tools.github.merge.decision'));
  assert.match(error.message, /mcp_policy\.mode must be 'read_only', 'supervised', 'trusted', or 'custom'/u);
  assert.match(error.message, /must be 'allow', 'allow_redacted', 'require_human', or 'deny'/u);
});

test('workspace config rejects invalid Jira MCP project keys', () => {
  for (const invalidKey of ['LK) OR status IS NOT EMPTY', 'lk', ' LK', '1LK', 'LK!']) {
    const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(`
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - ${JSON.stringify(invalidKey)}
  mcp_server: atlassian
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  atlassian:
    display_name: Atlassian MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.atlassian.com/v1/mcp/authv2
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`));

  assert.equal(error.issues[0]?.path, 'jira.project_keys[0]');
  assert.match(error.message, /must start with an uppercase letter and contain only uppercase letters, digits, or underscores/u);
  assert.match(error.message, /Use keys like LK, LK2, or LK_API/u);
  }
});

test('workspace config rejects GitHub MCP configs without a matching top-level server', () => {
  const missingServerConfig = workspaceWithGitHubMcp().replace('  mcp_server: github\n', '  mcp_server: missing\n');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(missingServerConfig));

  assert.ok(error.issues.some((issue) => issue.path === 'github.mcp_server'));
  assert.match(error.message, /github\.mcp_server references 'missing'/u);
  assert.match(error.message, /add a matching mcp_servers entry/i);
});

test('workspace config rejects Railway MCP configs without a matching top-level server', () => {
  const missingServerConfig = workspaceWithRailwayMcp().replace('  mcp_server: railway\n', '  mcp_server: missing\n');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(missingServerConfig));

  assert.ok(error.issues.some((issue) => issue.path === 'railway.mcp_server'));
  assert.match(error.message, /railway\.mcp_server references 'missing'/u);
  assert.match(error.message, /add a matching mcp_servers entry/i);
});

test('workspace config rejects unknown provider modes', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const invalidProviderSource = source.replace('jira:\n  mode: mock', 'jira:\n  mode: live');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(invalidProviderSource));

  assert.ok(error.issues.some((issue) => issue.path === 'jira.mode'));
  assert.match(error.message, /jira\.mode must be 'mock', 'real', or 'mcp'/u);
});

test('bad repository entry reports the exact repo field path', async () => {
  const source = await readFile(exampleConfigPath, 'utf8');
  const badRepoSource = source.replace('    local_path: ../api\n', '    local_path: ""\n').replace('      - database\n', '      - ""\n');

  const error = captureWorkspaceConfigError(() => parseWorkspaceConfig(badRepoSource));

  assert.ok(error.issues.some((issue) => issue.path === 'repos[1].local_path'));
  assert.ok(error.issues.some((issue) => issue.path === 'repos[1].hints[3]'));
  assert.match(error.message, /repos\[1\]\.local_path must be a non-empty string/u);
  assert.match(error.message, /Add at least one non-empty repository hint/u);
});

function workspaceWithGitHubMcp(): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - LK
github:
  mode: mcp
  organization: agentic
  mcp_server: github
  mcp_tools:
    list_branches: github.listBranches
    create_branch: github.createBranch
    list_pull_requests: github.listPullRequests
    open_pull_request: github.createPullRequest
    get_checks: github.pullRequestRead
    comment_pull_request: github.addIssueComment
    merge_pull_request: github.mergePullRequest
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  github:
    display_name: GitHub MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.github.com/v1/mcp
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`;
}

function workspaceWithRailwayMcp(): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - LK
github:
  mode: mock
  organization: agentic
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  railway:
    display_name: Railway MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.railway.com/v1/mcp
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`;
}

function workspaceWithRailwayMcpDefaults(): string {
  return workspaceWithRailwayMcp();
}

function workspaceWithGitHubMcpDefaults(): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - LK
github:
  mode: mcp
  organization: agentic
  mcp_server: github
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
mcp_servers:
  github:
    display_name: GitHub MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.github.com/v1/mcp
repos:
  - name: api
    url: git@github.com:agentic/api.git
    local_path: ../api
    default_branch: develop
    production_branch: main
    quality_profile: node
    hints:
      - api
    staging_smoke_urls: []
`;
}

function minimalWorkspaceConfig(reposSection: string): string {
  return `
workspace:
  name: test
  autonomy: full_until_production_pr
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - LK
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: opencode
  max_attempts: 2
quality:
  default_profile: node
${reposSection}`;
}
