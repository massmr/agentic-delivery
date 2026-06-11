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
  type DeploymentPort,
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
  stagingSmokeUrls: ['/', '/health'],
  stagingDeployment: {
    provider: 'railway',
    projectId: 'mock-project-agentic',
    environmentId: 'mock-environment-staging',
    serviceId: 'mock-service-delivery-cli',
    branch: 'develop',
    verification: {
      mode: 'railway_mcp',
      smokeUrls: ['/', '/health']
    }
  }
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

test('runStagingVerification fails when repository deployment mapping is missing', async (t) => {
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository: { ...repository, stagingDeployment: undefined },
    branch: 'develop',
    commitSha: 'abc123',
    railway: new ThrowingRailwayConnector('Railway should not be called.'),
    smokeVerifier: new FailIfCalledSmokeVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(await createTempRoot(t)),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'FAILED']);
  assert.equal(result.state, 'FAILED');
  assert.match(result.failure?.reason ?? '', /No staging deployment mapping is configured/u);
});

test('runStagingVerification verifies http_smoke mappings without Railway polling', async (t) => {
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository: {
      ...repository,
      stagingDeployment: {
        provider: 'railway',
        branch: 'develop',
        verification: {
          mode: 'http_smoke',
          smokeUrls: ['https://frontend.example.test/health']
        }
      }
    },
    branch: 'develop',
    commitSha: 'abc123',
    railway: new ThrowingRailwayConnector('Railway should not be called.'),
    smokeVerifier: new MockSmokeUrlVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(await createTempRoot(t)),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'STAGING_VERIFIED']);
  assert.equal(result.stagingDeployments[0]?.smokeChecks[0]?.url, 'https://frontend.example.test/health');
  assert.equal(result.stagingDeployments[0]?.mapping?.verification.mode, 'http_smoke');
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

test('runStagingVerification persists FAILED and a report when Railway polling fails', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway: new ThrowingRailwayConnector('Railway deployment polling timed out.'),
    smokeVerifier: new FailIfCalledSmokeVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(rootPath),
    now: fixedClock()
  });
  const report = await readFile(join(rootPath, getRunDirectoryPath(ticket.key, result.runId), 'staging-report.md'), 'utf8');

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'FAILED']);
  assert.match(result.failure?.reason ?? '', /Railway deployment polling timed out/u);
  assert.equal(result.stagingDeployments[0]?.status, 'failed');
  assert.equal(result.stagingDeployments[0]?.serviceUrl, 'unavailable');
  assert.match(report, /Railway deployment polling timed out/u);
});

test('runStagingVerification persists FAILED without smoke checks when service URL is missing', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new MemoryRunStateStore();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway: new MissingServiceUrlRailwayConnector(),
    smokeVerifier: new FailIfCalledSmokeVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(rootPath),
    now: fixedClock()
  });
  const report = await readFile(join(rootPath, getRunDirectoryPath(ticket.key, result.runId), 'staging-report.md'), 'utf8');

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'FAILED']);
  assert.match(result.failure?.reason ?? '', /service URL/i);
  assert.equal(result.stagingDeployments[0]?.smokeChecks.length, 0);
  assert.match(report, /Failure Summary/u);
  assert.match(report, /service URL/i);
});

test('runStagingVerification preserves failed Railway deployment evidence without resolving service URL', async (t) => {
  const rootPath = await createTempRoot(t);
  const store = new MemoryRunStateStore();
  const railway = new FailedWithoutServiceUrlRailwayConnector();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway,
    smokeVerifier: new FailIfCalledSmokeVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(rootPath),
    now: fixedClock()
  });
  const deployment = result.stagingDeployments[0];
  const report = await readFile(join(rootPath, getRunDirectoryPath(ticket.key, result.runId), 'staging-report.md'), 'utf8');

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'FAILED']);
  assert.equal(railway.getServiceUrlCalls, 0);
  assert.equal(deployment?.status, 'failed');
  assert.equal(deployment?.ref.deploymentId, 'mock-agentic-delivery-cli-staging-develop-abc123');
  assert.equal(deployment?.branch, 'develop');
  assert.equal(deployment?.commitSha, 'abc123');
  assert.equal(deployment?.serviceUrl, 'unavailable');
  assert.match(result.failure?.reason ?? '', /finished with status failed/u);
  assert.match(report, /Mock Railway deployment failed/u);
});

test('runStagingVerification verifies successful deployment whose service URL is returned separately', async (t) => {
  const store = new MemoryRunStateStore();
  const railway = new SuccessWithoutServiceUrlRailwayConnector();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository,
    branch: 'develop',
    commitSha: 'abc123',
    railway,
    smokeVerifier: new MockSmokeUrlVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(await createTempRoot(t)),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'STAGING_VERIFIED']);
  assert.equal(railway.getServiceUrlCalls, 1);
  assert.equal(result.state, 'STAGING_VERIFIED');
  assert.equal(result.stagingDeployments[0]?.serviceUrl, 'https://delivery-cli-staging.mock-railway.local');
  assert.deepEqual(result.stagingDeployments[0]?.smokeChecks.map((check) => check.status), ['passed', 'passed']);
});

test('runStagingVerification accepts successful Railway MCP deployment without service URL when no smoke URLs are configured', async (t) => {
  const store = new MemoryRunStateStore();
  const railway = new SuccessWithoutServiceUrlRailwayConnector();
  const result = await runStagingVerification({
    state: createState('DEVELOP_CHECKS_PASSED'),
    repository: {
      ...repository,
      stagingDeployment: {
        ...repository.stagingDeployment,
        verification: {
          mode: 'railway_mcp',
          smokeUrls: []
        }
      }
    },
    branch: 'develop',
    commitSha: 'abc123',
    railway,
    smokeVerifier: new FailIfCalledSmokeVerifier(),
    stateStore: store,
    reportWriter: new MarkdownReportWriter(await createTempRoot(t)),
    now: fixedClock()
  });

  assert.deepEqual(store.writes.map((write) => write.state), ['STAGING_DEPLOYING', 'STAGING_VERIFIED']);
  assert.equal(railway.getServiceUrlCalls, 0);
  assert.equal(result.state, 'STAGING_VERIFIED');
  assert.equal(result.stagingDeployments[0]?.serviceUrl, 'unavailable');
  assert.deepEqual(result.stagingDeployments[0]?.smokeChecks, []);
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
  assert.match(body, /Project ID: mock-project-agentic/u);
  assert.match(body, /Environment ID: mock-environment-staging/u);
  assert.match(body, /Service ID: mock-service-delivery-cli/u);
  assert.match(body, /Verification Mode: railway_mcp/u);
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
      environmentId: 'mock-environment-staging',
      serviceId: 'mock-service-delivery-cli',
      deploymentId: 'mock-agentic-delivery-cli-staging-develop-abc123',
      environment: 'staging'
    },
    mapping: {
      provider: 'railway',
      projectId: 'mock-project-agentic',
      environmentId: 'mock-environment-staging',
      serviceId: 'mock-service-delivery-cli',
      branch: 'develop',
      verification: {
        mode: 'railway_mcp',
        smokeUrls: ['/health']
      }
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

class ThrowingRailwayConnector implements DeploymentPort {
  private readonly message: string;

  constructor(message: string) {
    this.message = message;
  }

  async waitForDeployment(): Promise<DeploymentResult> {
    throw new Error(this.message);
  }

  async readDeployment(): Promise<DeploymentResult> {
    throw new Error('readDeployment should not be called.');
  }

  async getServiceUrl(): Promise<string> {
    throw new Error('getServiceUrl should not be called.');
  }
}

class MissingServiceUrlRailwayConnector implements DeploymentPort {
  async waitForDeployment(): Promise<DeploymentResult> {
    return createDeployment('success');
  }

  async readDeployment(): Promise<DeploymentResult> {
    return createDeployment('success');
  }

  async getServiceUrl(): Promise<string> {
    throw new Error('Railway staging deployment service URL is missing.');
  }
}

class FailedWithoutServiceUrlRailwayConnector implements DeploymentPort {
  getServiceUrlCalls = 0;

  async waitForDeployment(): Promise<DeploymentResult> {
    return createDeploymentWithoutServiceUrl('failed');
  }

  async readDeployment(): Promise<DeploymentResult> {
    return createDeploymentWithoutServiceUrl('failed');
  }

  async getServiceUrl(): Promise<string> {
    this.getServiceUrlCalls += 1;
    throw new Error('getServiceUrl should not be called for failed Railway deployments.');
  }
}

class SuccessWithoutServiceUrlRailwayConnector implements DeploymentPort {
  getServiceUrlCalls = 0;

  async waitForDeployment(): Promise<DeploymentResult> {
    return createDeploymentWithoutServiceUrl('success');
  }

  async readDeployment(): Promise<DeploymentResult> {
    return createDeploymentWithoutServiceUrl('success');
  }

  async getServiceUrl(): Promise<string> {
    this.getServiceUrlCalls += 1;
    return 'https://delivery-cli-staging.mock-railway.local';
  }
}

class FailIfCalledSmokeVerifier {
  async verify(): Promise<never> {
    throw new Error('Smoke verifier should not run when staging service URL is unavailable.');
  }
}

function createDeploymentWithoutServiceUrl(status: DeploymentResult['status']): DeploymentResult {
  const deployment = createDeployment(status);
  return {
    ref: deployment.ref,
    status: deployment.status,
    branch: deployment.branch,
    commitSha: deployment.commitSha,
    smokeChecks: deployment.smokeChecks,
    startedAt: deployment.startedAt,
    finishedAt: deployment.finishedAt,
    summary: deployment.summary
  } as unknown as DeploymentResult;
}
