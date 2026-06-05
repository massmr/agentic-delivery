import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deliveryRunStates,
  type DeliveryRunStateRecord,
  type DeliveryTicket,
  type DeploymentResult,
  type PullRequestRef,
  type QualityReport,
  type RepositoryConfig
} from '../src/index.js';

const ticket = {
  ref: {
    provider: 'jira',
    key: 'AD-123',
    url: 'https://jira.example.test/browse/AD-123'
  },
  summary: 'Add shared delivery models',
  description: 'Create strict public TypeScript types for Milestone B.',
  status: 'To Do',
  priority: 'high',
  labels: ['milestone-b', 'domain'],
  assignee: 'agentic-delivery',
  reporter: 'founder',
  createdAt: '2026-06-03T10:00:00.000Z',
  updatedAt: '2026-06-03T10:30:00.000Z'
} satisfies DeliveryTicket;

const repository = {
  ref: {
    provider: 'github',
    owner: 'agentic',
    name: 'web-app',
    defaultBranch: 'main',
    url: 'https://github.com/agentic/web-app'
  },
  role: 'application',
  localPath: '/workspace/web-app',
  branchPolicy: {
    workingBranchPrefix: 'agent',
    stagingTarget: 'develop',
    productionTarget: 'main'
  },
  qualityGates: [
    {
      name: 'typecheck',
      command: 'pnpm typecheck',
      requirement: 'required',
      workingDirectory: '/workspace/web-app'
    }
  ],
  stagingSmokeUrls: ['/health']
} satisfies RepositoryConfig;

const qualityReport = {
  status: 'passed',
  required: [
    {
      name: 'typecheck',
      command: 'pnpm typecheck',
      workingDirectory: '/workspace/web-app',
      startedAt: '2026-06-03T10:31:00.000Z',
      finishedAt: '2026-06-03T10:31:05.000Z',
      durationMs: 5000,
      exitCode: 0,
      stdoutLogPath: '.ewokbot/runs/AD-123/run-1/typecheck.stdout.log',
      stderrLogPath: '.ewokbot/runs/AD-123/run-1/typecheck.stderr.log',
      status: 'passed',
      summary: 'TypeScript compiled successfully.'
    }
  ],
  optional: []
} satisfies QualityReport;

const stagingPullRequest = {
  provider: 'github',
  repositoryOwner: 'agentic',
  repositoryName: 'web-app',
  number: 42,
  title: 'AD-123 Add shared delivery models',
  sourceBranch: 'agent/AD-123-shared-delivery-models',
  targetBranch: 'develop',
  url: 'https://github.com/agentic/web-app/pull/42',
  status: 'open'
} satisfies PullRequestRef;

const deployment = {
  ref: {
    provider: 'railway',
    projectId: 'project_123',
    serviceId: 'service_123',
    deploymentId: 'deployment_123',
    environment: 'staging'
  },
  status: 'success',
  branch: 'develop',
  commitSha: 'abc123',
  serviceUrl: 'https://web-app-staging.example.test',
  smokeChecks: [
    {
      url: 'https://web-app-staging.example.test/health',
      status: 'passed',
      statusCode: 200,
      summary: 'Health check returned OK.'
    }
  ],
  startedAt: '2026-06-03T10:40:00.000Z',
  finishedAt: '2026-06-03T10:42:00.000Z',
  summary: 'Staging deployment verified.'
} satisfies DeploymentResult;

const deliveryRun = {
  runId: 'run-1',
  ticket: ticket.ref,
  state: 'STAGING_VERIFIED',
  targetRepositories: [repository.ref],
  branches: [
    {
      repository: repository.ref,
      name: 'agent/AD-123-shared-delivery-models',
      baseBranch: 'develop',
      headSha: 'abc123'
    }
  ],
  pullRequests: [stagingPullRequest],
  stagingDeployments: [deployment],
  qualityReports: [qualityReport],
  devRuns: [],
  timestamps: {
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:42:00.000Z'
  },
  ticketAnalysis: {
    ticketKey: 'AD-123',
    goal: 'Publish domain models.',
    requirements: ['Expose shared TypeScript interfaces.'],
    constraints: ['Do not add provider implementations.'],
    risks: []
  }
} satisfies DeliveryRunStateRecord;

test('domain model types accept representative Milestone B objects', () => {
  assert.equal(ticket.ref.key, deliveryRun.ticket.key);
  assert.equal(repository.qualityGates[0]?.name, qualityReport.required[0]?.name);
  assert.equal(deliveryRun.pullRequests[0]?.targetBranch, 'develop');
  assert.equal(deliveryRun.stagingDeployments[0]?.status, 'success');
});

test('delivery run states include the product-spec lifecycle states', () => {
  assert.deepEqual(deliveryRunStates, [
    'DISCOVERED',
    'PLANNED',
    'BRANCH_CREATED',
    'IMPLEMENTING',
    'LOCAL_CHECKS_RUNNING',
    'LOCAL_CHECKS_PASSED',
    'PUSHED',
    'PR_TO_DEVELOP_OPENED',
    'DEVELOP_CHECKS_PASSED',
    'STAGING_DEPLOYING',
    'STAGING_VERIFIED',
    'PRODUCTION_PR_OPENED',
    'DONE',
    'NEEDS_HUMAN',
    'FAILED',
    'SKIPPED'
  ]);
});
