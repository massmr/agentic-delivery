import type { MeaningfulDiffEvidence, MeaningfulDiffSnapshot } from '../domain/index.js';

import { runGitCommand } from './local-git-adapter.js';
import type { GitCommandRunner, GitCommandResult } from './local-git-adapter.js';

export const meaningfulDiffIgnoredPathPatterns = [
  '.omo/**',
  '.ewokbot/**',
  'log/**',
  'logs/**',
  '**/log/**',
  '**/logs/**',
  '*.log',
  '**/*.log',
  'cache/**',
  '.cache/**',
  '**/cache/**',
  '**/.cache/**'
] as const;

export interface InspectMeaningfulDiffInput {
  readonly repositoryPath: string;
  readonly baseline?: MeaningfulDiffSnapshot | undefined;
  readonly gitCommandRunner?: GitCommandRunner | undefined;
}

export interface CaptureMeaningfulDiffSnapshotInput {
  readonly repositoryPath: string;
  readonly gitCommandRunner?: GitCommandRunner | undefined;
}

export async function captureMeaningfulDiffSnapshot(input: CaptureMeaningfulDiffSnapshotInput): Promise<MeaningfulDiffSnapshot> {
  const git = input.gitCommandRunner ?? runGitCommand;
  const statusResult = await git({ command: 'git', args: ['status', '--porcelain=v1', '-uall'], cwd: input.repositoryPath });
  assertGitCommandSucceeded(statusResult, 'status --porcelain=v1 -uall');

  const diffResult = await git({ command: 'git', args: ['diff', '--stat'], cwd: input.repositoryPath });
  assertGitCommandSucceeded(diffResult, 'diff --stat');

  return {
    changedFiles: parsePorcelainStatus(statusResult.stdout),
    diffSummary: diffResult.stdout.trim()
  };
}

export async function inspectMeaningfulDiff(input: InspectMeaningfulDiffInput): Promise<MeaningfulDiffEvidence> {
  const baseline = input.baseline ?? { changedFiles: [], diffSummary: '' };
  const afterAgent = await captureMeaningfulDiffSnapshot(input);
  const changedFiles = findNewChangedFiles(baseline.changedFiles, afterAgent.changedFiles);
  const ignoredFiles = changedFiles.filter(isIgnoredMeaningfulDiffPath);
  const productFiles = changedFiles.filter((filePath) => !isIgnoredMeaningfulDiffPath(filePath));
  const decision = productFiles.length === 0 ? 'failed' : 'passed';
  const reason = decision === 'passed'
    ? `Meaningful agent product diff detected in ${productFiles.length} file${productFiles.length === 1 ? '' : 's'} after the pre-OpenCode baseline.`
    : changedFiles.length === 0
      ? 'OpenCode reported success, but git status found no new changed files after the pre-OpenCode baseline.'
      : 'OpenCode reported success, but new changes after the pre-OpenCode baseline were only ignored agent/runtime artifacts and no product file changes.';

  return {
    decision,
    reason,
    baselineChangedFiles: baseline.changedFiles,
    afterAgentChangedFiles: afterAgent.changedFiles,
    newChangedFiles: changedFiles,
    changedFiles,
    productFiles,
    ignoredFiles,
    ignoredPathPatterns: meaningfulDiffIgnoredPathPatterns,
    baselineDiffSummary: baseline.diffSummary,
    afterAgentDiffSummary: afterAgent.diffSummary,
    diffSummary: afterAgent.diffSummary
  };
}

function findNewChangedFiles(baselineChangedFiles: readonly string[], afterAgentChangedFiles: readonly string[]): readonly string[] {
  const baseline = new Set(baselineChangedFiles.map(normalizeGitPath));
  return afterAgentChangedFiles.filter((filePath) => !baseline.has(normalizeGitPath(filePath)));
}

export function parsePorcelainStatus(stdout: string): readonly string[] {
  const paths = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map(parsePorcelainPath)
    .filter((path): path is string => path !== undefined);

  return [...new Set(paths)];
}

export function isIgnoredMeaningfulDiffPath(filePath: string): boolean {
  const normalizedPath = normalizeGitPath(filePath);
  const segments = normalizedPath.split('/');

  return normalizedPath === '.omo' ||
    normalizedPath.startsWith('.omo/') ||
    normalizedPath === '.ewokbot' ||
    normalizedPath.startsWith('.ewokbot/') ||
    normalizedPath.endsWith('.log') ||
    segments.includes('log') ||
    segments.includes('logs') ||
    segments.includes('cache') ||
    segments.includes('.cache');
}

function parsePorcelainPath(line: string): string | undefined {
  if (line.length < 4) {
    return undefined;
  }

  const rawPath = line.slice(3).trim();
  const renameTarget = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
  return renameTarget === undefined || renameTarget.length === 0 ? undefined : normalizeGitPath(unquoteGitPath(renameTarget));
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function unquoteGitPath(filePath: string): string {
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    return filePath.slice(1, -1);
  }

  return filePath;
}

function assertGitCommandSucceeded(result: GitCommandResult, description: string): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  throw new Error(`git ${description} failed during meaningful diff inspection: ${detail}`);
}
