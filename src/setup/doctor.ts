import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';

import { WorkspaceConfigError, parseWorkspaceConfig } from '../config/index.js';
import {
  getRequiredEnvPlaceholders,
  getSetupCapabilitiesForSelections,
  type DeploymentMonitorSelection,
  type SetupGeneratedConfigMetadata,
  type SetupSelections
} from './provider-capability.js';

export interface DoctorIssue {
  readonly severity: 'fail' | 'warn';
  readonly message: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly issues: readonly DoctorIssue[];
}

export function runLocalDoctor(cwd: string): DoctorReport {
  const configPath = join(cwd, 'config', 'workspace.yml');
  const envExamplePath = join(cwd, '.env.example');
  const lines = ['Doctor checked local files only; no provider, MCP, installer, or network calls were made.'];
  const issues: DoctorIssue[] = [];

  if (!existsSync(configPath)) {
    issues.push({ severity: 'fail', message: 'Missing config/workspace.yml. Run ewokbot init to create local setup files.' });
    return { ok: false, lines, issues };
  }

  const configYaml = readFileSync(configPath, 'utf8');
  const metadata = readSetupMetadata(configYaml);
  const selections = readSetupSelections(metadata);

  try {
    const config = parseWorkspaceConfig(configYaml);
    lines.push('config/workspace.yml is valid.');

    for (const capability of getSetupCapabilitiesForSelections(selections)) {
      const validation = capability.validateGeneratedConfig(config, metadata);

      for (const issue of validation.issues) {
        issues.push({ severity: 'fail', message: `${capability.label}: ${issue}` });
      }
    }
  } catch (error) {
    const message = error instanceof WorkspaceConfigError ? error.message : String(error);
    issues.push({ severity: 'fail', message: `Invalid config/workspace.yml: ${message}` });
    return { ok: false, lines, issues };
  }

  lines.push(`Deployment monitors: ${selectedDeploymentMonitors(selections.deploymentMonitor).join(', ')}`);

  if (!existsSync(envExamplePath)) {
    issues.push({ severity: 'fail', message: 'Missing .env.example with required secret placeholders.' });
  } else {
    const envExample = readFileSync(envExamplePath, 'utf8');
    for (const placeholder of getRequiredEnvPlaceholders(selections)) {
      if (!new RegExp(`^${escapeRegex(placeholder)}=`, 'mu').test(envExample)) {
        issues.push({ severity: 'fail', message: `Missing .env.example placeholder: ${placeholder}` });
      }
    }
  }

  return { ok: issues.every((issue) => issue.severity !== 'fail'), lines, issues };
}

function readSetupMetadata(configYaml: string): SetupGeneratedConfigMetadata {
  const document = parseDocument(configYaml);
  const parsed = document.toJS() as { readonly setup?: { readonly deployment_monitors?: unknown; readonly optional_tools?: unknown; readonly control_plane?: unknown } } | null;
  const setup = parsed?.setup;

  if (setup === undefined) {
    return {};
  }

  return {
    deploymentMonitors: Array.isArray(setup.deployment_monitors) ? setup.deployment_monitors.map(String) : undefined,
    optionalTools: Array.isArray(setup.optional_tools) ? setup.optional_tools.map(String) : undefined,
    controlPlane: typeof setup.control_plane === 'string' ? setup.control_plane : undefined
  };
}

function readSetupSelections(metadata: SetupGeneratedConfigMetadata): SetupSelections {
  if (metadata.deploymentMonitors === undefined && metadata.optionalTools === undefined) {
    return { deploymentMonitor: 'railway', includeOhMyOpenAgent: false };
  }

  const monitors = metadata.deploymentMonitors ?? ['railway'];
  const optionalTools = metadata.optionalTools ?? [];

  return {
    deploymentMonitor: parseDeploymentMonitorSelection(monitors),
    includeOhMyOpenAgent: optionalTools.includes('oh-my-openagent')
  };
}

function parseDeploymentMonitorSelection(monitors: readonly string[]): DeploymentMonitorSelection {
  const hasRailway = monitors.includes('railway');
  const hasVercel = monitors.includes('vercel');

  if (hasRailway && hasVercel) {
    return 'both';
  }

  if (hasVercel) {
    return 'vercel';
  }

  return 'railway';
}

function selectedDeploymentMonitors(selection: DeploymentMonitorSelection): readonly string[] {
  if (selection === 'both') {
    return ['railway', 'vercel'];
  }

  return [selection];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
