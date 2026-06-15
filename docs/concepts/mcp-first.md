# MCP-first Runtime

Ewokbot is MCP-first for SaaS provider access, but it does not expose raw MCP tool use as product behavior.

## Runtime Ownership

The runtime owns:

- State transitions.
- Policy decisions.
- Retry/idempotency behavior.
- Reports and evidence.
- Quality gates.
- Human approval boundaries.

MCP servers provide provider access through typed adapters.

## Typed Ports

| Port | Provider surface |
| --- | --- |
| TicketPort | Jira/Atlassian ticket reads and controlled comments. |
| CodeHostPort | GitHub branch, PR, comment, and check boundaries. |
| DeploymentPort | Railway staging evidence and smoke mappings. |
| DevRunnerPort | OpenCode subprocess runner boundaries. |

Raw MCP tool names should stay in provider reference docs and adapter implementation details, not user-facing workflows.

## Native Fallbacks

Local git, filesystem, quality commands, and OpenCode subprocess execution are native boundaries because they are part of local runtime control. SaaS provider access should prefer MCP-backed typed ports when real provider behavior is needed.

## Inspection

`ewokbot mcp inspect` can inspect configured MCP server tools and schemas. It does not call provider tools. Optional registry caching writes sanitized snapshots under `.ewokbot/cache/mcp-tools/`.

For deep design, see [MCP-first Architecture](../specs/mcp-first-architecture.md).
