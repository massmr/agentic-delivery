import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  MockMcpClient,
  createCliProgram,
  createMockMcpTool,
  type CliProgramIO
} from '../src/index.js';

test('ewokbot mcp inspect lists configured server tools without calling them', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithRailwayMcp());
  const captured = createCapturedIO();
  const railway = new MockMcpClient([
    createMockMcpTool('railway', 'check-railway-status', () => ({ content: { ok: true }, isError: false })),
    createMockMcpTool('railway', 'list-projects', () => ({ content: { projects: [] }, isError: false })),
    createMockMcpTool('railway', 'list-services', () => ({ content: { services: [] }, isError: false }))
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { railway } }
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'railway']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /MCP server: railway/u);
  assert.match(captured.stdout, /Transport: stdio/u);
  assert.match(captured.stdout, /Command: railway mcp/u);
  assert.match(captured.stdout, /Tools: 3/u);
  assert.match(captured.stdout, /- check-railway-status/u);
  assert.match(captured.stdout, /- list-projects/u);
  assert.match(captured.stdout, /- list-services/u);
  assert.match(captured.stdout, /no MCP tool was called/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(railway.listToolRequests, [{ serverId: 'railway' }]);
  assert.deepEqual(railway.toolCallRequests, []);
});

test('ewokbot mcp inspect reports missing configured servers', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithRailwayMcp());
  const captured = createCapturedIO();

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'missing']);

  assert.equal(exitCode, 1);
  assert.equal(captured.stdout, '');
  assert.match(captured.stderr, /MCP server 'missing' is not configured/u);
});

test('ewokbot mcp rejects unknown subcommands and missing server ids', async () => {
  const capturedUnknown = createCapturedIO();
  const unknownExitCode = await createCliProgram({ io: capturedUnknown.io }).run(['node', 'ewokbot', 'mcp', 'call', 'railway']);
  assert.equal(unknownExitCode, 1);
  assert.match(capturedUnknown.stderr, /Unknown mcp command/u);

  const capturedMissing = createCapturedIO();
  const missingExitCode = await createCliProgram({ io: capturedMissing.io }).run(['node', 'ewokbot', 'mcp', 'inspect']);
  assert.equal(missingExitCode, 1);
  assert.match(capturedMissing.stderr, /Missing MCP server id/u);
});

function createWorkspaceRoot(configYaml: string): string {
  const rootPath = mkdtempSync(join(tmpdir(), 'ewokbot-mcp-inspect-'));
  mkdirSync(join(rootPath, '.ewokbot'), { recursive: true });
  writeFileSync(join(rootPath, '.ewokbot', 'workspace.yml'), configYaml, 'utf8');
  writeFileSync(join(rootPath, '.ewokbot', '.env'), 'OPENCODE_COMMAND=opencode\n', 'utf8');
  return rootPath;
}

function workspaceWithRailwayMcp(): string {
  return `
workspace:
  name: MCP Inspect Test
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mock
  base_url: https://jira.example.test
  project_keys:
    - AD
github:
  mode: mock
  organization: agentic
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway
dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 1
quality:
  default_profile: node
mcp_servers:
  railway:
    transport: stdio
    command: railway
    args:
      - mcp
    env_var_names: []
repos:
  discovery: sibling-git-directories
  exclude: []
`;
}

function createCapturedIO(): { readonly io: CliProgramIO; readonly stdout: string; readonly stderr: string } {
  const captured = { stdout: '', stderr: '' };
  return {
    get stdout() {
      return captured.stdout;
    },
    get stderr() {
      return captured.stderr;
    },
    io: {
      stdout: (text: string) => {
        captured.stdout += text;
      },
      stderr: (text: string) => {
        captured.stderr += text;
      }
    }
  };
}
