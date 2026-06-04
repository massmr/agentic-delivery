# Next Actions

## Immediate

1. Milestone W from `docs/plans/approved-backlog.md` is the immediate next approved work: Worker MCP Mode.
2. Do not implement Milestone X or later until Milestone W is complete and tracking is updated.
3. Do not implement unlisted work. Add proposals here first and stop before implementation.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone V

Completed through Milestone V. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits, runtime MCP wiring can resolve configured MCP servers to injected or constructed clients, and Jira intake for `agentic scan` and worker backlog processing can use a runtime-injected Jira MCP `TicketPort` while preserving the mock default.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: Milestone W, Worker MCP Mode, from `docs/plans/approved-backlog.md`.

Milestone W must keep mock worker execution as the default, enable MCP mode only under explicit configuration and injected runtime clients, avoid credentials in repository files, avoid live provider or MCP calls in tests, keep production merge and production deployment human-only, and avoid implementing OpenCode, GitHub delivery, or Railway staging behavior beyond the approved Worker MCP Mode scope.

Any other task must be proposed here first and must not be implemented until approved.
