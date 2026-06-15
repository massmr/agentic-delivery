import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  JsonRunStateStore,
  applyInvocationControlConfigPatch,
  buildInvocationControlSummary,
  createDeliveryRunStateRecord,
  inspectInvocationControlRun,
  listInvocationControlTickets,
  readInvocationControlReport,
  runInvocationControlDoctor,
  startInvocationControlApiServer,
  transitionDeliveryRunState,
  type DeliveryTicket,
  type RailwayDiscoveryPort,
  type TicketPort
} from '../src/index.js';

type StagingMappingSaveResponse = {
  readonly mapping: {
    readonly repo: string;
    readonly staging: {
      readonly provider: 'railway';
      readonly projectId?: string | undefined;
      readonly environmentId?: string | undefined;
      readonly serviceId?: string | undefined;
      readonly branch: string;
      readonly verification: {
        readonly mode: 'railway_mcp' | 'github_only' | 'none';
        readonly smokeUrls: readonly string[];
      };
    };
  };
  readonly config: {
    readonly exists: true;
    readonly parses: boolean;
    readonly issues: readonly string[];
  };
  readonly doctor: {
    readonly checks: readonly {
      readonly label: string;
      readonly status: 'pass' | 'warn' | 'fail';
      readonly message: string;
      readonly action?: string | undefined;
    }[];
    readonly lines: readonly string[];
  };
};

type ErrorResponse = {
  readonly error?: string | undefined;
  readonly unsupportedFields?: readonly string[] | undefined;
  readonly issues?: readonly string[] | undefined;
};

test('invocation control summary exposes workspace state without secret values', async () => {
  const rootPath = createWorkspace();
  const store = new JsonRunStateStore(rootPath);
  await store.write(createRunState());
  writeFileSync(join(rootPath, '.ewokbot', 'runs', 'AD-401', 'ui-run', 'plan.md'), '# Plan\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'runs', 'AD-401', 'ui-run', 'core-safety.json'), '{"status":"passed"}\n', 'utf8');

  const summary = await buildInvocationControlSummary({ workspaceRoot: rootPath });
  const json = JSON.stringify(summary);

  assert.equal(summary.workspaceRoot, rootPath);
  assert.equal(summary.config.exists, true);
  assert.equal(summary.config.parses, true);
  assert.equal(summary.providers?.jira.mode, 'mock');
  assert.equal(summary.providers?.devRunner.provider, 'opencode');
  assert.deepEqual(summary.providers?.devRunner.envVarNames, ['OPENCODE_AUTH_TOKEN']);
  assert.equal(summary.deliveryPolicy?.noRemoteChecks, 'pass');
  assert.equal(summary.deliveryPolicy?.develop.autoMerge, true);
  assert.equal(summary.repositories[0]?.id, 'agentic/frontend');
  assert.equal(summary.railwayMappings[0]?.status, 'configured');
  assert.equal(summary.mcpServers[0]?.id, 'jira-mcp');
  assert.deepEqual(summary.mcpServers[0]?.envVarNames, ['JIRA_TOKEN']);
  assert.equal(summary.runs[0]?.runId, 'ui-run');
  assert.equal(summary.runs[0]?.reports.find((report) => report.id === 'core-safety')?.exists, true);
  assert.doesNotMatch(json, /super-secret/u);
  assert.doesNotMatch(json, /\.ewokbot\/\.env/u);
});

test('invocation control doctor and scan remain local and typed-port only', async () => {
  const rootPath = createWorkspace();
  const doctor = runInvocationControlDoctor(rootPath);
  const tickets = await listInvocationControlTickets({ workspaceRoot: rootPath, ticketPort: fakeTicketPort });
  const mcpCheck = doctor.checks.find((check) => check.label === 'MCP jira-mcp');

  assert.equal(doctor.lines.some((line) => /no provider, MCP, installer, or network calls/u.test(line)), true);
  assert.equal(mcpCheck?.status, 'pass');
  assert.deepEqual(tickets.map((ticket) => ticket.ref.key), ['AD-401']);
});

test('invocation control can inspect runs, read reports, and patch safe config fields', async () => {
  const rootPath = createWorkspace();
  const store = new JsonRunStateStore(rootPath);
  await store.write(createRunState());
  writeFileSync(join(rootPath, '.ewokbot', 'runs', 'AD-401', 'ui-run', 'plan.md'), '# Safe plan\n', 'utf8');

  const inspection = await inspectInvocationControlRun(rootPath, 'ui-run');
  const report = await readInvocationControlReport(rootPath, 'ui-run', 'plan');
  const patched = applyInvocationControlConfigPatch(rootPath, {
    workspaceName: 'Edited UI Workspace',
    maxConcurrentTickets: 2
  });
  const configYaml = readFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), 'utf8');

  assert.equal(inspection.run.ticketKey, 'AD-401');
  assert.equal(report.content, '# Safe plan\n');
  assert.equal(patched.parses, true);
  assert.match(configYaml, /name: Edited UI Workspace/u);
  assert.match(configYaml, /max_concurrent_tickets: 2/u);

  assert.throws(
    () => applyInvocationControlConfigPatch(rootPath, { workspaceName: 'Unsafe', githubToken: 'super-secret' } as never),
    /Unsupported UI config field\(s\): githubToken/u
  );
  assert.doesNotMatch(readFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), 'utf8'), /githubToken|super-secret/u);
});

test('invocation control API uses selected CORS origin and rejects unsupported config fields', async () => {
  const rootPath = createWorkspace();
  const allowedOrigin = 'http://127.0.0.1:3002';
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1', allowedOrigin });

  try {
    const optionsResponse = await fetch(`${api.url}/api/summary`, { method: 'OPTIONS' });
    assert.equal(optionsResponse.status, 204);
    assert.equal(optionsResponse.headers.get('access-control-allow-origin'), allowedOrigin);

    const patchResponse = await fetch(`${api.url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceName: 'API Edited Workspace', autonomy: 'supervised', maxConcurrentTickets: 3 })
    });
    assert.equal(patchResponse.status, 200);
    assert.equal(patchResponse.headers.get('access-control-allow-origin'), allowedOrigin);

    const rejectedResponse = await fetch(`${api.url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceName: 'Unsafe API Edit', githubToken: 'super-secret' })
    });
    const rejectedBody = await rejectedResponse.json() as { readonly error?: string };
    const configYaml = readFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), 'utf8');

    assert.equal(rejectedResponse.status, 500);
    assert.match(rejectedBody.error ?? '', /Unsupported UI config field\(s\): githubToken/u);
    assert.doesNotMatch(configYaml, /githubToken|super-secret/u);
  } finally {
    await api.close();
  }
});

test('BG contract: API saves one Railway MCP staging mapping while preserving sibling discovery config', async () => {
  const rootPath = createDiscoveryWorkspace();
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1' });

  try {
    const response = await putStagingMapping(api.url, 'api', {
      provider: 'railway',
      project_id: 'prj_manual_api',
      environment_id: 'env_manual_staging',
      service_id: 'svc_manual_api',
      branch: 'develop',
      verification: { mode: 'railway_mcp', smoke_urls: [] }
    });
    const body = await response.json() as StagingMappingSaveResponse;
    const configYaml = readWorkspaceConfig(rootPath);

    assert.equal(response.status, 200);
    assert.equal(body.mapping.repo, 'api');
    assert.equal(body.mapping.staging.projectId, 'prj_manual_api');
    assert.equal(body.mapping.staging.environmentId, 'env_manual_staging');
    assert.equal(body.mapping.staging.serviceId, 'svc_manual_api');
    assert.equal(body.mapping.staging.branch, 'develop');
    assert.equal(body.mapping.staging.verification.mode, 'railway_mcp');
    assert.equal(body.config.parses, true);
    assert.deepEqual(body.config.issues, []);
    assert.equal(body.doctor.checks.some((check) => check.label === 'Deployment api' && check.status === 'pass'), true);

    assert.match(configYaml, /repos:\n\s+discovery: sibling-git-directories/u);
    assert.match(configYaml, /exclude:\n\s+- ignored-repo/u);
    assert.match(configYaml, /deployments:\n\s+worker:\n\s+staging:\n\s+provider: railway/u);
    assert.match(configYaml, /api:\n\s+staging:\n\s+provider: railway\n\s+project_id: prj_manual_api\n\s+environment_id: env_manual_staging\n\s+service_id: svc_manual_api\n\s+branch: develop/u);
    assert.match(configYaml, /verification:\n\s+mode: railway_mcp\n\s+smoke_urls: \[\]/u);
    assert.doesNotMatch(configYaml, /docs:\n\s+staging:/u);
    assert.doesNotMatch(configYaml, /repos:\n\s+- name:/u);
  } finally {
    await api.close();
  }
});

test('BG contract: API saves explicit repo-array staging mapping while preserving sibling deployment config', async () => {
  const rootPath = createWorkspace();
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1' });

  try {
    const response = await putStagingMapping(api.url, 'agentic/frontend', {
      provider: 'railway',
      project_id: 'prj_manual_frontend',
      environment_id: 'env_manual_staging',
      service_id: 'svc_manual_frontend',
      branch: 'develop',
      verification: { mode: 'railway_mcp', smoke_urls: [] }
    });
    const body = await response.json() as StagingMappingSaveResponse;
    const configYaml = readWorkspaceConfig(rootPath);

    assert.equal(response.status, 200);
    assert.equal(body.mapping.repo, 'agentic/frontend');
    assert.equal(body.mapping.staging.projectId, 'prj_manual_frontend');
    assert.equal(body.mapping.staging.environmentId, 'env_manual_staging');
    assert.equal(body.mapping.staging.serviceId, 'svc_manual_frontend');
    assert.match(configYaml, /deployments:\n\s+staging:\n\s+provider: railway\n\s+project_id: prj_manual_frontend/u);
    assert.match(configYaml, /production:\n\s+provider: railway\n\s+project_id: prj_production/u);
    assert.match(configYaml, /preview:\n\s+provider: railway\n\s+branch: feature-preview/u);
  } finally {
    await api.close();
  }
});

test('BG contract: API saves explicit github_only and none staging mappings without Railway IDs', async (t) => {
  const cases = [
    { repo: 'api', mode: 'github_only' },
    { repo: 'docs', mode: 'none' }
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.mode, async () => {
      const rootPath = createDiscoveryWorkspace();
      const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1' });

      try {
        const response = await putStagingMapping(api.url, scenario.repo, {
          provider: 'railway',
          branch: 'develop',
          verification: { mode: scenario.mode, smoke_urls: [] }
        });
        const body = await response.json() as StagingMappingSaveResponse;
        const configYaml = readWorkspaceConfig(rootPath);

        assert.equal(response.status, 200);
        assert.equal(body.mapping.repo, scenario.repo);
        assert.equal(body.mapping.staging.projectId, undefined);
        assert.equal(body.mapping.staging.environmentId, undefined);
        assert.equal(body.mapping.staging.serviceId, undefined);
        assert.equal(body.mapping.staging.verification.mode, scenario.mode);
        assert.equal(body.config.parses, true);
        assert.equal(body.doctor.checks.some((check) => check.label === `Deployment ${scenario.repo}` && check.status !== 'fail'), true);
        assert.match(configYaml, new RegExp(`${scenario.repo}:\\n\\s+staging:\\n\\s+provider: railway\\n\\s+branch: develop`, 'u'));
        assert.match(configYaml, new RegExp(`mode: ${scenario.mode}`, 'u'));
        assert.doesNotMatch(configYaml, new RegExp(`${scenario.repo}:[\\s\\S]*project_id:`, 'u'));
        assert.match(configYaml, /repos:\n\s+discovery: sibling-git-directories/u);
        assert.match(configYaml, /exclude:\n\s+- ignored-repo/u);
      } finally {
        await api.close();
      }
    });
  }
});

test('BG contract: dedicated staging mapping endpoint rejects unsupported and secret-like fields without writing them', async () => {
  const rootPath = createDiscoveryWorkspace();
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1' });

  try {
    const response = await putStagingMapping(api.url, 'api', {
      provider: 'railway',
      project_id: 'prj_manual_api',
      environment_id: 'env_manual_staging',
      service_id: 'svc_manual_api',
      branch: 'develop',
      verification: { mode: 'railway_mcp', smoke_urls: [] },
      railway_token: 'super-secret-token',
      service_url: 'https://api.example.test',
      variables: { SECRET_KEY: 'super-secret-value' }
    });
    const body = await response.json() as ErrorResponse;
    const configYaml = readWorkspaceConfig(rootPath);
    const bodyJson = JSON.stringify(body);

    assert.equal(response.status, 400);
    assert.match(`${body.error ?? ''} ${bodyJson}`, /unsupported|secret|railway_token|service_url|variables/iu);
    assert.doesNotMatch(configYaml, /railway_token|service_url|variables|super-secret-token|super-secret-value/u);
    assert.doesNotMatch(configYaml, /api:\n\s+staging:/u);
    assert.match(configYaml, /repos:\n\s+discovery: sibling-git-directories/u);
  } finally {
    await api.close();
  }
});

test('BG contract: post-save validation response includes doctor feedback usable by UI', async () => {
  const rootPath = createDiscoveryWorkspace();
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1' });

  try {
    const response = await putStagingMapping(api.url, 'api', {
      provider: 'railway',
      project_id: 'prj_manual_api',
      environment_id: 'env_manual_staging',
      branch: 'develop',
      verification: { mode: 'railway_mcp', smoke_urls: [] }
    });
    const body = await response.json() as StagingMappingSaveResponse | ErrorResponse;
    const bodyJson = JSON.stringify(body);

    assert.equal(response.status, 422);
    assert.match(bodyJson, /api/u);
    assert.match(bodyJson, /service_id/u);
    assert.match(bodyJson, /Deployment api/u);
    assert.match(bodyJson, /fail/u);
    assert.doesNotMatch(readWorkspaceConfig(rootPath), /api:\n\s+staging:/u);
  } finally {
    await api.close();
  }
});

test('BG contract: fake Railway discovery data enters only through backend injection seam, never live Railway CLI, MCP, Docker, OAuth, or provider APIs', async () => {
  const rootPath = createDiscoveryWorkspace();
  let discoveryCalls = 0;
  const railwayDiscoveryPort: RailwayDiscoveryPort = {
    discover: async () => {
      discoveryCalls += 1;
      return {
        projects: [{ id: 'prj_fake_api', name: 'Fake API Project' }],
        services: [{
          id: 'svc_fake_api',
          name: 'api',
          projectId: 'prj_fake_api',
          projectName: 'Fake API Project',
          environmentId: 'env_fake_staging',
          environmentName: 'staging',
          branch: 'develop'
        }]
      };
    }
  };
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1', railwayDiscoveryPort });

  try {
    const response = await fetch(`${api.url}/api/railway/discovery`);
    const body = await response.json() as {
      readonly available: boolean;
      readonly projects: readonly { readonly id: string; readonly name: string }[];
      readonly services: readonly {
        readonly id: string;
        readonly projectId?: string | undefined;
        readonly environmentId?: string | undefined;
        readonly branch?: string | undefined;
      }[];
    };
    const bodyJson = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(discoveryCalls, 1);
    assert.equal(body.available, true);
    assert.deepEqual(body.projects, [{ id: 'prj_fake_api', name: 'Fake API Project' }]);
    assert.equal(body.services[0]?.id, 'svc_fake_api');
    assert.equal(body.services[0]?.projectId, 'prj_fake_api');
    assert.equal(body.services[0]?.environmentId, 'env_fake_staging');
    assert.equal(body.services[0]?.branch, 'develop');
    assert.doesNotMatch(bodyJson, /list_projects|list_services|listVariables|variable|token|secret|docker|oauth/iu);
  } finally {
    await api.close();
  }
});

test('BG contract: Railway discovery API stays unavailable without an injected discovery port', async () => {
  const rootPath = createDiscoveryWorkspace();
  const api = await startInvocationControlApiServer({ workspaceRoot: rootPath, hostname: '127.0.0.1' });

  try {
    const response = await fetch(`${api.url}/api/railway/discovery`);
    const body = await response.json() as {
      readonly available: boolean;
      readonly projects: readonly unknown[];
      readonly services: readonly unknown[];
      readonly message?: string | undefined;
    };

    assert.equal(response.status, 200);
    assert.equal(body.available, false);
    assert.deepEqual(body.projects, []);
    assert.deepEqual(body.services, []);
    assert.match(body.message ?? '', /not configured/u);
  } finally {
    await api.close();
  }
});

function createWorkspace(): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-backend-'));
  mkdirSync(join(rootPath, '.ewokbot'), { recursive: true });
  mkdirSync(join(rootPath, 'frontend', '.git'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', '.env'), 'JIRA_TOKEN=super-secret\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), workspaceConfigYaml, 'utf8');
  return rootPath;
}

function createDiscoveryWorkspace(): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-backend-bg-'));
  mkdirSync(join(rootPath, '.ewokbot'), { recursive: true });
  mkdirSync(join(rootPath, 'api', '.git'), { recursive: true });
  mkdirSync(join(rootPath, 'docs', '.git'), { recursive: true });
  mkdirSync(join(rootPath, 'worker', '.git'), { recursive: true });
  mkdirSync(join(rootPath, 'ignored-repo', '.git'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', '.env'), 'JIRA_TOKEN=super-secret\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), discoveryWorkspaceConfigYaml, 'utf8');
  return rootPath;
}

function readWorkspaceConfig(rootPath: string): string {
  return readFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), 'utf8');
}

async function putStagingMapping(apiUrl: string, repoName: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${apiUrl}/api/repositories/${encodeURIComponent(repoName)}/deployments/staging`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function createRunState() {
  const timestamp = '2026-06-12T10:00:00.000Z';
  const initial = createDeliveryRunStateRecord({
    runId: 'ui-run',
    ticket: {
      provider: 'jira',
      key: 'AD-401',
      url: 'https://jira.example.test/browse/AD-401'
    },
    targetRepositories: [
      {
        provider: 'github',
        owner: 'agentic',
        name: 'frontend',
        defaultBranch: 'develop',
        url: 'https://github.com/agentic/frontend'
      }
    ],
    timestamps: { createdAt: timestamp, updatedAt: timestamp },
    ticketAnalysis: { ticketKey: 'AD-401', goal: 'UI summary', requirements: [], constraints: [], risks: [] }
  });

  return transitionDeliveryRunState(initial, 'NEEDS_HUMAN', timestamp);
}

const fakeTicket: DeliveryTicket = {
  ref: {
    provider: 'jira',
    key: 'AD-401',
    url: 'https://jira.example.test/browse/AD-401'
  },
  summary: 'Add UI status panel',
  description: 'Render local workspace state.',
  status: 'Ready',
  priority: 'medium',
  labels: ['bf'],
  createdAt: '2026-06-12T10:00:00.000Z',
  updatedAt: '2026-06-12T10:00:00.000Z'
};

const fakeTicketPort: TicketPort = {
  listBacklog: async () => [fakeTicket],
  searchByJql: async () => [fakeTicket],
  getTicket: async () => fakeTicket,
  comment: async () => {}
};

const workspaceConfigYaml = `
workspace:
  name: UI Workspace
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
  mcp_server: jira-mcp
github:
  mode: mock
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: node
  args: []
  timeout_ms: 1800000
  env_var_names:
    - OPENCODE_AUTH_TOKEN
  max_attempts: 1
mcp_policy:
  mode: read_only
  providers: {}
  servers: {}
  tools: {}
quality:
  default_profile: node
mcp_servers:
  jira-mcp:
    display_name: Jira MCP
    command: node
    args: []
    env_var_names:
      - JIRA_TOKEN
delivery:
  checks:
    no_remote_checks: pass
  pull_requests:
    develop:
      auto_merge: true
      merge_method: squash
      require_checks: pass
      require_human_approval: false
      draft_mode: never
      after_merge:
        verify_deployment: false
repos:
  - name: agentic/frontend
    url: https://github.com/agentic/frontend
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
        project_id: prj_ui
        environment_id: env_staging
        service_id: svc_frontend
        branch: develop
        verification:
          mode: none
          smoke_urls: []
      production:
        provider: railway
        project_id: prj_production
        environment_id: env_production
        service_id: svc_frontend_production
        branch: main
        verification:
          mode: none
          smoke_urls: []
      preview:
        provider: railway
        branch: feature-preview
        verification:
          mode: github_only
          smoke_urls:
            - https://preview.example.test/health
`;

const discoveryWorkspaceConfigYaml = `
workspace:
  name: BG Mapping Workspace
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - BG
github:
  mode: mock
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  provider: opencode
  command: node
  args: []
  timeout_ms: 1800000
  env_var_names: []
  max_attempts: 1
mcp_policy:
  mode: read_only
  providers: {}
  servers: {}
  tools: {}
quality:
  default_profile: node
delivery:
  checks:
    no_remote_checks: pass
  pull_requests:
    develop:
      auto_merge: false
      merge_method: squash
      require_checks: pass_or_absent
      require_human_approval: false
      draft_mode: never
      after_merge:
        verify_deployment: true
    main:
      auto_merge: false
      merge_method: squash
      require_checks: pass
      require_human_approval: true
      draft_mode: always
      after_merge:
        verify_deployment: false
repos:
  discovery: sibling-git-directories
  exclude:
    - ignored-repo
  deployments:
    worker:
      staging:
        provider: railway
        branch: develop
        verification:
          mode: none
          smoke_urls: []
`;
