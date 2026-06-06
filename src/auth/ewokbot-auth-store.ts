import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { resolveEwokbotUserLayout, type ResolveEwokbotUserLayoutOptions } from '../user-layout.js';

export const ewokbotAuthProviders = ['jira', 'github', 'railway', 'vercel'] as const;
export type EwokbotAuthProvider = typeof ewokbotAuthProviders[number];

export const externalAuthProviders = ['opencode'] as const;
export type ExternalAuthProvider = typeof externalAuthProviders[number];

export interface EwokbotAuthProviderRecord {
  readonly provider: EwokbotAuthProvider;
  readonly status: 'configured';
  readonly credentialKind: string;
  readonly updatedAt: string;
}

export interface EwokbotAuthState {
  readonly version: 1;
  readonly providers: Partial<Record<EwokbotAuthProvider, EwokbotAuthProviderRecord>>;
}

export interface EwokbotAuthStoreOptions {
  readonly userLayoutOptions?: ResolveEwokbotUserLayoutOptions | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface EwokbotAuthStore {
  readonly authFilePath: string;
  read(): Promise<EwokbotAuthState>;
  list(): Promise<readonly EwokbotAuthProviderRecord[]>;
  login(provider: EwokbotAuthProvider): Promise<EwokbotAuthProviderRecord>;
  logout(provider: EwokbotAuthProvider): Promise<boolean>;
  writeRawForTest(content: string): Promise<void>;
}

const emptyState: EwokbotAuthState = { version: 1, providers: {} };

export function createEwokbotAuthStore(options: EwokbotAuthStoreOptions = {}): EwokbotAuthStore {
  const layout = resolveEwokbotUserLayout(options.userLayoutOptions ?? { homeDirectory: process.env.HOME ?? process.cwd(), env: process.env });
  const authFilePath = layout.auth.file;
  const now = options.now ?? (() => new Date());

  async function read(): Promise<EwokbotAuthState> {
    let content: string;

    try {
      content = await readFile(authFilePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return emptyState;
      }

      throw error;
    }

    if (content.trim().length === 0 || content.trim() === '{}') {
      return emptyState;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Unable to parse Ewokbot auth metadata at ${authFilePath}. Contents were not printed.`);
    }

    return parseAuthState(parsed, authFilePath);
  }

  async function write(state: EwokbotAuthState): Promise<void> {
    await mkdir(dirname(authFilePath), { recursive: true });
    const temporaryPath = `${authFilePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, authFilePath);
  }

  return {
    authFilePath,
    read,
    async list(): Promise<readonly EwokbotAuthProviderRecord[]> {
      const state = await read();
      return ewokbotAuthProviders.flatMap((provider) => {
        const record = state.providers[provider];
        return record === undefined ? [] : [record];
      });
    },
    async login(provider: EwokbotAuthProvider): Promise<EwokbotAuthProviderRecord> {
      const state = await read();
      const record: EwokbotAuthProviderRecord = {
        provider,
        status: 'configured',
        credentialKind: 'metadata-only',
        updatedAt: now().toISOString()
      };
      await write({ version: 1, providers: { ...state.providers, [provider]: record } });
      return record;
    },
    async logout(provider: EwokbotAuthProvider): Promise<boolean> {
      const state = await read();
      const existed = state.providers[provider] !== undefined;
      const providers = { ...state.providers };
      delete providers[provider];
      await write({ version: 1, providers });
      return existed;
    },
    async writeRawForTest(content: string): Promise<void> {
      await mkdir(dirname(authFilePath), { recursive: true });
      await writeFile(authFilePath, content, { encoding: 'utf8', mode: 0o600 });
    }
  };
}

export function isEwokbotAuthProvider(value: string): value is EwokbotAuthProvider {
  return ewokbotAuthProviders.includes(value as EwokbotAuthProvider);
}

export function isExternalAuthProvider(value: string): value is ExternalAuthProvider {
  return externalAuthProviders.includes(value as ExternalAuthProvider);
}

function parseAuthState(value: unknown, authFilePath: string): EwokbotAuthState {
  if (!isRecord(value)) {
    throw new Error(`Invalid Ewokbot auth metadata at ${authFilePath}. Expected an object. Contents were not printed.`);
  }

  const rawProviders = isRecord(value.providers) ? value.providers : {};
  const providers: Partial<Record<EwokbotAuthProvider, EwokbotAuthProviderRecord>> = {};

  for (const provider of ewokbotAuthProviders) {
    const rawRecord = rawProviders[provider];

    if (rawRecord === undefined) {
      continue;
    }

    if (!isRecord(rawRecord)) {
      throw new Error(`Invalid Ewokbot auth metadata for ${provider} at ${authFilePath}. Contents were not printed.`);
    }

    const credentialKind = typeof rawRecord.credentialKind === 'string' ? rawRecord.credentialKind : 'metadata-only';
    const updatedAt = typeof rawRecord.updatedAt === 'string' ? rawRecord.updatedAt : 'unknown';
    providers[provider] = {
      provider,
      status: 'configured',
      credentialKind,
      updatedAt
    };
  }

  return { version: 1, providers };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
