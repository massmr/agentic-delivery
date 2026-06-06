import {
  createEwokbotAuthStore,
  ewokbotAuthProviders,
  isEwokbotAuthProvider,
  isExternalAuthProvider,
  type EwokbotAuthProvider,
  type EwokbotAuthProviderRecord
} from '../../auth/index.js';
import { redactSensitiveText } from '../../runners/opencode/redaction.js';
import type { ResolveEwokbotUserLayoutOptions } from '../../user-layout.js';
import type { CliProgramIO } from '../program.js';

export interface AuthCommandOptions {
  readonly args: readonly string[];
  readonly io: CliProgramIO;
  readonly userLayoutOptions?: ResolveEwokbotUserLayoutOptions | undefined;
}

const AUTH_HELP_TEXT = [
  'Usage:',
  '  ewokbot auth status',
  '  ewokbot auth login <provider>',
  '  ewokbot auth logout <provider>',
  '  ewokbot auth list',
  '',
  'Providers: jira, github, railway, vercel.',
  'OpenCode auth is managed by OpenCode; run opencode auth login outside Ewokbot.'
].join('\n');

export async function runAuthCommand(options: AuthCommandOptions): Promise<number> {
  const [subcommand, providerName] = options.args;
  const store = createEwokbotAuthStore({ userLayoutOptions: options.userLayoutOptions });

  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
    options.io.stdout(`${AUTH_HELP_TEXT}\n`);
    return subcommand === undefined ? 1 : 0;
  }

  try {
    if (subcommand === 'status') {
      const state = await store.read();
      options.io.stdout(`Ewokbot auth file: ${store.authFilePath}\n`);
      options.io.stdout('Ewokbot-owned provider metadata:\n');

      for (const provider of ewokbotAuthProviders) {
        options.io.stdout(`- ${provider}: ${formatProviderStatus(state.providers[provider])}\n`);
      }

      options.io.stdout('OpenCode auth is external and is not configured or mutated by ewokbot auth commands.\n');
      return 0;
    }

    if (subcommand === 'list') {
      const records = await store.list();

      if (records.length === 0) {
        options.io.stdout('No Ewokbot providers are configured.\n');
        return 0;
      }

      for (const record of records) {
        options.io.stdout(`${record.provider}: ${formatProviderStatus(record)}\n`);
      }

      return 0;
    }

    if (subcommand === 'login') {
      const provider = parseProvider(providerName, options.io);

      if (provider === undefined) {
        return 1;
      }

      const record = await store.login(provider);
      options.io.stdout(`Recorded Ewokbot-owned ${record.provider} auth metadata (${redactSensitiveText(record.credentialKind)}). No live provider calls were made.\n`);
      return 0;
    }

    if (subcommand === 'logout') {
      const provider = parseProvider(providerName, options.io);

      if (provider === undefined) {
        return 1;
      }

      const removed = await store.logout(provider);
      options.io.stdout(removed
        ? `Removed Ewokbot-owned ${provider} auth metadata.\n`
        : `No Ewokbot-owned ${provider} auth metadata was configured.\n`);
      return 0;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.io.stderr(`${redactSensitiveText(message)}\n`);
    return 1;
  }

  options.io.stderr(`Unknown auth command: ${subcommand}\n\n${AUTH_HELP_TEXT}\n`);
  return 1;
}

function parseProvider(providerName: string | undefined, io: CliProgramIO): EwokbotAuthProvider | undefined {
  if (providerName === undefined || providerName.trim().length === 0) {
    io.stderr(`Missing provider.\n\n${AUTH_HELP_TEXT}\n`);
    return undefined;
  }

  const normalized = providerName.trim().toLowerCase();

  if (isExternalAuthProvider(normalized)) {
    io.stdout('OpenCode auth is owned by OpenCode. Run opencode auth login outside Ewokbot; Ewokbot will only detect OpenCode readiness.\n');
    return undefined;
  }

  if (!isEwokbotAuthProvider(normalized)) {
    io.stderr(`Unsupported Ewokbot auth provider: ${redactSensitiveText(providerName)}. Supported providers: jira, github, railway, vercel.\n`);
    return undefined;
  }

  return normalized;
}

function formatProviderStatus(record: EwokbotAuthProviderRecord | undefined): string {
  if (record === undefined) {
    return 'not configured';
  }

  return `configured (${redactSensitiveText(record.credentialKind)}, updated ${redactSensitiveText(record.updatedAt)})`;
}
