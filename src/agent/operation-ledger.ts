import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getRunDirectoryPath } from '../state/run-state-store.js';

export type OperationLedgerStatus = 'started' | 'succeeded' | 'failed';

export interface OperationLedgerRecord {
  readonly operationId: string;
  readonly runId: string;
  readonly provider: string;
  readonly port: string;
  readonly action: string;
  readonly inputHash: string;
  readonly status: OperationLedgerStatus;
  readonly externalId?: string | undefined;
  readonly externalUrl?: string | undefined;
  readonly result?: unknown;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly errorSummary?: string | undefined;
}

export interface OperationLedgerStartInput {
  readonly runId: string;
  readonly provider: string;
  readonly port: string;
  readonly action: string;
  readonly input: unknown;
  readonly startedAt: string;
}

export interface OperationLedgerSuccessInput {
  readonly operationId: string;
  readonly finishedAt: string;
  readonly externalId?: string | undefined;
  readonly externalUrl?: string | undefined;
  readonly result?: unknown;
}

export interface OperationLedgerFailureInput {
  readonly operationId: string;
  readonly finishedAt: string;
  readonly errorSummary: string;
}

export interface OperationLedgerLookupInput {
  readonly runId: string;
  readonly provider: string;
  readonly port: string;
  readonly action: string;
  readonly input: unknown;
}

export interface OperationLedger {
  startOperation(input: OperationLedgerStartInput): Promise<OperationLedgerRecord>;
  succeedOperation(input: OperationLedgerSuccessInput): Promise<OperationLedgerRecord>;
  failOperation(input: OperationLedgerFailureInput): Promise<OperationLedgerRecord>;
  findCompletedOperation(input: OperationLedgerLookupInput): Promise<OperationLedgerRecord | undefined>;
  listOperations(): Promise<readonly OperationLedgerRecord[]>;
}

export class InMemoryOperationLedger implements OperationLedger {
  private readonly records = new Map<string, OperationLedgerRecord>();

  async startOperation(input: OperationLedgerStartInput): Promise<OperationLedgerRecord> {
    const operationId = buildOperationId(input);
    const existing = this.records.get(operationId);

    if (existing !== undefined && existing.status === 'succeeded') {
      return existing;
    }

    const record: OperationLedgerRecord = {
      operationId,
      runId: input.runId,
      provider: input.provider,
      port: input.port,
      action: input.action,
      inputHash: hashOperationInput(input.input),
      status: 'started',
      startedAt: input.startedAt
    };

    this.records.set(operationId, record);
    return record;
  }

  async succeedOperation(input: OperationLedgerSuccessInput): Promise<OperationLedgerRecord> {
    const existing = this.requireRecord(input.operationId);
    const record: OperationLedgerRecord = {
      ...existing,
      status: 'succeeded',
      finishedAt: input.finishedAt,
      ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
      ...(input.externalUrl === undefined ? {} : { externalUrl: input.externalUrl }),
      ...(input.result === undefined ? {} : { result: input.result })
    };

    this.records.set(input.operationId, record);
    return record;
  }

  async failOperation(input: OperationLedgerFailureInput): Promise<OperationLedgerRecord> {
    const existing = this.requireRecord(input.operationId);
    const record: OperationLedgerRecord = {
      ...existing,
      status: 'failed',
      finishedAt: input.finishedAt,
      errorSummary: input.errorSummary
    };

    this.records.set(input.operationId, record);
    return record;
  }

  async findCompletedOperation(input: OperationLedgerLookupInput): Promise<OperationLedgerRecord | undefined> {
    const operationId = buildOperationId(input);
    const record = this.records.get(operationId);

    return record?.status === 'succeeded' ? record : undefined;
  }

  async listOperations(): Promise<readonly OperationLedgerRecord[]> {
    return [...this.records.values()];
  }

  private requireRecord(operationId: string): OperationLedgerRecord {
    const record = this.records.get(operationId);

    if (record === undefined) {
      throw new Error(`Operation ledger record ${operationId} has not been started.`);
    }

    return record;
  }
}

export class JsonOperationLedger implements OperationLedger {
  constructor(
    private readonly ticketKey: string,
    private readonly runId: string,
    private readonly rootPath: string = process.cwd()
  ) {}

  async startOperation(input: OperationLedgerStartInput): Promise<OperationLedgerRecord> {
    const records = await this.readRecords();
    const operationId = buildOperationId(input);
    const existing = records.get(operationId);

    if (existing !== undefined && existing.status === 'succeeded') {
      return existing;
    }

    const record: OperationLedgerRecord = {
      operationId,
      runId: input.runId,
      provider: input.provider,
      port: input.port,
      action: input.action,
      inputHash: hashOperationInput(input.input),
      status: 'started',
      startedAt: input.startedAt
    };

    records.set(operationId, record);
    await this.writeRecords(records);
    return record;
  }

  async succeedOperation(input: OperationLedgerSuccessInput): Promise<OperationLedgerRecord> {
    const records = await this.readRecords();
    const existing = requireRecord(records, input.operationId);
    const record: OperationLedgerRecord = {
      ...existing,
      status: 'succeeded',
      finishedAt: input.finishedAt,
      ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
      ...(input.externalUrl === undefined ? {} : { externalUrl: input.externalUrl }),
      ...(input.result === undefined ? {} : { result: input.result })
    };

    records.set(input.operationId, record);
    await this.writeRecords(records);
    return record;
  }

  async failOperation(input: OperationLedgerFailureInput): Promise<OperationLedgerRecord> {
    const records = await this.readRecords();
    const existing = requireRecord(records, input.operationId);
    const record: OperationLedgerRecord = {
      ...existing,
      status: 'failed',
      finishedAt: input.finishedAt,
      errorSummary: input.errorSummary
    };

    records.set(input.operationId, record);
    await this.writeRecords(records);
    return record;
  }

  async findCompletedOperation(input: OperationLedgerLookupInput): Promise<OperationLedgerRecord | undefined> {
    const records = await this.readRecords();
    const record = records.get(buildOperationId(input));

    return record?.status === 'succeeded' ? record : undefined;
  }

  async listOperations(): Promise<readonly OperationLedgerRecord[]> {
    return [...(await this.readRecords()).values()];
  }

  private async readRecords(): Promise<Map<string, OperationLedgerRecord>> {
    try {
      const source = await readFile(this.filePath(), 'utf8');
      const parsed = JSON.parse(source) as { readonly operations?: readonly OperationLedgerRecord[] };
      return new Map((parsed.operations ?? []).map((record) => [record.operationId, record]));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return new Map();
      }

      throw error;
    }
  }

  private async writeRecords(records: Map<string, OperationLedgerRecord>): Promise<void> {
    const filePath = this.filePath();
    const temporaryPath = `${filePath}.tmp`;
    const body = `${JSON.stringify({ operations: [...records.values()].sort(compareOperationRecords) }, null, 2)}\n`;

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, body, 'utf8');
    await rename(temporaryPath, filePath);
  }

  private filePath(): string {
    return join(this.rootPath, getOperationLedgerFilePath(this.ticketKey, this.runId));
  }
}

export function getOperationLedgerFilePath(ticketKey: string, runId: string): string {
  return join(getRunDirectoryPath(ticketKey, runId), 'operation-ledger.json');
}

export function buildOperationId(input: OperationLedgerLookupInput): string {
  return [input.runId, input.provider, input.port, input.action, hashOperationInput(input.input)].join(':');
}

export function hashOperationInput(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function requireRecord(records: Map<string, OperationLedgerRecord>, operationId: string): OperationLedgerRecord {
  const record = records.get(operationId);

  if (record === undefined) {
    throw new Error(`Operation ledger record ${operationId} has not been started.`);
  }

  return record;
}

function compareOperationRecords(left: OperationLedgerRecord, right: OperationLedgerRecord): number {
  return left.operationId.localeCompare(right.operationId);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
