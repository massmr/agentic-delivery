import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

import type { BranchRef, DevelopHandoffCommit, RepositoryRef } from '../domain/index.js';

export interface GitCommandInput {
  readonly command: 'git';
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type GitCommandRunner = (input: GitCommandInput) => Promise<GitCommandResult>;

export interface CreateLocalBranchInput {
  readonly repository: RepositoryRef;
  readonly localPath: string;
  readonly branchName: string;
  readonly baseBranch: string;
}

export interface PushLocalBranchInput {
  readonly repository: RepositoryRef;
  readonly localPath: string;
  readonly branch: BranchRef;
}

export interface CommitScopedAgentDiffInput {
  readonly repository: RepositoryRef;
  readonly localPath: string;
  readonly branch: BranchRef;
  readonly files: readonly string[];
  readonly message: string;
}

export class LocalGitAdapter {
  constructor(private readonly commandRunner: GitCommandRunner = runGitCommand) {}

  async createBranch(input: CreateLocalBranchInput): Promise<BranchRef> {
    assertSafeBranchName(input.branchName);
    assertSafeBranchName(input.baseBranch);

    const branchExists = await this.runAllowingFailure(['show-ref', '--verify', '--quiet', `refs/heads/${input.branchName}`], input.localPath);

    if (branchExists.exitCode === 0) {
      await this.runOrThrow(['checkout', input.branchName], input.localPath);
    } else {
      await this.runOrThrow(['checkout', '-b', input.branchName, input.baseBranch], input.localPath);
    }

    const headSha = (await this.runOrThrow(['rev-parse', 'HEAD'], input.localPath)).stdout.trim();

    return {
      repository: input.repository,
      name: input.branchName,
      baseBranch: input.baseBranch,
      ...(headSha.length === 0 ? {} : { headSha })
    };
  }

  async pushBranch(input: PushLocalBranchInput): Promise<BranchRef> {
    assertSafeBranchName(input.branch.name);

    await this.runOrThrow(['push', 'origin', input.branch.name], input.localPath);
    const headSha = (await this.runOrThrow(['rev-parse', 'HEAD'], input.localPath)).stdout.trim();

    return {
      ...input.branch,
      repository: input.repository,
      ...(headSha.length === 0 ? {} : { headSha })
    };
  }

  async commitScopedAgentDiff(input: CommitScopedAgentDiffInput): Promise<DevelopHandoffCommit> {
    assertSafeBranchName(input.branch.name);
    const files = normalizeScopedFiles(input.files);
    const message = normalizeCommitMessage(input.message);

    await this.runOrThrow(['reset', '--'], input.localPath);
    await this.runOrThrow(['add', '--', ...files], input.localPath);
    const stagedFiles = normalizeScopedFiles((await this.runOrThrow(['diff', '--cached', '--name-only'], input.localPath)).stdout.split('\n'));

    assertExactScopedFiles(stagedFiles, files);
    await this.runOrThrow(['-c', 'user.name=Ewokbot', '-c', 'user.email=ewokbot@example.invalid', 'commit', '-m', message], input.localPath);
    const commitSha = (await this.runOrThrow(['rev-parse', 'HEAD'], input.localPath)).stdout.trim();

    return {
      repository: input.repository,
      branchName: input.branch.name,
      commitSha,
      message,
      stagedFiles
    };
  }

  async getHeadSha(localPath: string): Promise<string> {
    return (await this.runOrThrow(['rev-parse', 'HEAD'], localPath)).stdout.trim();
  }

  private async runAllowingFailure(args: readonly string[], cwd: string): Promise<GitCommandResult> {
    return this.commandRunner({ command: 'git', args, cwd });
  }

  private async runOrThrow(args: readonly string[], cwd: string): Promise<GitCommandResult> {
    const result = await this.commandRunner({ command: 'git', args, cwd });

    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
    }

    return result;
  }
}

export function runGitCommand(input: GitCommandInput): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ stdout, stderr: `${stderr}${error.message}\n`, exitCode: 1 });
    });
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

function assertSafeBranchName(branchName: string): void {
  if (branchName.trim() !== branchName || branchName.length === 0 || branchName.startsWith('-') || /\s/u.test(branchName)) {
    throw new Error(`Unsafe git branch name: ${branchName}`);
  }
}

function normalizeScopedFiles(files: readonly string[]): readonly string[] {
  const normalized = [...new Set(files.map((file) => file.trim()).filter((file) => file.length > 0))].sort();

  if (normalized.length === 0) {
    throw new Error('Scoped agent diff commit requires at least one product file.');
  }

  for (const file of normalized) {
    assertSafeRelativeFilePath(file);
  }

  return normalized;
}

function assertSafeRelativeFilePath(filePath: string): void {
  if (
    filePath.length === 0 ||
    filePath.startsWith('-') ||
    isAbsolute(filePath) ||
    filePath.split('/').includes('..') ||
    filePath === '.git' ||
    filePath.startsWith('.git/')
  ) {
    throw new Error(`Unsafe scoped git file path: ${filePath}`);
  }
}

function assertExactScopedFiles(actual: readonly string[], expected: readonly string[]): void {
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error(`Scoped agent diff commit staged unexpected files. Expected: ${expected.join(', ')}. Actual: ${actual.join(', ')}.`);
  }
}

function normalizeCommitMessage(message: string): string {
  const normalized = message.replace(/\s+/gu, ' ').trim();

  if (normalized.length === 0 || normalized.startsWith('-')) {
    throw new Error('Scoped agent diff commit requires a safe commit message.');
  }

  return normalized;
}
