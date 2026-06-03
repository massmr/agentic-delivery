# Next Actions

## Immediate

1. Implement Milestone Q from `docs/plans/approved-backlog.md`: GitHub MCP CodeHostPort.
2. Use the shared MCP client foundation from Milestone O and the TicketPort pattern from Milestone P.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone M

Completed through Milestone P. Workspace config supports `mock` and `real` provider modes, Jira additionally supports `mode: mcp` with an injected MCP client, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, and Jira backlog/ticket/comment operations now have an MCP-backed `TicketPort` adapter with audit capture, configurable tool names, and MCP-mode project key validation.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work:

1. Milestone Q: GitHub MCP CodeHostPort
2. Milestone R: Railway MCP DeploymentPort
3. Milestone S: Native Fallback Contracts
4. Milestone T: Agent Worker Loop

Any other task must be proposed here first and must not be implemented until approved.
