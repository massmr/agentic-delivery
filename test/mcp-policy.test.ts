import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAtlassianMcpToolRegistry,
  createCustomMcpToolRegistry,
  createGitHubMcpToolRegistry,
  createMcpPolicyReport,
  createMockMcpTool,
  createRailwayMcpToolRegistry,
  evaluateMcpToolPolicy,
  type McpPolicyConfig,
  type McpPolicyDecision,
  type McpToolRegistryEntry
} from '../src/index.js';

test('read_only allows Atlassian read tools and denies writes by default', () => {
  const readEvaluation = evaluateMcpToolPolicy({ entry: atlassianEntry('search_jira_issues') });
  const writeEvaluation = evaluateMcpToolPolicy({ entry: atlassianEntry('add_jira_comment') });

  assert.equal(readEvaluation.decision, 'allow');
  assert.equal(readEvaluation.blocked, false);
  assert.equal(writeEvaluation.decision, 'deny');
  assert.match(writeEvaluation.reason, /Read-only mode denies non-read/u);
  assert.equal(writeEvaluation.blocked, true);
});

test('supervised mode requires human approval for GitHub writes unless explicitly overridden', () => {
  const entry = githubEntry('add_issue_comment');
  const supervised = evaluateMcpToolPolicy({ entry, policy: policy('supervised') });
  const explicitAllow = evaluateMcpToolPolicy({
    entry,
    policy: policy('supervised', { tools: { 'github.add_issue_comment': { decision: 'allow', reason: 'review comments are staging-safe' } } })
  });

  assert.equal(supervised.decision, 'require_human');
  assert.equal(supervised.humanApprovalRequired, true);
  assert.equal(explicitAllow.decision, 'allow');
  assert.equal(explicitAllow.matchedOverride?.key, 'github.add_issue_comment');
});

test('read_only allows inspected GitHub reads and denies writes or destructive tools by default', () => {
  for (const toolName of ['list_branches', 'list_pull_requests', 'pull_request_read']) {
    const evaluation = evaluateMcpToolPolicy({ entry: githubEntry(toolName) });
    assert.equal(evaluation.decision, 'allow');
  }

  const writeEvaluation = evaluateMcpToolPolicy({ entry: githubEntry('add_issue_comment') });
  const destructiveEvaluation = evaluateMcpToolPolicy({ entry: githubEntry('create_pull_request') });

  assert.equal(writeEvaluation.decision, 'deny');
  assert.match(writeEvaluation.reason, /Read-only mode denies non-read/u);
  assert.equal(destructiveEvaluation.decision, 'deny');
  assert.match(destructiveEvaluation.reason, /Destructive tools are denied by default/u);
});

test('trusted mode allows Railway read/status tools but denies secret-sensitive tools by default', () => {
  const readEvaluation = evaluateMcpToolPolicy({ entry: railwayEntry('list_deployments'), policy: policy('trusted') });
  const secretEvaluation = evaluateMcpToolPolicy({ entry: railwayEntry('list_variables'), policy: policy('trusted') });

  assert.equal(readEvaluation.decision, 'allow');
  assert.equal(secretEvaluation.decision, 'deny');
  assert.match(secretEvaluation.reason, /Secret-sensitive tools are denied/u);
});

test('read_only denies Railway HTTP observability and auth probes until explicitly classified', () => {
  for (const toolName of ['whoami', 'http_error_rate', 'http_requests', 'http_response_time']) {
    const evaluation = evaluateMcpToolPolicy({ entry: railwayEntry(toolName) });

    assert.equal(evaluation.decision, 'deny');
    assert.match(evaluation.reason, /no built-in AV classification/u);
  }
});

test('read_only denies Railway source and link mutation tools by default', () => {
  for (const toolName of ['connect_service_source', 'disconnect_service_source', 'link_service', 'link_environment']) {
    const evaluation = evaluateMcpToolPolicy({ entry: railwayEntry(toolName) });

    assert.equal(evaluation.decision, 'deny');
    assert.match(evaluation.reason, /Destructive tools are denied by default/u);
    assert.equal(evaluation.blocked, true);
  }
});

test('secret-sensitive tools can only be reported through allow_redacted overrides', () => {
  const entry = railwayEntry('read_environment_variables');
  const redacted = evaluateMcpToolPolicy({
    entry,
    policy: policy('custom', { tools: { 'railway.read_environment_variables': { decision: 'allow_redacted' } } })
  });
  const autonomous = evaluateMcpToolPolicy({
    entry,
    policy: policy('custom', { tools: { 'railway.read_environment_variables': { decision: 'allow' } } })
  });

  assert.equal(redacted.decision, 'allow_redacted');
  assert.equal(redacted.redacted, true);
  assert.equal(autonomous.decision, 'deny');
  assert.match(autonomous.reason, /Secret-sensitive tools cannot be autonomously allowed/u);
});

test('custom mode honors explicit tool overrides and denies unknown tools without override', () => {
  const custom = customEntry('customStageGate');
  const unknown = customEntry('mysteryAction');
  const allowed = evaluateMcpToolPolicy({
    entry: custom,
    policy: policy('custom', { tools: { customStageGate: { decision: 'allow', reason: 'local fixture tool' } } })
  });
  const denied = evaluateMcpToolPolicy({ entry: unknown, policy: policy('custom') });

  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.reason, 'local fixture tool');
  assert.equal(denied.decision, 'deny');
  assert.match(denied.reason, /no built-in AV classification/u);
});

test('unknown tools remain denied even with explicit overrides', () => {
  const entry = customEntry('mysteryAction');
  const evaluation = evaluateMcpToolPolicy({
    entry,
    policy: policy('custom', { tools: { mysteryAction: { decision: 'allow' } } })
  });

  assert.equal(evaluation.decision, 'deny');
  assert.match(evaluation.reason, /Unknown MCP tools remain denied/u);
});

test('production merge or deploy tools cannot be autonomously allowed', () => {
  const entry = githubEntry('mergeProductionPullRequest');
  const evaluation = evaluateMcpToolPolicy({
    entry,
    policy: policy('custom', { tools: { mergeProductionPullRequest: { decision: 'allow' } } })
  });

  assert.equal(evaluation.decision, 'require_human');
  assert.match(evaluation.reason, /Production merge\/deploy MCP tools require human approval/u);
});

test('destructive delete tools cannot be autonomously allowed but staging-safe destructive overrides can be explicit', () => {
  const deleteEvaluation = evaluateMcpToolPolicy({
    entry: githubEntry('delete_branch'),
    policy: policy('custom', { tools: { delete_branch: { decision: 'allow' } } })
  });
  const openPullRequestEvaluation = evaluateMcpToolPolicy({
    entry: githubEntry('create_pull_request'),
    policy: policy('custom', { tools: { create_pull_request: { decision: 'allow', reason: 'staging PR handoff is safe' } } })
  });

  assert.equal(deleteEvaluation.decision, 'deny');
  assert.match(deleteEvaluation.reason, /delete\/remove/u);
  assert.equal(openPullRequestEvaluation.decision, 'allow');
});

test('GitHub merge_pull_request cannot be autonomously allowed', () => {
  const entry = githubEntry('merge_pull_request');
  const custom = evaluateMcpToolPolicy({
    entry,
    policy: policy('custom', { tools: { merge_pull_request: { decision: 'allow' } } })
  });
  const trusted = evaluateMcpToolPolicy({ entry, policy: policy('trusted') });

  assert.equal(custom.decision, 'require_human');
  assert.match(custom.reason, /merge_pull_request requires human approval/u);
  assert.equal(trusted.decision, 'deny');
});

test('policy reports summarize allow redacted human and denied decisions', () => {
  const entries = [
    atlassianEntry('search_jira_issues'),
    atlassianEntry('add_jira_comment'),
    railwayEntry('read_environment_variables'),
    customEntry('mysteryAction')
  ];
  const report = createMcpPolicyReport(entries, policy('supervised', {
    tools: {
      'railway.read_environment_variables': { decision: 'allow_redacted' }
    }
  }));

  assert.equal(report.mode, 'supervised');
  assert.deepEqual(report.summary, { allow: 1, allowRedacted: 1, requireHuman: 1, deny: 1 });
});

function atlassianEntry(toolName: string): McpToolRegistryEntry {
  return createAtlassianMcpToolRegistry('atlassian', [tool(toolName)]).entries[0] as McpToolRegistryEntry;
}

function railwayEntry(toolName: string): McpToolRegistryEntry {
  return createRailwayMcpToolRegistry('railway', [tool(toolName)]).entries[0] as McpToolRegistryEntry;
}

function githubEntry(toolName: string): McpToolRegistryEntry {
  return createGitHubMcpToolRegistry('github', [tool(toolName)]).entries[0] as McpToolRegistryEntry;
}

function customEntry(toolName: string): McpToolRegistryEntry {
  return createCustomMcpToolRegistry('custom', [tool(toolName)]).entries[0] as McpToolRegistryEntry;
}

function tool(toolName: string): ReturnType<typeof createMockMcpTool>['definition'] {
  return createMockMcpTool('policy-test', toolName, () => ({ content: {}, isError: false })).definition;
}

function policy(mode: McpPolicyConfig['mode'], overrides: Omit<McpPolicyConfig, 'mode'> = {}): McpPolicyConfig {
  return {
    mode,
    providers: overrides.providers ?? {},
    servers: overrides.servers ?? {},
    tools: overrides.tools ?? {}
  };
}
