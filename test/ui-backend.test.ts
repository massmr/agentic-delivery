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
  type TicketPort
} from '../src/index.js';

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

function createWorkspace(): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'agentic-ui-backend-'));
  mkdirSync(join(rootPath, '.ewokbot'), { recursive: true });
  mkdirSync(join(rootPath, 'frontend', '.git'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', '.env'), 'JIRA_TOKEN=super-secret\n', 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), workspaceConfigYaml, 'utf8');
  return rootPath;
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
`;
