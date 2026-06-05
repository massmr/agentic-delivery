import { join } from 'node:path';

export const ewokbotDirectory = '.ewokbot';
export const ewokbotWorkspaceConfigPath = join(ewokbotDirectory, 'workspace.yml');
export const ewokbotEnvPath = join(ewokbotDirectory, '.env');
export const ewokbotEnvExamplePath = join(ewokbotDirectory, '.env.example');
export const ewokbotRunsDirectory = join(ewokbotDirectory, 'runs');
export const ewokbotLogsDirectory = join(ewokbotDirectory, 'logs');
export const ewokbotCacheDirectory = join(ewokbotDirectory, 'cache');

export function getEwokbotRunDirectoryPath(ticketKey: string, runId: string): string {
  return join(ewokbotRunsDirectory, ticketKey, runId);
}

export function getEwokbotRunStateFilePath(ticketKey: string, runId: string): string {
  return join(getEwokbotRunDirectoryPath(ticketKey, runId), 'state.json');
}

export function getEwokbotWorkspaceControlFilePath(): string {
  return join(ewokbotRunsDirectory, 'control.json');
}

export function getEwokbotWorkerLockFilePath(): string {
  return join(ewokbotRunsDirectory, 'worker.lock');
}
