# Next Actions

## Immediate

1. Milestone V from `docs/plans/approved-backlog.md` is the immediate next approved work: Real Jira Intake.
2. Do not implement Milestone W or later until Milestone V is complete and tracking is updated.
3. Do not implement unlisted work. Add proposals here first and stop before implementation.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone U

Completed through Milestone U. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits, and runtime MCP wiring can resolve configured MCP servers to injected or constructed clients, validate discovered tools and allowlists before adapter use, and capture MCP audit records through typed adapters.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: Milestone V, Real Jira Intake, from `docs/plans/approved-backlog.md`.

Milestone V must keep Jira MCP-first for external Jira access, keep mock Jira as the default local/test path, avoid credentials in repository files, avoid live Jira or Atlassian MCP calls in tests, and preserve human-only production merge and production deployment gates.

Any other task must be proposed here first and must not be implemented until approved.
