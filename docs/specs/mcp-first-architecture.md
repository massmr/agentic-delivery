# MCP-First Architecture

## Position

Agentic Delivery is an agent runtime with typed business ports backed first by MCP tools, with native, subprocess, and mock adapters as fallbacks.

MCP is the default control plane for external SaaS tools. It is not the business architecture itself.

## Core Principle

```text
Agent Runtime owns:
  - state
  - decisions
  - policies
  - retries
  - idempotency
  - reports
  - production approval gates

MCP provides:
  - external tool access
  - provider-specific actions
  - OAuth/session handling where supported
  - interchangeable SaaS capabilities
```

The runtime must never depend directly on raw MCP tool names in delivery logic. Raw MCP tools are mapped into typed business ports.

## Internal Ports

The orchestrator works against these internal contracts:

```text
TicketPort
  listBacklog
  getTicket
  comment
  transition

CodeHostPort
  createBranch
  pushBranch
  openPullRequest
  getChecks
  commentOnPullRequest

DeploymentPort
  waitForDeployment
  getServiceUrl

KnowledgePort
  search
  fetch

NotificationPort
  notify

DevRunnerPort
  run

WorkspacePort
  checkout
  diff
  commit
```

Adapters implement these ports:

```text
MCP adapters
Native API adapters
Subprocess adapters
Mock adapters
```

## MCP Layer

The MCP layer is shared infrastructure, not one connector per provider.

Responsibilities:

- MCP server registry.
- Server process/session lifecycle.
- Tool discovery.
- Tool allowlist.
- Tool schema mapping.
- Tool call timeout handling.
- Auth/session error handling.
- Audit log entries for every external operation.

## Provider Strategy

Preferred defaults:

```text
Jira       -> MCP first
GitHub     -> MCP first, native fallback when precise checks/branch operations require it
Railway    -> MCP first, native fallback when deployment polling requires stronger guarantees
Vercel     -> MCP first, future provider
Bitbucket  -> MCP first, future provider
OpenCode   -> subprocess first, MCP only if a stable OpenCode MCP server exists
Local git  -> native/subprocess, not MCP
Filesystem -> native, not MCP
Quality    -> native/subprocess, not MCP
```

## Safety Policy

Every MCP tool is classified before use:

```text
read      -> allowed during planning and verification
write     -> allowed only through a typed port and state transition
danger    -> human approval or explicit policy required
```

Examples:

- Reading a Jira ticket is `read`.
- Commenting on a Jira ticket is `write`.
- Opening a production PR is `write` plus production policy.
- Merging production is `danger` and remains human-only.

## Idempotency

External MCP calls can timeout after succeeding. To avoid duplicated comments, branches, PRs, or transitions, mutating operations must be recorded in an operation ledger before and after execution.

Minimum operation ledger fields:

- operation id
- run id
- provider
- port
- action
- input hash
- status
- external id or URL
- started at
- finished at
- error summary

## Configuration Direction

The long-term configuration should move from provider-specific `jira`, `github`, and `railway` modes toward role-based provider bindings:

```yaml
providers:
  ticket:
    kind: mcp
    provider: jira
    server: atlassian

  code_host:
    kind: mcp
    provider: github
    server: github

  deployment:
    kind: mcp
    provider: railway
    server: railway

  dev_runner:
    kind: subprocess
    provider: opencode
    command: opencode

mcp_servers:
  atlassian:
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.atlassian.com/v1/mcp/authv2
```

Existing mock config remains supported until the role-based provider binding migration is complete.

## Non-Goals

- Do not let raw MCP tool selection leak into core delivery logic.
- Do not store secrets in repository files.
- Do not add live MCP calls in tests.
- Do not make production merge autonomous.
- Do not replace local state with MCP provider state.
