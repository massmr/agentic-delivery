# MCP-First Architecture

## Position

Ewokbot is an agent runtime with typed business ports backed first by MCP tools, with native, subprocess, and mock adapters as fallbacks.

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
- Tool registry metadata from inspected provider contracts.
- Tool policy evaluation from registry classifications and workspace `mcp_policy`.
- Tool allowlist.
- Tool schema mapping.
- Tool call timeout handling.
- Auth/session error handling.
- Audit log entries for every external operation.

The tool registry is built from inspection data, not from guessed provider names. Registry entries record the provider, server id, raw tool name, description, sanitized input schema, optional output schema and output metadata, category, classification, source, and default-deny authorization metadata. Operators may explicitly cache sanitized inspection snapshots under `.ewokbot/cache/mcp-tools/`; these snapshots are separate from provider credentials, run evidence, and operation ledgers. Registry data supports full mapping with policy-gated execution, but it does not by itself authorize MCP tool calls.

The workspace-level `mcp_policy` section selects one of four policy modes: `read_only`, `supervised`, `trusted`, or `custom`. Provider, server, and tool overrides may return `allow`, `allow_redacted`, `require_human`, or `deny`; tool overrides take precedence over server and provider overrides. `read_only` permits only read-classified tools. `supervised` permits reads and requires human approval for unoverridden writes. `trusted` permits reads and staging-safe writes while still blocking secret-sensitive, unknown, and destructive tools unless an explicit safe override exists. `custom` denies by default and honors explicit overrides only after the global safety constraints are applied.

## Provider Strategy

Preferred defaults:

```text
Atlassian  -> MCP first, with Jira work items as the first supported surface
GitHub     -> MCP first, native fallback when precise checks/branch operations require it
Railway    -> MCP first, native fallback when deployment polling requires stronger guarantees
Vercel     -> MCP first, future provider
Bitbucket  -> MCP first, future provider
OpenCode   -> subprocess first, MCP only if a stable OpenCode MCP server exists
Local git  -> native/subprocess, not MCP
Filesystem -> native, not MCP
Quality    -> native/subprocess, not MCP
```

## Native Fallback Contracts

Every typed port action must declare which adapter kinds are allowed before implementation code can use it. The Milestone S contract surface lives in `src/policy/native-fallback-contracts.ts` and is exported as `nativeFallbackContracts`.

Adapter kinds:

- `mcp`: preferred for external SaaS providers when a typed MCP tool contract is precise enough.
- `native`: allowed for provider APIs only when MCP cannot express required precision, and required for local filesystem-owned operations.
- `subprocess`: required for local git, quality commands, and OpenCode execution where the repository or runner is the source of truth.
- `mock`: allowed for deterministic tests and local mock runs without credentials.

Current contract matrix:

```text
TicketPort listBacklog/getTicket/comment
  -> MCP first, mock fallback only

CodeHostPort createBranch/openPullRequest/readPullRequest/getChecks/commentOnPullRequest
  -> MCP first; native fallback only for documented precision gaps

CodeHostPort mergePullRequest
  -> MCP first only for typed develop auto-merge when branch-scoped delivery config and explicit MCP policy allow it; main/production remain human-only

CodeHostPort pushBranch
  -> native/subprocess/mock only; MCP disallowed until a precise push contract exists

DeploymentPort waitForDeployment/readDeployment/getServiceUrl
  -> MCP first; native fallback only for polling, metadata, timeout, or service URL precision gaps

WorkspacePort checkout/diff/commit
  -> native/subprocess/mock only; MCP disallowed

FilesystemPort run state and report writes
  -> native/mock only; MCP disallowed

QualityGateRunner runRequiredGates
  -> subprocess/mock only; MCP disallowed

DevRunnerPort runOpenCode
  -> subprocess/mock only unless a future stable OpenCode MCP server is explicitly contracted

ProductionControl mergeProductionPullRequest/deployProduction
  -> human-only; no autonomous adapter allowed
```

Railway staging verification treats those precision gaps as blocking evidence requirements. MCP deployment results must match the requested branch, commit SHA, deployment reference, and staging environment, and service URLs must be HTTP(S), before staging can become verified.

Native fallback must not become a general bypass around MCP. It is a narrow contract for local runtime responsibilities and provider precision gaps that MCP cannot yet model.

## Safety Policy

Every MCP tool is classified before use:

```text
read      -> allowed during planning and verification
write     -> allowed only through a typed port and state transition
danger    -> human approval or explicit policy required
```

Inspection registry classifications are more detailed than the runtime allowlist labels: `read`, `write`, `destructive`, `secret_sensitive`, `unknown`, and `custom`. Unknown or unclassified registry entries are explicit and denied by default. Policy reports explain whether a registry entry is allowed, redacted, blocked, or requires human approval. Runtime MCP readiness evaluates policy before typed-port allowlist checks and before provider side effects; only `allow` can continue into autonomous typed-port execution. `allow_redacted` is for reporting surfaces and does not broaden runtime execution of secret-sensitive tools.

Global safety constraints override every mode and override: production merge and production deploy cannot become autonomous, destructive delete/remove/destroy tools cannot be autonomously allowed, and raw MCP tool calling is not exposed to coding agents or operator agents. AX/AY/AZ provider mappings, BA GitHub PR handoff, BB staging verification, BC develop PR follow-up, BD Cubic review, and BE operator-agent sandbox remain separate approved milestones.

Examples:

- Reading a Jira ticket is `read`.
- Commenting on a Jira ticket is `write`.
- Opening a production PR is `write` plus production policy.
- Merging production is `danger` and remains human-only.

## Idempotency

External MCP calls can timeout after succeeding. To avoid duplicated comments, branches, PRs, or transitions, mutating operations must be recorded in an operation ledger before and after execution.

The GitHub develop handoff persists this ledger under the run directory as `operation-ledger.json` and uses it for branch metadata creation, local branch push handoff, pull request creation, PR comments, and check reads. GitHub branch metadata, PR, comment, and check operations stay behind `CodeHostPort`; the actual branch push remains local git/native or subprocess fallback only.

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
