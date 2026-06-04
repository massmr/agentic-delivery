import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface WorkerLockMetadata {
  readonly pid: number;
  readonly startedAt: string;
  readonly workspaceRoot: string;
  readonly token: string;
}

export interface WorkerLockLease {
  readonly lockPath: string;
  readonly metadata: WorkerLockMetadata;
  release(): Promise<void>;
}

export interface AcquireWorkerLockOptions {
  readonly rootPath: string;
  readonly now?: (() => Date) | undefined;
  readonly pid?: number | undefined;
  readonly token?: string | undefined;
  readonly isProcessAlive?: ((pid: number) => boolean) | undefined;
  readonly onStaleLockRecovered?: ((metadata: WorkerLockMetadata | undefined, lockPath: string) => void) | undefined;
}

export class WorkerLockHeldError extends Error {
  readonly lockPath: string;
  readonly metadata: WorkerLockMetadata | undefined;

  constructor(lockPath: string, metadata: WorkerLockMetadata | undefined) {
    const owner = metadata === undefined ? 'unknown owner' : `pid ${metadata.pid} started at ${metadata.startedAt}`;
    super(`Worker lock is already held at ${lockPath} by ${owner}. Stop that worker before starting another one.`);
    this.name = 'WorkerLockHeldError';
    this.lockPath = lockPath;
    this.metadata = metadata;
  }
}

export async function acquireWorkerLock(options: AcquireWorkerLockOptions): Promise<WorkerLockLease> {
  const lockPath = getWorkerLockPath(options.rootPath);
  const metadata: WorkerLockMetadata = {
    pid: options.pid ?? process.pid,
    startedAt: (options.now ?? (() => new Date()))().toISOString(),
    workspaceRoot: options.rootPath,
    token: options.token ?? randomUUID()
  };
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;

  await mkdir(join(options.rootPath, 'runs'), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await handle.close();

      return {
        lockPath,
        metadata,
        release: () => releaseWorkerLock(lockPath, metadata.token)
      };
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      const existing = await readWorkerLockMetadata(lockPath);
      if (existing !== undefined && isProcessAlive(existing.pid)) {
        throw new WorkerLockHeldError(lockPath, existing);
      }

      await rm(lockPath, { force: true });
      options.onStaleLockRecovered?.(existing, lockPath);
    }
  }

  throw new WorkerLockHeldError(lockPath, await readWorkerLockMetadata(lockPath));
}

export function getWorkerLockPath(rootPath: string): string {
  return join(rootPath, 'runs', 'worker.lock');
}

async function releaseWorkerLock(lockPath: string, token: string): Promise<void> {
  const metadata = await readWorkerLockMetadata(lockPath);

  if (metadata?.token !== token) {
    return;
  }

  await rm(lockPath, { force: true });
}

async function readWorkerLockMetadata(lockPath: string): Promise<WorkerLockMetadata | undefined> {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8')) as WorkerLockMetadata;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    return undefined;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      return true;
    }

    return false;
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
