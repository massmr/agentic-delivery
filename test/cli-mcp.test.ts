import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  MockMcpClient,
  createCliProgram,
  createMockMcpTool,
  type CliProgramIO,
  type JsonObject,
  type McpToolRegistry,
  type MockMcpToolRegistration
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
  assert.match(captured.stdout, /MCP policy mode: read_only/u);
  assert.match(captured.stdout, /- check-railway-status/u);
  assert.match(captured.stdout, /- list-projects/u);
  assert.match(captured.stdout, /- list-services/u);
  assert.match(captured.stdout, /policy: allow - Read-only mode allows read-classified tools/u);
  assert.match(captured.stdout, /no MCP tool was called/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(railway.listToolRequests, [{ serverId: 'railway' }]);
  assert.deepEqual(railway.toolCallRequests, []);
});

test('ewokbot mcp inspect --schema prints sanitized tool schemas without calling tools', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithAtlassianMcp());
  const captured = createCapturedIO();
  const secretDefault = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const shortSecretExample = 'short-token';
  const shortSecretEnum = 'enum-token';
  const atlassian = new MockMcpClient([
    createMockMcpTool(
      'atlassian',
      'search_jira_issues',
      () => ({ content: { issues: [] }, isError: false }),
      {
        type: 'object',
        properties: {
          jql: { type: 'string', description: 'JQL query.' },
          apiToken: { type: 'string', default: secretDefault, examples: [shortSecretExample], enum: [shortSecretEnum] }
        },
        required: ['jql'],
        examples: [secretDefault]
      }
    ),
    createMockMcpTool('atlassian', 'read_jira_issue', () => ({ content: { issue: {} }, isError: false }), {
      type: 'object',
      properties: { issueKey: { type: 'string', example: 'AD-123' } }
    }),
    createMockMcpTool('atlassian', 'add_jira_comment', () => ({ content: { ok: true }, isError: false }), {
      type: 'object',
      properties: { issueKey: { type: 'string' }, body: { type: 'string' } }
    })
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian } }
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'atlassian', '--schema']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /MCP server: atlassian/u);
  assert.match(captured.stdout, /- search_jira_issues/u);
  assert.match(captured.stdout, /- read_jira_issue/u);
  assert.match(captured.stdout, /- add_jira_comment/u);
  assert.match(captured.stdout, /inputSchema:/u);
  assert.match(captured.stdout, /"apiToken"/u);
  assert.match(captured.stdout, /"type": "string"/u);
  assert.match(captured.stdout, /"default": "\[redacted\]"/u);
  assert.match(captured.stdout, /"enum": \[\n\s+"\[redacted\]"/u);
  assert.match(captured.stdout, /"examples": \[\n\s+"\[redacted\]"/u);
  assert.match(captured.stdout, /"example": "AD-123"/u);
  assert.doesNotMatch(captured.stdout, new RegExp(secretDefault, 'u'));
  assert.doesNotMatch(captured.stdout, new RegExp(shortSecretExample, 'u'));
  assert.doesNotMatch(captured.stdout, new RegExp(shortSecretEnum, 'u'));
  assert.match(captured.stdout, /no MCP tool was called/u);
  assert.equal(captured.stderr, '');
  assert.deepEqual(atlassian.listToolRequests, [{ serverId: 'atlassian' }]);
  assert.deepEqual(atlassian.toolCallRequests, []);
});

test('ewokbot mcp inspect --json emits sanitized schemas and output metadata', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithRailwayMcp());
  const captured = createCapturedIO();
  const deployToken = 'sk-1234567890abcdefghijklmnopqrstuvwxyz';
  const railway = new MockMcpClient([
    createToolWithOutputMetadata('railway', 'list-services', {
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          deployToken: { type: 'string', example: deployToken }
        }
      },
      outputSchema: {
        type: 'object',
        properties: { services: { type: 'array' } }
      },
      outputMetadata: {
        contentType: 'application/json',
        example: { services: [] }
      }
    })
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { railway } }
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'railway', '--json']);

  assert.equal(exitCode, 0);
  assert.equal(captured.stderr, '');
  assert.doesNotMatch(captured.stdout, new RegExp(deployToken, 'u'));

  const payload = JSON.parse(captured.stdout) as {
    readonly server: { readonly id: string; readonly transport: string; readonly command?: string; readonly args?: readonly string[] };
    readonly tools: readonly {
      readonly name: string;
      readonly inputSchema: JsonObject;
      readonly outputSchema?: JsonObject;
      readonly outputMetadata?: JsonObject;
    }[];
    readonly registry: McpToolRegistry;
    readonly policy: {
      readonly mode: string;
      readonly summary: { readonly allow: number; readonly allowRedacted: number; readonly requireHuman: number; readonly deny: number };
      readonly evaluations: readonly { readonly toolName: string; readonly decision: string; readonly classification: string }[];
    };
    readonly safety: { readonly inspectOnly: boolean; readonly mcpMethodsCalled: readonly string[]; readonly toolCallsPerformed: number };
  };

  assert.deepEqual(payload.server, { id: 'railway', transport: 'stdio', command: 'railway', args: ['mcp'] });
  assert.equal(payload.tools[0]?.name, 'list-services');
  assert.deepEqual(payload.tools[0]?.inputSchema, {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      deployToken: { type: 'string', example: '[redacted]' }
    }
  });
  assert.deepEqual(payload.tools[0]?.outputSchema, { type: 'object', properties: { services: { type: 'array' } } });
  assert.deepEqual(payload.tools[0]?.outputMetadata, { contentType: 'application/json', example: { services: [] } });
  assert.equal(payload.registry.provider, 'railway');
  assert.equal(payload.registry.serverId, 'railway');
  assert.equal(payload.registry.entries[0]?.toolName, 'list-services');
  assert.equal(payload.registry.entries[0]?.classification, 'read');
  assert.equal(payload.registry.entries[0]?.defaultAuthorization, 'deny');
  assert.equal(payload.registry.entries[0]?.policyRequired, true);
  assert.deepEqual(payload.registry.safety, {
    source: 'inspection',
    defaultAuthorization: 'deny',
    unknownToolsDeniedByDefault: true,
    mcpMethodsCalled: ['listTools'],
    toolCallsPerformed: 0
  });
  assert.equal(payload.policy.mode, 'read_only');
  assert.deepEqual(payload.policy.summary, { allow: 1, allowRedacted: 0, requireHuman: 0, deny: 0 });
  assert.deepEqual(payload.policy.evaluations[0], {
    provider: 'railway',
    serverId: 'railway',
    toolName: 'list-services',
    classification: 'read',
    mode: 'read_only',
    decision: 'allow',
    reason: 'Read-only mode allows read-classified tools.',
    redacted: false,
    humanApprovalRequired: false,
    blocked: false
  });
  assert.deepEqual(payload.safety, { inspectOnly: true, mcpMethodsCalled: ['listTools'], toolCallsPerformed: 0 });
  assert.deepEqual(railway.listToolRequests, [{ serverId: 'railway' }]);
  assert.deepEqual(railway.toolCallRequests, []);
});

test('ewokbot mcp inspect writes registry snapshots only when explicitly requested', async () => {
  const rootPath = createWorkspaceRoot(workspaceWithRailwayMcp());
  const capturedDefault = createCapturedIO();
  const railway = new MockMcpClient([
    createMockMcpTool('railway', 'list-services', () => ({ content: { services: [] }, isError: false }), {
      type: 'object',
      properties: {
        serviceId: { type: 'string' },
        deployToken: { type: 'string', example: 'sk-1234567890abcdefghijklmnopqrstuvwxyz' }
      }
    })
  ]);

  const defaultExitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: capturedDefault.io,
    runtimeMcp: { mcpClients: { railway } }
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'railway']);

  assert.equal(defaultExitCode, 0);
  assert.equal(existsSync(join(rootPath, '.ewokbot', 'cache', 'mcp-tools', 'railway.json')), false);

  const capturedCached = createCapturedIO();
  const cachedExitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: capturedCached.io,
    runtimeMcp: { mcpClients: { railway } }
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'railway', '--cache-registry']);

  assert.equal(cachedExitCode, 0);
  assert.match(capturedCached.stdout, /Registry cache snapshot: \.ewokbot\/cache\/mcp-tools\/railway\.json/u);
  assert.deepEqual(railway.listToolRequests, [{ serverId: 'railway' }, { serverId: 'railway' }]);
  assert.deepEqual(railway.toolCallRequests, []);

  const snapshotPath = join(rootPath, '.ewokbot', 'cache', 'mcp-tools', 'railway.json');
  const snapshotText = readFileSync(snapshotPath, 'utf8');
  assert.doesNotMatch(snapshotText, /sk-1234567890abcdefghijklmnopqrstuvwxyz/u);

  const snapshot = JSON.parse(snapshotText) as { readonly registry: McpToolRegistry; readonly safety: { readonly mcpMethodsCalled: readonly string[]; readonly toolCallsPerformed: number } };
  assert.equal(snapshot.registry.entries[0]?.toolName, 'list-services');
  assert.deepEqual(snapshot.registry.entries[0]?.inputSchema, {
    type: 'object',
    properties: {
      serviceId: { type: 'string' },
      deployToken: { type: 'string', example: '[redacted]' }
    }
  });
  assert.deepEqual(snapshot.safety, { inspectOnly: true, mcpMethodsCalled: ['listTools'], toolCallsPerformed: 0 });
});

test('ewokbot mcp inspect reports custom policy overrides without calling tools', async () => {
  const rootPath = createWorkspaceRoot(`${workspaceWithAtlassianMcp()}
mcp_policy:
  mode: supervised
  tools:
    atlassian.add_jira_comment:
      decision: require_human
      reason: Comments require operator review.
`);
  const captured = createCapturedIO();
  const atlassian = new MockMcpClient([
    createMockMcpTool('atlassian', 'search_jira_issues', () => ({ content: { issues: [] }, isError: false })),
    createMockMcpTool('atlassian', 'add_jira_comment', () => ({ content: { ok: true }, isError: false }))
  ]);

  const exitCode = await createCliProgram({
    cwd: rootPath,
    configPath: '.ewokbot/workspace.yml',
    io: captured.io,
    runtimeMcp: { mcpClients: { atlassian } }
  }).run(['node', 'ewokbot', 'mcp', 'inspect', 'atlassian']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /MCP policy mode: supervised/u);
  assert.match(captured.stdout, /- search_jira_issues/u);
  assert.match(captured.stdout, /policy: allow - Supervised mode allows read-classified tools/u);
  assert.match(captured.stdout, /- add_jira_comment/u);
  assert.match(captured.stdout, /policy: require_human - Comments require operator review/u);
  assert.deepEqual(atlassian.listToolRequests, [{ serverId: 'atlassian' }]);
  assert.deepEqual(atlassian.toolCallRequests, []);
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

  const capturedUnsupported = createCapturedIO();
  const unsupportedExitCode = await createCliProgram({ io: capturedUnsupported.io }).run(['node', 'ewokbot', 'mcp', 'inspect', 'railway', '--call']);
  assert.equal(unsupportedExitCode, 1);
  assert.match(capturedUnsupported.stderr, /Unsupported MCP inspect option '--call'/u);
  assert.match(capturedUnsupported.stderr, /Supported options: --schema, --json, --cache-registry/u);
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

function workspaceWithAtlassianMcp(): string {
  return `
workspace:
  name: MCP Inspect Test
  autonomy: supervised
  staging_branch: develop
  production_branch: main
  max_concurrent_tickets: 1
jira:
  mode: mcp
  base_url: https://jira.example.test
  project_keys:
    - AD
  mcp_server: atlassian
github:
  mode: mock
  organization: agentic
railway:
  mode: mock
  staging_branch: develop
  production_branch: main
dev_runner:
  mode: mock
  provider: opencode
  command: opencode
  max_attempts: 1
quality:
  default_profile: node
mcp_servers:
  atlassian:
    transport: http
    url: https://mcp.example.test/atlassian
    env_var_names: []
repos:
  discovery: sibling-git-directories
  exclude: []
`;
}

function createToolWithOutputMetadata(
  serverId: string,
  toolName: string,
  metadata: { readonly inputSchema: JsonObject; readonly outputSchema?: JsonObject | undefined; readonly outputMetadata?: JsonObject | undefined }
): MockMcpToolRegistration {
  return {
    serverId,
    definition: {
      name: toolName,
      description: `Mock MCP tool ${toolName}.`,
      inputSchema: metadata.inputSchema,
      outputSchema: metadata.outputSchema,
      outputMetadata: metadata.outputMetadata
    },
    handler: () => ({ content: { ok: true }, isError: false })
  };
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
