import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDiscoveredRepositoryConfig, discoverSiblingGitDirectories } from '../../src/index.js';

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'ewokbot-repo-discovery-'));
}

function createGitDir(rootPath: string, name: string): void {
  mkdirSync(join(rootPath, name, '.git'), { recursive: true });
}

function createGitSubmoduleMarker(rootPath: string, name: string): void {
  mkdirSync(join(rootPath, name), { recursive: true });
  writeFileSync(join(rootPath, name, '.git'), `gitdir: ../.git/modules/${name}\n`, 'utf8');
}

test('discovers direct sibling Git repositories deterministically', () => {
  const rootPath = createWorkspace();

  try {
    createGitDir(rootPath, 'service-b');
    createGitDir(rootPath, 'app-mobile');
    createGitDir(rootPath, 'service-a');

    const repos = discoverSiblingGitDirectories(rootPath);

    assert.deepEqual(repos.map((repo) => repo.name), ['app-mobile', 'service-a', 'service-b']);
    assert.deepEqual(repos[0], {
      name: 'app-mobile',
      url: '',
      localPath: './app-mobile',
      defaultBranch: 'develop',
      productionBranch: 'main',
      qualityProfile: 'node',
      hints: ['app-mobile', 'app', 'mobile'],
      stagingSmokeUrls: [],
      deployments: undefined
    });
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test('ignores hidden directories, .ewokbot, node_modules, non-git, excluded, and nested repos', () => {
  const rootPath = createWorkspace();

  try {
    createGitDir(rootPath, 'service-a');
    createGitDir(rootPath, 'service-b');
    createGitDir(rootPath, '.ewokbot');
    createGitDir(rootPath, '.hidden-service');
    createGitDir(rootPath, 'node_modules');
    mkdirSync(join(rootPath, 'docs'), { recursive: true });
    createGitDir(rootPath, 'packages/nested-service');

    const repos = discoverSiblingGitDirectories(rootPath, { exclude: ['service-b'] });

    assert.deepEqual(repos.map((repo) => repo.name), ['service-a']);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test('discovers direct sibling Git submodules that expose a .git file marker', () => {
  const rootPath = createWorkspace();

  try {
    createGitSubmoduleMarker(rootPath, 'koulis');
    createGitSubmoduleMarker(rootPath, 'koulis.api');
    createGitDir(rootPath, 'saas_frontend');
    mkdirSync(join(rootPath, 'docs'), { recursive: true });

    const repos = discoverSiblingGitDirectories(rootPath);

    assert.deepEqual(repos.map((repo) => repo.name), ['koulis', 'koulis.api', 'saas_frontend']);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test('creates discovered repository defaults from a folder basename', () => {
  assert.deepEqual(createDiscoveredRepositoryConfig('service-api'), {
    name: 'service-api',
    url: '',
    localPath: './service-api',
    defaultBranch: 'develop',
    productionBranch: 'main',
    qualityProfile: 'node',
    hints: ['service-api', 'service', 'api'],
    stagingSmokeUrls: [],
    deployments: undefined
  });
});
