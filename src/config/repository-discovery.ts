import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { WorkspaceRepositoryConfig } from './workspace-config.js';

export type RepositoryDiscoveryMode = 'sibling-git-directories';

export interface WorkspaceRepositoryDiscoveryConfig {
  readonly discovery: RepositoryDiscoveryMode;
  readonly exclude: readonly string[];
}

export interface RepositoryDiscoveryOptions {
  readonly exclude?: readonly string[] | undefined;
}

export function discoverSiblingGitDirectories(rootPath: string, options: RepositoryDiscoveryOptions = {}): readonly WorkspaceRepositoryConfig[] {
  const excluded = new Set(options.exclude ?? []);
  const repositories: WorkspaceRepositoryConfig[] = [];

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || shouldIgnoreEntry(entry.name, excluded)) {
      continue;
    }

    const candidatePath = join(rootPath, entry.name);
    const gitPath = join(candidatePath, '.git');

    if (!existsSync(gitPath) || !statSync(gitPath).isDirectory()) {
      continue;
    }

    repositories.push(createDiscoveredRepositoryConfig(entry.name));
  }

  return repositories.sort((left, right) => left.name.localeCompare(right.name));
}

export function createDiscoveredRepositoryConfig(name: string): WorkspaceRepositoryConfig {
  return {
    name,
    url: '',
    localPath: `./${name}`,
    defaultBranch: 'develop',
    productionBranch: 'main',
    qualityProfile: 'node',
    hints: createHints(name),
    stagingSmokeUrls: []
  };
}

function shouldIgnoreEntry(name: string, excluded: ReadonlySet<string>): boolean {
  return name.startsWith('.') || name === 'node_modules' || excluded.has(name);
}

function createHints(name: string): readonly string[] {
  const hints = new Set<string>([name]);

  for (const token of name.split(/[^a-zA-Z0-9]+/u)) {
    const normalized = token.trim().toLowerCase();

    if (normalized.length > 0) {
      hints.add(normalized);
    }
  }

  return [...hints];
}
