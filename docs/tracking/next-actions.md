# Next Actions

## Immediate

1. Milestone T from `docs/plans/approved-backlog.md` is complete: Agent Worker Loop.
2. No next approved milestone is currently listed in `docs/plans/approved-backlog.md`.
3. Add any proposed future work here for approval before implementation.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone T

Completed through Milestone T. Workspace config supports `mock` and `real` provider modes, Jira additionally supports `mode: mcp` with an injected MCP client, GitHub now supports `mode: mcp` with an injected MCP client, Railway now supports `mode: mcp` with an injected MCP client for deployment state and service URL lookups, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, and the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: none currently listed.

Any other task must be proposed here first and must not be implemented until approved.
