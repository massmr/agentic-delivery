import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GitHubMcpCodeHostPort,
  defaultGitHubMcpToolNames,
  McpToolNotFoundError,
  MockMcpClient,
  createMockMcpTool,
  type McpToolCallAuditRecord
} from '../src/index.js';

const serverId = 'github';
const repository = {
  provider: 'github',
  owner: 'agentic',
  name: 'frontend',
  defaultBranch: 'develop',
  url: 'https://github.com/agentic/frontend'
} as const;

const branch = {
  repository,
  name: 'agent/LK-123',
  baseBranch: 'develop'
} as const;

const customTools = {
  createBranch: 'github.createBranch',
  openPullRequest: 'github.openPullRequest',
  getChecks: 'github.getChecks',
  commentOnPullRequest: 'github.commentOnPullRequest'
} as const;

test('GitHub MCP CodeHostPort uses default tool names for branch creation and PR opening', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.createBranch, (input) => {
      const branchArguments = input.arguments as { readonly branch: { readonly name: string; readonly baseBranch: string } };

      return {
        content: { branch: { name: branchArguments.branch.name, baseBranch: branchArguments.branch.baseBranch, headSha: 'sha-create' } },
        isError: false
      };
    }),
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.openPullRequest, (input) => {
      const pullRequestArguments = input.arguments as {
        readonly title: string;
        readonly sourceBranch: string;
        readonly targetBranch: 'develop' | 'main';
      };

      return {
        content: {
          pullRequest: {
            number: 77,
            title: pullRequestArguments.title,
            sourceBranch: pullRequestArguments.sourceBranch,
            targetBranch: pullRequestArguments.targetBranch,
            url: 'https://github.com/agentic/frontend/pull/77',
            status: 'open'
          }
        },
        isError: false
      };
    }),
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId, auditSink: (records) => auditRecords.push(...records) });

  const createdBranch = await port.createBranch({ repository, branch });
  const pullRequest = await port.openPullRequest({
    repository,
    title: 'LK-123 Add GitHub MCP adapter',
    body: 'Body',
    sourceBranch: createdBranch.name,
    targetBranch: 'develop'
  });

  assert.deepEqual(createdBranch, { repository, name: branch.name, baseBranch: branch.baseBranch, headSha: 'sha-create' });
  assert.equal(pullRequest.number, 77);
  assert.equal(pullRequest.url, 'https://github.com/agentic/frontend/pull/77');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultGitHubMcpToolNames.createBranch,
    defaultGitHubMcpToolNames.openPullRequest
  ]);
  assert.deepEqual(client.toolCallRequests[0]?.arguments, { repository, branch });
  assert.deepEqual(client.toolCallRequests[1]?.arguments, {
    repository,
    title: 'LK-123 Add GitHub MCP adapter',
    body: 'Body',
    sourceBranch: createdBranch.name,
    targetBranch: 'develop'
  });
  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'createBranch:started',
    'createBranch:succeeded',
    'openPullRequest:started',
    'openPullRequest:succeeded',
  ]);
});

test('GitHub MCP CodeHostPort keeps custom tool names for checks and comments', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, customTools.createBranch, (input) => {
      const branchArguments = input.arguments as { readonly branch: { readonly name: string; readonly baseBranch: string } };

      return {
        content: { branch: { name: branchArguments.branch.name, baseBranch: branchArguments.branch.baseBranch, headSha: 'sha-create' } },
        isError: false
      };
    }),
    createMockMcpTool(serverId, customTools.openPullRequest, (input) => {
      const pullRequestArguments = input.arguments as {
        readonly title: string;
        readonly sourceBranch: string;
        readonly targetBranch: 'develop' | 'main';
      };

      return {
        content: {
          pullRequest: {
            number: 77,
            title: pullRequestArguments.title,
            sourceBranch: pullRequestArguments.sourceBranch,
            targetBranch: pullRequestArguments.targetBranch,
            url: 'https://github.com/agentic/frontend/pull/77',
            status: 'open'
          }
        },
        isError: false
      };
    }),
    createMockMcpTool(serverId, customTools.getChecks, () => ({
      content: {
        checks: {
          status: 'passed',
          totalCount: 3,
          passedCount: 2,
          failedCount: 0,
          pendingCount: 1
        }
      },
      isError: false
    })),
    createMockMcpTool(serverId, customTools.commentOnPullRequest, (input) => {
      const commentArguments = input.arguments as { readonly pullRequest: { readonly number: number } };

      return {
        content: { ok: true, number: commentArguments.pullRequest.number },
        isError: false
      };
    })
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId, toolNames: customTools, auditSink: (records) => auditRecords.push(...records) });

  const createdBranch = await port.createBranch({ repository, branch });
  const pullRequest = await port.openPullRequest({
    repository,
    title: 'LK-123 Add GitHub MCP adapter',
    body: 'Body',
    sourceBranch: createdBranch.name,
    targetBranch: 'develop'
  });
  const checks = await port.getChecks({ repository, branchName: createdBranch.name });
  await port.commentOnPullRequest({ pullRequest, body: 'Looks good to me.' });

  assert.deepEqual(createdBranch, { repository, name: branch.name, baseBranch: branch.baseBranch, headSha: 'sha-create' });
  assert.equal(pullRequest.number, 77);
  assert.deepEqual(checks, {
    status: 'passed',
    totalCount: 3,
    passedCount: 2,
    failedCount: 0,
    pendingCount: 1
  });
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    customTools.createBranch,
    customTools.openPullRequest,
    customTools.getChecks,
    customTools.commentOnPullRequest
  ]);
  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'createBranch:started',
    'createBranch:succeeded',
    'openPullRequest:started',
    'openPullRequest:succeeded',
    'getChecks:started',
    'getChecks:succeeded',
    'commentOnPullRequest:started',
    'commentOnPullRequest:succeeded'
  ]);
});

test('GitHub MCP CodeHostPort pushBranch fails fast and keeps local git fallback explicit', async () => {
  const client = new MockMcpClient([]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  await assert.rejects(() => port.pushBranch({ repository, branch }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'GitHubMcpPushBranchUnsupportedError');
    assert.match(error.message, /pushBranch is not supported/i);
    assert.match(error.message, /native\/local git fallback/i);
    return true;
  });
  assert.equal(client.toolCallRequests.length, 0);
});

test('GitHub MCP CodeHostPort missing tools fail with actionable MCP tool errors', async () => {
  const port = new GitHubMcpCodeHostPort({
    client: new MockMcpClient([createMockMcpTool(serverId, customTools.createBranch, () => ({ content: { branch }, isError: false }))]),
    serverId,
    toolNames: customTools
  });

  await assert.rejects(() => port.getChecks({ repository, branchName: branch.name }), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.serverId, serverId);
    assert.equal(error.toolName, customTools.getChecks);
    assert.match(error.message, /Configure or allow the MCP server tool before retrying/u);
    return true;
  });
});
