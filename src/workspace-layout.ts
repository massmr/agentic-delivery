import { join } from 'node:path';

export const ewokbotDirectory = '.ewokbot';
export const ewokbotWorkspaceConfigPath = join(ewokbotDirectory, 'workspace.yml');
export const ewokbotEnvPath = join(ewokbotDirectory, '.env');
export const ewokbotEnvExamplePath = join(ewokbotDirectory, '.env.example');
export const ewokbotRunsDirectory = join(ewokbotDirectory, 'runs');
export const ewokbotLogsDirectory = join(ewokbotDirectory, 'logs');
export const ewokbotCacheDirectory = join(ewokbotDirectory, 'cache');
export const ewokbotMcpToolsCacheDirectory = join(ewokbotCacheDirectory, 'mcp-tools');

export function getEwokbotRunDirectoryPath(ticketKey: string, runId: string): string {
  return join(ewokbotRunsDirectory, ticketKey, runId);
}

export function getEwokbotRunStateFilePath(ticketKey: string, runId: string): string {
  return join(getEwokbotRunDirectoryPath(ticketKey, runId), 'state.json');
}

export function getEwokbotWorkspaceControlFilePath(): string {
  return join(ewokbotRunsDirectory, 'control.json');
}

export function getEwokbotMcpToolRegistrySnapshotPath(serverId: string): string {
  return join(ewokbotMcpToolsCacheDirectory, `${sanitizeWorkspacePathSegment(serverId)}.json`);
}

export function getEwokbotWorkerLockFilePath(): string {
  return join(ewokbotRunsDirectory, 'worker.lock');
}

function sanitizeWorkspacePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '');
  return sanitized.length > 0 ? sanitized : 'mcp-server';
}
