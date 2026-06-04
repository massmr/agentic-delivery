import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createOnboardingFiles,
  getSetupCapabilities,
  getSetupCapabilitiesForSelections,
  parseWorkspaceConfig,
  type SetupGeneratedConfigMetadata,
  type SetupProviderCapability,
  type WorkspaceConfig
} from '../../src/index.js';

test('setup provider capabilities are returned in deterministic onboarding order', () => {
  const capabilities = getSetupCapabilities({ deploymentMonitor: 'both', includeOhMyOpenAgent: true });

  assert.deepEqual(
    capabilities.map((capability) => capability.id),
    ['opencode', 'oh-my-openagent', 'github', 'jira', 'railway', 'vercel', 'cli']
  );
});

test('setup provider capabilities describe steps and secrets without executing setup', () => {
  const capabilities = getSetupCapabilitiesForSelections({ deploymentMonitor: 'vercel', includeOhMyOpenAgent: false });

  assert.deepEqual(
    capabilities.map((capability) => capability.id),
    ['opencode', 'github', 'jira', 'vercel', 'cli']
  );
  assert.equal(capabilities.every((capability) => capability.installSteps.length > 0), true);
  assert.deepEqual(
    capabilities.flatMap((capability) => capability.requiredSecretEnvVars),
    ['GITHUB_TOKEN', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'VERCEL_TOKEN']
  );
});

test('setup provider capabilities detect existing local setup with injectable checks', () => {
  const capabilities = capabilitiesById(getSetupCapabilities({ deploymentMonitor: 'both', includeOhMyOpenAgent: true }));
  const input = {
    cwd: '/workspace',
    env: {
      GITHUB_TOKEN: 'present',
      GITHUB_ORG: 'agentic',
      JIRA_BASE_URL: 'https://jira.example.test',
      JIRA_EMAIL: 'bot@example.test',
      JIRA_API_TOKEN: 'present',
      RAILWAY_TOKEN: 'present',
      VERCEL_TOKEN: 'present'
    },
    commandExists: (command: string) => command === 'opencode',
    fileExists: (path: string) => path === '/workspace/.oh-my-openagent.yml'
  };

  assert.equal(capabilities.opencode.detectExistingSetup(input).configured, true);
  assert.equal(capabilities['oh-my-openagent'].detectExistingSetup(input).configured, true);
  assert.equal(capabilities.github.detectExistingSetup(input).configured, true);
  assert.equal(capabilities.jira.detectExistingSetup(input).configured, true);
  assert.equal(capabilities.railway.detectExistingSetup(input).configured, true);
  assert.equal(capabilities.vercel.detectExistingSetup(input).configured, true);
  assert.equal(capabilities.cli.detectExistingSetup({ cwd: '/workspace' }).configured, true);
});

test('setup provider capabilities report missing local setup without live checks', () => {
  const capabilities = capabilitiesById(getSetupCapabilities({ deploymentMonitor: 'both', includeOhMyOpenAgent: true }));
  const input = {
    cwd: '/workspace',
    env: {},
    commandExists: () => false,
    fileExists: () => false
  };

  assert.equal(capabilities.opencode.detectExistingSetup(input).configured, false);
  assert.match(capabilities.github.detectExistingSetup(input).details.join('\n'), /GITHUB_TOKEN/u);
  assert.match(capabilities.github.detectExistingSetup(input).details.join('\n'), /GITHUB_ORG/u);
  assert.match(capabilities.jira.detectExistingSetup(input).details.join('\n'), /JIRA_BASE_URL/u);
  assert.match(capabilities.railway.detectExistingSetup(input).details.join('\n'), /RAILWAY_TOKEN/u);
  assert.match(capabilities.vercel.detectExistingSetup(input).details.join('\n'), /VERCEL_TOKEN/u);
});

test('setup provider capabilities validate generated config by provider contract', () => {
  const metadata: SetupGeneratedConfigMetadata = {
    deploymentMonitors: ['railway', 'vercel'],
    optionalTools: ['oh-my-openagent'],
    controlPlane: 'cli'
  };
  const config = parseWorkspaceConfig(createOnboardingFiles({ deploymentMonitor: 'both', includeOhMyOpenAgent: true }).workspaceYaml);
  const capabilities = getSetupCapabilities({ deploymentMonitor: 'both', includeOhMyOpenAgent: true });

  for (const capability of capabilities) {
    assert.equal(capability.validateGeneratedConfig(config, metadata).valid, true, capability.id);
  }
});

test('setup provider validation catches capability-specific config issues', () => {
  const config = parseWorkspaceConfig(createOnboardingFiles({ deploymentMonitor: 'vercel', includeOhMyOpenAgent: false }).workspaceYaml);
  const capabilities = capabilitiesById(getSetupCapabilities({ deploymentMonitor: 'both', includeOhMyOpenAgent: true }));
  const invalidOpenCodeConfig: WorkspaceConfig = {
    ...config,
    devRunner: {
      ...config.devRunner,
      command: ''
    }
  };

  assert.equal(capabilities.opencode.validateGeneratedConfig(invalidOpenCodeConfig).valid, false);
  assert.equal(capabilities.vercel.validateGeneratedConfig(config, { deploymentMonitors: ['railway'], controlPlane: 'cli' }).valid, false);
  assert.equal(capabilities.cli.validateGeneratedConfig(config, { deploymentMonitors: ['vercel'], controlPlane: 'dashboard' }).valid, false);
});

function capabilitiesById(capabilities: readonly SetupProviderCapability[]): Record<string, SetupProviderCapability> {
  return Object.fromEntries(capabilities.map((capability) => [capability.id, capability]));
}
