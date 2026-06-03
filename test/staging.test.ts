import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  MarkdownReportWriter,
  MockRailwayConnector,
  MockSmokeUrlVerifier,
  assertProductionPullRequestReady,
  canPrepareProductionPullRequest,
  createDeliveryRunStateRecord,
  getRunDirectoryPath,
  recordStagingDeploying,
  recordStagingFailed,
  recordStagingVerified,
  renderStagingReportMarkdown,
  runStagingVerification,
  transitionDeliveryRunState,
  type DeliveryRunStateRecord,
  type DeploymentResult,
  type RepositoryConfig,
  type RepositoryRef,
  type RunStateStore,
  type TicketRef
} from '../src/index.js';

const ticket = {
  provider: 'jira',
  key: 'AD-123',
  url: 'https://jira.example.test/browse/AD-123'
} satisfies TicketRef;

const repositoryRef = {
  provider: 'github',
  owner: 'agentic',
  name: 'delivery-cli',
  defaultBranch: 'main',
  url: 'https://github.com/agentic/delivery-cli'
} satisfies RepositoryRef;

const repository = {
  ref: repositoryRef,
  role: 'application',
  localPath: '/workspace/delivery-cli',
  branchPolicy: {
    workingBranchPrefix: 'agent',
    stagingTarget: 'develop',
    productionTarget: 'main'
  },
  qualityGates: [],
  stagingSmokeUrls: ['/', '/health']
} satisfies RepositoryConfig;

test('MockRailwayConnector returns deterministic successful and failed staging deployment results', async () => {
  const success = await new MockRailwayConnector().waitForDeployment({
    repository: repositoryRef,
    branch: 'develop',
    commitSha: 'abc123',
    environment: 'staging'
  });
  const failure = await new MockRailwayConnector({ status: 'failed', summary: 'Mock deploy failed.' }).waitForDeployment({
    repository: repositoryRef,
    branch: 'develop',
    commitSha: 'abc123',
    environment: 'staging'
  });

  assert.equal(success.status, 'success');
  assert.equal(success.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.equal(success.serviceUrl, 'https://delivery-cli-staging.mock-railway.local');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.summary, 'Mock deploy failed.');
});

test('MockSmokeUrlVerifier returns deterministic passed, failed, and skipped checks without HTTP', async () => {
  const verifier = new MockSmokeUrlVerifier({
    failedUrls: ['/broken'],
    skippedUrls: ['/skip'],
    statusCodeByUrl: {
      '/broken': 503
    }
  });
  const checks = await verifier.verify({ serviceUrl: 'https://service.example.test', urls: ['/', '/broken', '/skip'] });

  assert.deepEqual(
    checks.map((check) => ({ url: check.url, status: check.status, statusCode: check.statusCode })),
    [
      { url: 'https://service.example.test/', status: 'passed', statusCode: 200 },
      { url: 'https://service.example.test/broken', status: 'failed', statusCode: 503 },
      { url: 'https://service.example.test/skip', status: 'skipped', statusCode: undefined }
    ]
  );
});

test('runStagingVerification writes STAGING_DEPLOYING then STAGING_VERIFIED on successful deploy and smoke checks', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway: new MockRailwayConnector(),
    smokeVerifier: new MockSmokeUrlVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(rootPath),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'STAGING_VERIFIED']);
  assert.equal(result.state, 'STAGING_VERIFIED');
  assert.equal(result.stagingDeployments.length, 1);
  assert.deepEqual(result.stagingDeployments[0]?.smokeChecks.map((check) => check.status), ['passed', 'passed']);
});

test('runStagingVerification records FAILED for failed deployment and never reaches STAGING_VERIFIED', async (t) => {
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway: new MockRailwayConnector({ status: 'failed' }),
    smokeVerifier: new MockSmokeUrlVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(await createTempRoot(t)),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'FAILED']);
  assert.equal(result.failure?.state, 'STAGING_DEPLOYING');
  assert.match(result.failure?.reason ?? '', /finished with status failed/u);
});

test('runStagingVerification records FAILED for failed smoke checks and never reaches STAGING_VERIFIED', async (t) => {
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway: new MockRailwayConnector(),
    smokeVerifier: new MockSmokeUrlVerifier({ failedUrls: ['/health'] }),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(await createTempRoot(t)),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'FAILED']);
  assert.equal(result.failure?.state, 'STAGING_DEPLOYING');
  assert.match(result.failure?.reason ?? '', /Staging smoke verification failed/u);
  assert.equal(result.stagingDeployments[0]?.smokeChecks[1]?.status, 'failed');
});

test('staging state helpers and production readiness guard enforce staging lifecycle', () => {
  const ready = createState('DEVELOP_CHECKS_PASSED');
  const deploying = recordStagingDeploying(ready, '2026-06-03T10:20:00.000Z');
  const deployment = createDeployment('success');
  const verified = recordStagingVerified(deploying, deployment, '2026-06-03T10:21:00.000Z');
  const failed = recordStagingFailed(deploying, createDeployment('failed'), 'Railway failed.', '2026-06-03T10:22:00.000Z');

  assert.throws(() => recordStagingDeploying(createState('LOCAL_CHECKS_PASSED'), '2026-06-03T10:20:00.000Z'), /DEVELOP_CHECKS_PASSED/u);
  assert.equal(canPrepareProductionPullRequest(ready), false);
  assert.equal(canPrepareProductionPullRequest(failed), false);
  assert.equal(canPrepareProductionPullRequest(verified), true);
  assert.throws(() => assertProductionPullRequestReady(failed), /STAGING_VERIFIED/u);
  assert.doesNotThrow(() => assertProductionPullRequestReady(verified));
});

test('MarkdownReportWriter writes deterministic staging report path and content', async (t) => {
  const rootPath = await createTempRoot(t);
  const writer = new MarkdownReportWriter(rootPath);
  const deployment = createDeployment('success');
  const relativePath = await writer.writeStaging(ticket.key, 'run-1', deployment);
  const body = await readFile(join(rootPath, relativePath), 'utf8');

  assert.equal(relativePath, join(getRunDirectoryPath(ticket.key, 'run-1'), 'staging-report.md'));
  assert.equal(body, renderStagingReportMarkdown(ticket.key, 'run-1', deployment));
  assert.match(body, /Branch: develop/u);
  assert.match(body, /Commit SHA: abc123/u);
  assert.match(body, /Service URL: https:\/\/delivery-cli-staging\.mock-railway\.local/u);
  assert.match(body, /https:\/\/delivery-cli-staging\.mock-railway\.local\/health: PASSED \(200\)/u);
  assert.match(body, /Failure Summary\n\n- None/u);
});

async function createTempRoot(t: TestContext): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'agentic-staging-'));

  t.after(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  return rootPath;
}

function createState(state: DeliveryRunStateRecord['state']): DeliveryRunStateRecord {
  const initial = createDeliveryRunStateRecord({
    runId: 'run-1',
    ticket,
    targetRepositories: [repositoryRef],
    timestamps: {
      createdAt: '2026-06-03T10:00:00.000Z',
      updatedAt: '2026-06-03T10:00:00.000Z'
    }
  });

  return transitionDeliveryRunState(initial, state, '2026-06-03T10:00:00.000Z');
}

function createDeployment(status: DeploymentResult['status']): DeploymentResult {
  return {
    ref: {
      provider: 'railway',
      projectId: 'mock-project-agentic',
      serviceId: 'mock-service-delivery-cli',
      deploymentId: 'mock-agentic-delivery-cli-staging-develop-abc123',
      environment: 'staging'
    },
    status,
    branch: 'develop',
    commitSha: 'abc123',
    serviceUrl: 'https://delivery-cli-staging.mock-railway.local',
    smokeChecks: [
      {
        url: 'https://delivery-cli-staging.mock-railway.local/health',
        status: status === 'success' ? 'passed' : 'failed',
        statusCode: status === 'success' ? 200 : 500,
        summary: status === 'success' ? 'Mock smoke check passed for /health.' : 'Mock smoke check failed for /health.'
      }
    ],
    startedAt: '2026-06-03T10:30:00.000Z',
    finishedAt: '2026-06-03T10:31:00.000Z',
    summary: `Mock Railway deployment ${status} for agentic/delivery-cli on develop.`
  };
}

function fixedClock(): () => Date {
  let offset = 0;
  const base = Date.parse('2026-06-03T10:20:00.000Z');

  return () => {
    const current = new Date(base + offset);
    offset += 1000;
    return current;
  };
}

class MemoryRunStateStore implements RunStateStore {
  readonly writes: DeliveryRunStateRecord[] = [];

  async read(): Promise<DeliveryRunStateRecord> {
    const latest = this.writes[this.writes.length - 1];

    if (latest === undefined) {
      throw new Error('No state has been written.');
    }

    return latest;
  }

  async write(state: DeliveryRunStateRecord): Promise<void> {
    this.writes.push(state);
  }
}
