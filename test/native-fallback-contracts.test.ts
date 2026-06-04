import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NativeFallbackContractNotFoundError,
  NativeFallbackContractViolationError,
  assertAdapterAllowedForAction,
  getNativeFallbackContract,
  isAdapterAllowedForAction,
  nativeFallbackContracts,
  type AdapterKind,
  type NativeFallbackPort
} from '../src/index.js';

test('Native Fallback Contracts keep external SaaS actions MCP-first where precise MCP contracts exist', () => {
  assertMcpFirst('TicketPort', 'listBacklog');
  assertMcpFirst('TicketPort', 'getTicket');
  assertMcpFirst('TicketPort', 'comment');
  assertMcpFirst('CodeHostPort', 'createBranch');
  assertMcpFirst('DeploymentPort', 'readDeployment');
  assertMcpFirst('DeploymentPort', 'getServiceUrl');
});

test('Native Fallback Contracts allow precise native fallback only for GitHub and Railway precision gaps', () => {
  const githubChecks = getNativeFallbackContract('CodeHostPort', 'getChecks');
  const railwayPolling = getNativeFallbackContract('DeploymentPort', 'waitForDeployment');

  assert.equal(githubChecks.preferredAdapter, 'mcp');
  assert.equal(githubChecks.nativeFallback, 'allowed-when-mcp-imprecise');
  assert.equal(isAdapterAllowedForAction('CodeHostPort', 'getChecks', 'native'), true);
  assert.match(githubChecks.reason, /status, suite, or conclusion precision/u);

  assert.equal(railwayPolling.preferredAdapter, 'mcp');
  assert.equal(railwayPolling.nativeFallback, 'allowed-when-mcp-imprecise');
  assert.equal(isAdapterAllowedForAction('DeploymentPort', 'waitForDeployment', 'native'), true);
  assert.match(railwayPolling.reason, /polling state or timeout guarantees/u);
});

test('Native Fallback Contracts require native or subprocess surfaces for local git, filesystem, quality, and OpenCode', () => {
  assertLocalFallback('CodeHostPort', 'pushBranch', 'subprocess');
  assertLocalFallback('WorkspacePort', 'checkout', 'subprocess');
  assertLocalFallback('WorkspacePort', 'commit', 'subprocess');
  assertLocalFallback('FilesystemPort', 'readWriteRunState', 'native');
  assertLocalFallback('QualityGateRunner', 'runRequiredGates', 'subprocess');
  assertLocalFallback('DevRunnerPort', 'runOpenCode', 'subprocess');
});

test('Native Fallback Contracts keep production merge and deployment human-only', () => {
  for (const action of ['mergeProductionPullRequest', 'deployProduction']) {
    const production = getNativeFallbackContract('ProductionControl', action);

    assert.equal(production.preferredAdapter, 'human');
    assert.equal(production.requiresHumanApproval, true);
    assert.equal(production.allowedAdapters.length, 0);
    assert.equal(isAdapterAllowedForAction('ProductionControl', action, 'mcp'), false);
    assert.throws(() => assertAdapterAllowedForAction('ProductionControl', action, 'native'), NativeFallbackContractViolationError);
  }
});

test('Native Fallback Contracts reject undeclared operations and disallowed adapters explicitly', () => {
  assert.throws(() => getNativeFallbackContract('CodeHostPort', 'mergePullRequest'), NativeFallbackContractNotFoundError);
  assert.throws(() => assertAdapterAllowedForAction('CodeHostPort', 'pushBranch', 'mcp'), NativeFallbackContractViolationError);
  assert.throws(() => assertAdapterAllowedForAction('QualityGateRunner', 'runRequiredGates', 'mcp'), NativeFallbackContractViolationError);
  assert.equal(assertAdapterAllowedForAction('CodeHostPort', 'pushBranch', 'subprocess').action, 'pushBranch');
});

test('Native Fallback Contracts cover the Milestone S required policy surfaces', () => {
  const keys = new Set(nativeFallbackContracts.map((contract) => `${contract.port}.${contract.action}`));

  assert.deepEqual(
    [
      'CodeHostPort.pushBranch',
      'CodeHostPort.getChecks',
      'CodeHostPort.openPullRequest',
      'DeploymentPort.waitForDeployment',
      'DeploymentPort.getServiceUrl',
      'FilesystemPort.readWriteRunState',
      'QualityGateRunner.runRequiredGates',
      'DevRunnerPort.runOpenCode',
      'ProductionControl.mergeProductionPullRequest',
      'ProductionControl.deployProduction'
    ].filter((key) => !keys.has(key)),
    []
  );
});

test('Native Fallback Contracts expose an immutable policy matrix', () => {
  const firstContract = nativeFallbackContracts[0];

  assert.equal(Object.isFrozen(nativeFallbackContracts), true);
  assert.ok(firstContract);
  assert.equal(Object.isFrozen(firstContract), true);
  assert.equal(Object.isFrozen(firstContract.allowedAdapters), true);
});

function assertMcpFirst(port: NativeFallbackPort, action: string): void {
  const contract = getNativeFallbackContract(port, action);

  assert.equal(contract.preferredAdapter, 'mcp');
  assert.equal(contract.mcpDefault, true);
  assert.equal(isAdapterAllowedForAction(port, action, 'mcp'), true);
  assert.equal(isAdapterAllowedForAction(port, action, 'mock'), true);
}

function assertLocalFallback(port: NativeFallbackPort, action: string, preferredAdapter: AdapterKind): void {
  const contract = getNativeFallbackContract(port, action);

  assert.equal(contract.preferredAdapter, preferredAdapter);
  assert.equal(contract.mcpDefault, false);
  assert.equal(contract.nativeFallback, 'required');
  assert.equal(isAdapterAllowedForAction(port, action, 'mcp'), false);
  assert.equal(isAdapterAllowedForAction(port, action, preferredAdapter), true);
}
