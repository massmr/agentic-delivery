import type { CoreSafetyDiffAddition } from '../policy/index.js';

import { readFile as defaultReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runGitCommand } from './local-git-adapter.js';
import type { GitCommandRunner, GitCommandResult } from './local-git-adapter.js';

export interface CaptureDiffAdditionsInput {
  readonly repositoryPath: string;
  readonly changedFiles: readonly string[];
  readonly gitCommandRunner?: GitCommandRunner | undefined;
  readonly readFile?: ((path: string) => Promise<string>) | undefined;
}

export async function captureDiffAdditions(input: CaptureDiffAdditionsInput): Promise<readonly CoreSafetyDiffAddition[]> {
  const changedFiles = [...new Set(input.changedFiles.map(normalizeGitPath).filter((filePath) => filePath.length > 0))];

  if (changedFiles.length === 0) {
    return [];
  }

  const git = input.gitCommandRunner ?? runGitCommand;
  const readFile = input.readFile ?? defaultReadFileUtf8;
  const statusResult = await git({
    command: 'git',
    args: ['status', '--porcelain=v1', '--untracked-files=normal', '--', ...changedFiles],
    cwd: input.repositoryPath
  });
  assertGitCommandSucceeded(statusResult, 'status --porcelain=v1 --untracked-files=normal');

  const untrackedFiles = parseUntrackedFiles(statusResult.stdout, changedFiles);
  const trackedFiles = changedFiles.filter((filePath) => !untrackedFiles.has(filePath));
  const additions: CoreSafetyDiffAddition[] = [];

  if (trackedFiles.length > 0) {
    const diffResult = await git({
      command: 'git',
      args: ['diff', '--unified=0', '--no-ext-diff', 'HEAD', '--', ...trackedFiles],
      cwd: input.repositoryPath
    });
    assertGitCommandSucceeded(diffResult, 'diff --unified=0 --no-ext-diff HEAD');
    additions.push(...parseDiffAdditions(diffResult.stdout));
  }

  for (const filePath of untrackedFiles) {
    const contents = await readFile(join(input.repositoryPath, filePath));
    additions.push(...parseFileAdditions(filePath, contents));
  }

  return additions;
}

export function parseDiffAdditions(stdout: string): readonly CoreSafetyDiffAddition[] {
  const additions: CoreSafetyDiffAddition[] = [];
  let currentFilePath: string | undefined;
  let nextLineNumber: number | undefined;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('+++ ')) {
      currentFilePath = parseDiffFilePath(line.slice(4));
      continue;
    }

    if (line.startsWith('@@')) {
      nextLineNumber = parseHunkNewStart(line);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++') && currentFilePath !== undefined) {
      additions.push({
        filePath: currentFilePath,
        lineNumber: nextLineNumber,
        content: line.slice(1)
      });

      if (nextLineNumber !== undefined) {
        nextLineNumber += 1;
      }
    }
  }

  return additions;
}

function parseFileAdditions(filePath: string, contents: string): readonly CoreSafetyDiffAddition[] {
  const lines = splitLines(contents);

  return lines.map((content, index) => ({
    filePath,
    lineNumber: index + 1,
    content
  }));
}

function splitLines(contents: string): readonly string[] {
  const lines = contents.split(/\r?\n/u);

  if (lines.at(-1) === '') {
    lines.pop();
  }

  return lines;
}

function parseUntrackedFiles(stdout: string, changedFiles: readonly string[]): ReadonlySet<string> {
  const changedFileSet = new Set(changedFiles);
  const untrackedFiles = new Set<string>();

  for (const line of stdout.split('\n')) {
    const filePath = parseUntrackedPorcelainPath(line);

    if (filePath !== undefined && changedFileSet.has(filePath)) {
      untrackedFiles.add(filePath);
    }
  }

  return untrackedFiles;
}

function parseUntrackedPorcelainPath(line: string): string | undefined {
  if (!line.startsWith('?? ')) {
    return undefined;
  }

  return normalizeGitPath(unquoteGitPath(line.slice(3).trim()));
}

async function defaultReadFileUtf8(path: string): Promise<string> {
  return defaultReadFile(path, 'utf8');
}

function unquoteGitPath(filePath: string): string {
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    return filePath.slice(1, -1);
  }

  return filePath;
}

function parseDiffFilePath(rawPath: string): string | undefined {
  const trimmedPath = rawPath.trim();

  if (trimmedPath === '/dev/null') {
    return undefined;
  }

  return normalizeGitPath(trimmedPath.replace(/^b\//u, ''));
}

function parseHunkNewStart(line: string): number | undefined {
  const match = /\+(\d+)(?:,\d+)?/u.exec(line);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function assertGitCommandSucceeded(result: GitCommandResult, description: string): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.stderr.trim() || `exit code ${result.exitCode}`;
  throw new Error(`git ${description} failed during diff addition capture: ${detail}`);
}
