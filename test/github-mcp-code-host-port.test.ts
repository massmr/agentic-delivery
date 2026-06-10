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
  listBranches: 'github.listBranches',
  createBranch: 'github.createBranch',
  listPullRequests: 'github.listPullRequests',
  openPullRequest: 'github.createPullRequest',
  getChecks: 'github.pullRequestRead',
  commentOnPullRequest: 'github.addIssueComment',
  mergePullRequest: 'github.mergePullRequest'
} as const;

test('GitHub MCP CodeHostPort maps inspected default tools for branch creation and draft PR opening', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.listBranches, (input) => {
      assert.deepEqual(input.arguments, { owner: repository.owner, repo: repository.name });
      return { content: { branches: [] }, isError: false };
    }),
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.createBranch, (input) => {
      assert.deepEqual(input.arguments, {
        owner: repository.owner,
        repo: repository.name,
        branch: branch.name,
        from_branch: branch.baseBranch
      });
      return { content: { ref: `refs/heads/${branch.name}`, commit: { sha: 'sha-create' } }, isError: false };
    }),
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.openPullRequest, (input) => {
      assert.deepEqual(input.arguments, {
        owner: repository.owner,
        repo: repository.name,
        title: 'LK-123 Add GitHub MCP adapter',
        body: 'Body',
        head: branch.name,
        base: 'develop',
        draft: true
      });
      return {
        content: {
          number: 77,
          title: 'LK-123 Add GitHub MCP adapter',
          head: { ref: `refs/heads/${branch.name}` },
          base: { ref: 'develop' },
          html_url: 'https://github.com/agentic/frontend/pull/77',
          state: 'open'
        },
        isError: false
      };
    })
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
  assert.equal(pullRequest.sourceBranch, branch.name);
  assert.equal(pullRequest.url, 'https://github.com/agentic/frontend/pull/77');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultGitHubMcpToolNames.listBranches,
    defaultGitHubMcpToolNames.createBranch,
    defaultGitHubMcpToolNames.openPullRequest
  ]);
  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'createBranch:started',
    'createBranch:succeeded',
    'createBranch:started',
    'createBranch:succeeded',
    'openPullRequest:started',
    'openPullRequest:succeeded'
  ]);
});

test('GitHub MCP CodeHostPort skips remote branch creation when list_branches finds the branch', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.listBranches, () => ({
      content: { branches: [{ name: branch.name, commit: { sha: 'sha-existing' } }] },
      isError: false
    })),
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.createBranch, () => {
      throw new Error('create_branch must not run for an existing branch');
    })
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const createdBranch = await port.createBranch({ repository, branch });

  assert.deepEqual(createdBranch, { repository, name: branch.name, baseBranch: branch.baseBranch, headSha: 'sha-existing' });
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultGitHubMcpToolNames.listBranches]);
});

test('GitHub MCP CodeHostPort parses MCP content-array PR creation responses', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.openPullRequest, () => ({
      content: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              pull_request: {
                id: 3832207447,
                html_url: 'https://github.com/agentic/frontend/pull/88',
                title: 'LK-123 Add GitHub MCP adapter',
                head: { ref: `refs/heads/${branch.name}` },
                base: { ref: 'develop' },
                state: 'open'
              }
            })
          }
        ]
      },
      isError: false
    }))
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const pullRequest = await port.openPullRequest({
    repository,
    title: 'LK-123 Add GitHub MCP adapter',
    body: 'Body',
    sourceBranch: branch.name,
    targetBranch: 'develop'
  });

  assert.equal(pullRequest.number, 88);
  assert.equal(pullRequest.url, 'https://github.com/agentic/frontend/pull/88');
  assert.equal(pullRequest.sourceBranch, branch.name);
  assert.equal(pullRequest.targetBranch, 'develop');
});

test('GitHub MCP CodeHostPort resolves checks through list_pull_requests and pull_request_read', async () => {
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.listPullRequests, (input) => {
      assert.deepEqual(input.arguments, {
        owner: repository.owner,
        repo: repository.name,
        head: `${repository.owner}:${branch.name}`,
        state: 'all'
      });
      return { content: { pull_requests: [{ number: 77, head: { ref: branch.name } }] }, isError: false };
    }),
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.getChecks, (input) => {
      assert.deepEqual(input.arguments, {
        method: 'get_check_runs',
        owner: repository.owner,
        repo: repository.name,
        pullNumber: 77
      });
      return {
        content: {
          total_count: 3,
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
            { status: 'in_progress', conclusion: null }
          ]
        },
        isError: false
      };
    })
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const checks = await port.getChecks({ repository, branchName: branch.name });

  assert.deepEqual(checks, {
    status: 'failed',
    totalCount: 3,
    passedCount: 1,
    failedCount: 1,
    pendingCount: 1
  });
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    defaultGitHubMcpToolNames.listPullRequests,
    defaultGitHubMcpToolNames.getChecks
  ]);
});

test('GitHub MCP CodeHostPort resolves checks for the provided pull request number without branch lookup', async () => {
  const pullRequest = {
    provider: 'github',
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    number: 88,
    title: 'LK-123 Add GitHub MCP adapter',
    sourceBranch: branch.name,
    targetBranch: 'develop',
    url: 'https://github.com/agentic/frontend/pull/88',
    status: 'open'
  } as const;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.listPullRequests, () => {
      throw new Error('list_pull_requests must not run when the pull request number is already known');
    }),
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.getChecks, (input) => {
      assert.deepEqual(input.arguments, {
        method: 'get_check_runs',
        owner: repository.owner,
        repo: repository.name,
        pullNumber: 88
      });
      return { content: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] }, isError: false };
    })
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const checks = await port.getChecks({ repository, branchName: branch.name, pullRequest });

  assert.deepEqual(checks, { status: 'passed', totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 });
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultGitHubMcpToolNames.getChecks]);
});

test('GitHub MCP CodeHostPort keeps custom inspected tool names for checks and comments', async () => {
  const auditRecords: McpToolCallAuditRecord[] = [];
  const client = new MockMcpClient([
    createMockMcpTool(serverId, customTools.listBranches, () => ({ content: [], isError: false })),
    createMockMcpTool(serverId, customTools.createBranch, () => ({ content: { name: branch.name, commit: { sha: 'sha-create' } }, isError: false })),
    createMockMcpTool(serverId, customTools.openPullRequest, () => ({
      content: { number: 77, title: 'LK-123 Add GitHub MCP adapter', head: { ref: branch.name }, base: { ref: 'develop' }, html_url: 'https://github.com/agentic/frontend/pull/77', state: 'open' },
      isError: false
    })),
    createMockMcpTool(serverId, customTools.listPullRequests, () => ({ content: [{ number: 77, head: { ref: branch.name } }], isError: false })),
    createMockMcpTool(serverId, customTools.getChecks, () => ({
      content: { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] },
      isError: false
    })),
    createMockMcpTool(serverId, customTools.commentOnPullRequest, (input) => {
      assert.deepEqual(input.arguments, {
        owner: repository.owner,
        repo: repository.name,
        issue_number: 77,
        body: 'Looks good to me.'
      });
      return { content: { ok: true }, isError: false };
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
    status: 'pending',
    totalCount: 2,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 1
  });
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [
    customTools.listBranches,
    customTools.createBranch,
    customTools.openPullRequest,
    customTools.listPullRequests,
    customTools.getChecks,
    customTools.commentOnPullRequest
  ]);
  assert.deepEqual(auditRecords.map((record) => `${record.action}:${record.status}`), [
    'createBranch:started',
    'createBranch:succeeded',
    'createBranch:started',
    'createBranch:succeeded',
    'openPullRequest:started',
    'openPullRequest:succeeded',
    'getChecks:started',
    'getChecks:succeeded',
    'getChecks:started',
    'getChecks:succeeded',
    'commentOnPullRequest:started',
    'commentOnPullRequest:succeeded'
  ]);
});

test('GitHub MCP CodeHostPort reads pull request state through pull_request_read method get', async () => {
  const pullRequest = {
    provider: 'github',
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    number: 77,
    title: 'LK-123 Add GitHub MCP adapter',
    sourceBranch: branch.name,
    targetBranch: 'develop',
    url: 'https://github.com/agentic/frontend/pull/77',
    status: 'open'
  } as const;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.getChecks, (input) => {
      assert.deepEqual(input.arguments, {
        method: 'get',
        owner: repository.owner,
        repo: repository.name,
        pullNumber: 77
      });
      return {
        content: { number: 77, title: pullRequest.title, head: { ref: branch.name }, base: { ref: 'develop' }, html_url: pullRequest.url, state: 'merged' },
        isError: false
      };
    })
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const readPullRequest = await port.readPullRequest({ pullRequest });

  assert.equal(readPullRequest.status, 'merged');
  assert.equal(readPullRequest.number, 77);
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultGitHubMcpToolNames.getChecks]);
});

test('GitHub MCP CodeHostPort treats GitHub draft pull requests as draft status', async () => {
  const pullRequest = {
    provider: 'github',
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    number: 77,
    title: 'LK-123 Add GitHub MCP adapter',
    sourceBranch: branch.name,
    targetBranch: 'develop',
    url: 'https://github.com/agentic/frontend/pull/77',
    status: 'open'
  } as const;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.getChecks, () => ({
      content: { number: 77, title: pullRequest.title, head: { ref: branch.name }, base: { ref: 'develop' }, html_url: pullRequest.url, state: 'open', draft: true },
      isError: false
    }))
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const readPullRequest = await port.readPullRequest({ pullRequest });

  assert.equal(readPullRequest.status, 'draft');
});

test('GitHub MCP CodeHostPort merges develop pull requests through typed merge tool only', async () => {
  const pullRequest = {
    provider: 'github',
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    number: 77,
    title: 'LK-123 Add GitHub MCP adapter',
    sourceBranch: branch.name,
    targetBranch: 'develop',
    url: 'https://github.com/agentic/frontend/pull/77',
    status: 'open'
  } as const;
  const client = new MockMcpClient([
    createMockMcpTool(serverId, defaultGitHubMcpToolNames.mergePullRequest, (input) => {
      assert.deepEqual(input.arguments, {
        owner: repository.owner,
        repo: repository.name,
        pullNumber: 77,
        merge_method: 'squash'
      });
      return {
        content: { pull_request: { number: 77, title: pullRequest.title, head: { ref: branch.name }, base: { ref: 'develop' }, html_url: pullRequest.url, state: 'merged' }, merge_commit_sha: 'merge-sha', merged_at: '2026-06-03T10:00:00.000Z' },
        isError: false
      };
    })
  ]);
  const port = new GitHubMcpCodeHostPort({ client, serverId });

  const result = await port.mergePullRequest({ pullRequest, method: 'squash' });

  assert.equal(result.pullRequest.status, 'merged');
  assert.equal(result.mergeMethod, 'squash');
  assert.equal(result.commitSha, 'merge-sha');
  assert.deepEqual(client.toolCallRequests.map((call) => call.toolName), [defaultGitHubMcpToolNames.mergePullRequest]);

  await assert.rejects(
    () => port.mergePullRequest({ pullRequest: { ...pullRequest, targetBranch: 'main' }, method: 'squash' }),
    /develop pull requests/u
  );
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

test('GitHub MCP CodeHostPort missing helper tools fail with actionable MCP tool errors', async () => {
  const missingListPullRequests = new GitHubMcpCodeHostPort({
    client: new MockMcpClient([createMockMcpTool(serverId, customTools.getChecks, () => ({ content: {}, isError: false }))]),
    serverId,
    toolNames: customTools
  });

  await assert.rejects(() => missingListPullRequests.getChecks({ repository, branchName: branch.name }), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.serverId, serverId);
    assert.equal(error.toolName, customTools.listPullRequests);
    assert.match(error.message, /Configure or allow the MCP server tool before retrying/u);
    return true;
  });

  const missingPullRequestRead = new GitHubMcpCodeHostPort({
    client: new MockMcpClient([
      createMockMcpTool(serverId, customTools.listPullRequests, () => ({ content: [{ number: 77, head: { ref: branch.name } }], isError: false }))
    ]),
    serverId,
    toolNames: customTools
  });

  await assert.rejects(() => missingPullRequestRead.getChecks({ repository, branchName: branch.name }), (error: unknown) => {
    assert.ok(error instanceof McpToolNotFoundError);
    assert.equal(error.serverId, serverId);
    assert.equal(error.toolName, customTools.getChecks);
    assert.match(error.message, /Configure or allow the MCP server tool before retrying/u);
    return true;
  });
});
