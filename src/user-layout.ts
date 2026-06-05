import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface EwokbotUserLayoutEnv {
  readonly XDG_CONFIG_HOME?: string | undefined;
  readonly XDG_DATA_HOME?: string | undefined;
  readonly XDG_CACHE_HOME?: string | undefined;
}

export interface EwokbotUserLayoutPathGroup {
  readonly directory: string;
}

export interface EwokbotUserLayoutFileGroup extends EwokbotUserLayoutPathGroup {
  readonly file: string;
}

export interface EwokbotUserLayout {
  readonly config: EwokbotUserLayoutFileGroup;
  readonly data: EwokbotUserLayoutPathGroup;
  readonly auth: EwokbotUserLayoutFileGroup;
  readonly state: EwokbotUserLayoutPathGroup;
  readonly cache: EwokbotUserLayoutPathGroup;
}

export interface ResolveEwokbotUserLayoutOptions {
  readonly homeDirectory: string;
  readonly env?: EwokbotUserLayoutEnv | undefined;
}

export async function createEwokbotUserLayout(options: ResolveEwokbotUserLayoutOptions): Promise<EwokbotUserLayout> {
  const layout = resolveEwokbotUserLayout(options);

  await mkdir(layout.config.directory, { recursive: true });
  await mkdir(layout.data.directory, { recursive: true });
  await mkdir(layout.state.directory, { recursive: true });
  await mkdir(layout.cache.directory, { recursive: true });

  await ensureAuthMetadataFile(layout.auth.file);

  return layout;
}

export function resolveEwokbotUserLayout(options: ResolveEwokbotUserLayoutOptions): EwokbotUserLayout {
  const configHome = resolveXdgHomeDirectory(options.env?.XDG_CONFIG_HOME, join(options.homeDirectory, '.config'));
  const dataHome = resolveXdgHomeDirectory(options.env?.XDG_DATA_HOME, join(options.homeDirectory, '.local', 'share'));
  const cacheHome = resolveXdgHomeDirectory(options.env?.XDG_CACHE_HOME, join(options.homeDirectory, '.cache'));

  const configDirectory = join(configHome, 'ewokbot');
  const dataDirectory = join(dataHome, 'ewokbot');
  const authDirectory = dataDirectory;

  return {
    config: {
      directory: configDirectory,
      file: join(configDirectory, 'config.json')
    },
    data: {
      directory: dataDirectory
    },
    auth: {
      directory: authDirectory,
      file: join(authDirectory, 'auth.json')
    },
    state: {
      directory: join(dataDirectory, 'state')
    },
    cache: {
      directory: join(cacheHome, 'ewokbot')
    }
  };
}

async function ensureAuthMetadataFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await writeFile(filePath, '{}\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (isFileExistsError(error)) {
      return;
    }

    throw error;
  }
}

function resolveXdgHomeDirectory(value: string | undefined, fallbackDirectory: string): string {
  if (value !== undefined && value.trim() !== '') {
    return value;
  }

  return fallbackDirectory;
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
